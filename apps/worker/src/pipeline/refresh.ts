import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Db, adminService, opsService } from '@wayfinder/core';
import { loadBoundaries } from './boundaries.js';
import { importPlacesFromGeoJsonSeq } from './import-places.js';
import { OSMIUM_FILTERS } from './osm-places.js';

export interface RefreshConfig {
  dataDir: string;
  pbfUrl: string;
  graphhopperJar: string;
  graphhopperConfig: string;
  graphhopperHeap: string;
  planetilerJar: string;
  planetilerHeap: string;
  /** Skip steps (for partial runs), e.g. ["tiles"]. */
  skip: string[];
}

/** Steps a hand-run refresh can pick (refresh-cli.js). */
export const REFRESH_STEPS = ['download', 'graph', 'tiles', 'places'] as const;

/**
 * Which steps to skip for a hand-run refresh: every step not named, or with no names, the
 * OSM_REFRESH_SKIP list. Throws on a name that isn't a step.
 */
export function stepsToSkip(only: string[], skipEnv: string): string[] {
  const unknown = only.filter((s) => !(REFRESH_STEPS as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`Unknown step(s): ${unknown.join(', ')}. Steps: ${REFRESH_STEPS.join(', ')}`);
  return only.length ? REFRESH_STEPS.filter((s) => !only.includes(s)) : skipEnv.split(',').map((s) => s.trim()).filter(Boolean);
}

export type RunCommand = (cmd: string, args: string[], onLine: (line: string) => void) => Promise<void>;

export const runCommand: RunCommand = (cmd, args, onLine) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (stream: NodeJS.ReadableStream) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      stream.on('end', () => buf && onLine(buf));
    };
    pipe(child.stdout!);
    pipe(child.stderr!);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });

/**
 * Full OSM data refresh. Each output is built beside the live one and swapped in at the end:
 * - graphhopper/graph-next → graph-current (+ bumps graph-version, which the GraphHopper
 *   container's wrapper watches to restart the server)
 * - tiles/australia.pmtiles.next → australia.pmtiles (the API reopens it on mtime change)
 * - places_staging → places (table swap in a transaction)
 */
