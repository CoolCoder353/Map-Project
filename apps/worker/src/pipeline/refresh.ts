import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Db, adminService, opsService } from '@wayfinder/core';
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
  let dataDate: string | null = null;

  await opsService.updatePipelineRun(db, runId, { status: 'running' });
  try {
    await Promise.all([osmDir, ghDir, tilesDir, join(cfg.dataDir, 'sources')].map((d) => mkdir(d, { recursive: true })));

    await step('download', async () => {
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
    });

    await step('tiles', async () => {
      await run(
        'java',
        [
          `-Xmx${cfg.planetilerHeap}`,
          '-jar',
          cfg.planetilerJar,
          `--osm-path=${pbf}`,
          `--output=${join(tilesDir, 'australia.pmtiles.next')}`,
          `--tmpdir=${join(cfg.dataDir, 'tmp')}`,
          `--download_dir=${join(cfg.dataDir, 'sources')}`,
          '--download',
          '--force',
          '--nodemap-type=array',
          '--storage=mmap',
        ],
        log,
      );
    });

    await step('places', async () => {
      const filtered = join(osmDir, 'places-filtered.osm.pbf');
      const geojson = join(osmDir, 'places.geojsonseq');
      await run('osmium', ['tags-filter', '--overwrite', '-o', filtered, pbf, ...OSMIUM_FILTERS], log);
      await run(
        'osmium',
        ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', geojson, filtered],
        log,
      );
      await importPlacesFromGeoJsonSeq(db, geojson, log);
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
        const next = join(tilesDir, 'australia.pmtiles.next');
        await stat(next);
        await rename(next, join(tilesDir, 'australia.pmtiles'));
      }
      if (dataDate) await adminService.setAppState(db, opsService.OSM_DATA_DATE_KEY, dataDate);
    });

    await opsService.updatePipelineRun(db, runId, { status: 'succeeded', logTail: lines.join('\n'), osmDataDate: dataDate, finished: true });
  } catch (err) {
    log(`!! ${(err as Error).message}`);
    await opsService.updatePipelineRun(db, runId, { status: 'failed', logTail: lines.join('\n'), finished: true });
    throw err;
  }
}