export async function runOsmRefresh(db: Db, runId: string, cfg: RefreshConfig, run: RunCommand = runCommand): Promise<void> {
  const lines: string[] = [];
  let lastFlush = 0;
  const log = (line: string) => {
    lines.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    if (lines.length > 400) lines.splice(0, lines.length - 400);
    if (Date.now() - lastFlush > 5000) {
      lastFlush = Date.now();
      void opsService.updatePipelineRun(db, runId, { logTail: lines.join('\n') });
    }
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    if (cfg.skip.includes(name)) {
      log(`== skipping ${name}`);
      return;
    }
    log(`== ${name}`);
    const started = Date.now();
    await fn();
    log(`== ${name} done in ${Math.round((Date.now() - started) / 1000)} s`);
  };

  const osmDir = join(cfg.dataDir, 'osm');
  const ghDir = join(cfg.dataDir, 'graphhopper');
  const tilesDir = join(cfg.dataDir, 'tiles');
  const pbf = join(osmDir, 'australia-latest.osm.pbf');
  // Planetiler infers the output format from the extension, so the temp file keeps ".pmtiles".
  const tilesNext = join(tilesDir, 'australia.next.pmtiles');
  let dataDate: string | null = null;

  const mtime = async (p: string) => (await stat(p).catch(() => null))?.mtimeMs ?? null;
  /**
   * Steps mark their output complete so a retry can reuse it (a failure later in the run
   * then costs minutes instead of another full graph or tile build).
   */
  const markDone = (name: string) => writeFile(join(cfg.dataDir, `.${name}-complete`), String(Date.now()));
  const alreadyDone = async (name: string) => {
    const done = await mtime(join(cfg.dataDir, `.${name}-complete`));
    if (done === null) return false;
    const src = await mtime(pbf);
    // Reuse unless the extract is newer than the marker.
    return src === null || done >= src;
  };

  await opsService.updatePipelineRun(db, runId, { status: 'running' });
  try {
    await Promise.all([osmDir, ghDir, tilesDir, join(cfg.dataDir, 'sources')].map((d) => mkdir(d, { recursive: true })));

    await step('download', async () => {
      const age = await mtime(pbf);
      if (age !== null && Date.now() - age < 24 * 3600_000) {
        log(`reusing the extract downloaded ${new Date(age).toISOString()}`);
        return;
      }
      await run('curl', ['-fL', '--retry', '3', '-o', `${pbf}.part`, cfg.pbfUrl], log);
      await run('curl', ['-fL', '--retry', '3', '-o', `${pbf}.md5`, `${cfg.pbfUrl}.md5`], log);
      // md5 file references the original filename; check against the downloaded part.
      await run('sh', ['-c', `cd ${osmDir} && [ "$(md5sum < australia-latest.osm.pbf.part | cut -d' ' -f1)" = "$(cut -d' ' -f1 australia-latest.osm.pbf.md5)" ]`], log);
      await rename(`${pbf}.part`, pbf);
    });

    await step('fileinfo', async () => {
      await run('osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf], (line) => {
        if (/^\d{4}-\d{2}-\d{2}T/.test(line.trim())) dataDate = line.trim();
        log(line);
      });
    });

    await step('graph', async () => {
      if (await alreadyDone('graph')) {
        log('reusing the graph already built for this extract');
        return;
      }
      await rm(join(ghDir, 'graph-next'), { recursive: true, force: true });
      await run(
        'java',
        [
          `-Xmx${cfg.graphhopperHeap}`,
          `-Xms${cfg.graphhopperHeap}`,
          `-Ddw.graphhopper.datareader.file=${pbf}`,
          `-Ddw.graphhopper.graph.location=${join(ghDir, 'graph-next')}`,
          '-jar',
          cfg.graphhopperJar,
          'import',
          cfg.graphhopperConfig,
        ],
        log,
      );
      await markDone('graph');
    });

    await step('tiles', async () => {
      if (await alreadyDone('tiles')) {
        log('reusing the tiles already built for this extract');
        return;
      }
      await run(
        'java',
        [
          `-Xmx${cfg.planetilerHeap}`,
          '-jar',
          cfg.planetilerJar,
          `--osm-path=${pbf}`,
          `--output=${tilesNext}`,
          `--tmpdir=${join(cfg.dataDir, 'tmp')}`,
          `--download_dir=${join(cfg.dataDir, 'sources')}`,
          '--download',
          '--force',
          '--nodemap-type=array',
          '--storage=mmap',
        ],
        log,
      );
      await markDone('tiles');
    });

    await step('places', async () => {
      // State and suburb boundaries first, so every place can say where it is.
      const boundariesPbf = join(osmDir, 'boundaries.osm.pbf');
      const boundariesJson = join(osmDir, 'boundaries.geojsonseq');
      await run('osmium', ['tags-filter', '--overwrite', '-o', boundariesPbf, pbf, 'r/boundary=administrative'], log);
      await run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-o', boundariesJson, boundariesPbf], log);
      const boundaries = await loadBoundaries(boundariesJson, log);
      await rm(boundariesPbf, { force: true });
      await rm(boundariesJson, { force: true });

      const filtered = join(osmDir, 'places-filtered.osm.pbf');
      const geojson = join(osmDir, 'places.geojsonseq');
      await run('osmium', ['tags-filter', '--overwrite', '-o', filtered, pbf, ...OSMIUM_FILTERS], log);
      await run(
        'osmium',
        ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', geojson, filtered],
        log,
      );
      await importPlacesFromGeoJsonSeq(db, geojson, log, boundaries);
      await rm(filtered, { force: true });
      await rm(geojson, { force: true });
    });

    await step('swap', async () => {
      if (!cfg.skip.includes('graph')) {
        await rm(join(ghDir, 'graph-previous'), { recursive: true, force: true });
        await rename(join(ghDir, 'graph-current'), join(ghDir, 'graph-previous')).catch(() => undefined);
        await rename(join(ghDir, 'graph-next'), join(ghDir, 'graph-current'));
        await writeFile(join(ghDir, 'graph-version'), `${Date.now()}\n`);
      }
      if (!cfg.skip.includes('tiles')) {
        await stat(tilesNext);
        await rename(tilesNext, join(tilesDir, 'australia.pmtiles'));
      }
      if (dataDate) await adminService.setAppState(db, opsService.OSM_DATA_DATE_KEY, dataDate);
      await Promise.all([rm(join(cfg.dataDir, '.graph-complete'), { force: true }), rm(join(cfg.dataDir, '.tiles-complete'), { force: true })]);
    });

    await opsService.updatePipelineRun(db, runId, { status: 'succeeded', logTail: lines.join('\n'), osmDataDate: dataDate, finished: true });
  } catch (err) {
    log(`!! ${(err as Error).message}`);
    await opsService.updatePipelineRun(db, runId, { status: 'failed', logTail: lines.join('\n'), finished: true });
    throw err;
  }
}
