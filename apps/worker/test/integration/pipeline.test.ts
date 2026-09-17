import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminService, opsService, placeService } from '@wayfinder/core';
import { importPlacesFromGeoJsonSeq } from '../../src/pipeline/import-places.js';
import { type RunCommand, runOsmRefresh } from '../../src/pipeline/refresh.js';
import { type TestDb, createTestDb } from '../../../../packages/core/test/helpers/db.js';

let t: TestDb;
let dir: string;

beforeAll(async () => {
  t = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), 'wf-pipeline-'));
});
afterAll(async () => {
  await t?.close();
});

const seq = (features: object[]) => features.map((f) => `\x1e${JSON.stringify(f)}`).join('\n') + '\n';
const feature = (id: string, properties: object, coordinates: unknown, type = 'Point') => ({ type: 'Feature', id, properties, geometry: { type, coordinates } });

describe('places import', () => {
  it('loads GeoJSONSeq into places via a staging swap, deduplicating street segments', async () => {
    const file = join(dir, 'places.geojsonseq');
    await writeFile(
      file,
      seq([
        feature('n1', { place: 'city', name: 'Canberra' }, [149.13, -35.28]),
        feature('n2', { tourism: 'viewpoint', name: 'Mount Ainslie Lookout' }, [149.16, -35.27]),
        feature('w1', { highway: 'primary', name: 'Northbourne Avenue' }, [[149.13, -35.27], [149.131, -35.26]], 'LineString'),
        feature('w2', { highway: 'primary', name: 'Northbourne Avenue' }, [[149.131, -35.26], [149.132, -35.255]], 'LineString'),
        feature('n3', { amenity: 'bench' }, [149.1, -35.3]),
      ]) + 'not json\n',
    );
    await placeService.upsertPlaces(t.db, [{ id: 'old', name: 'Old Place', kind: 'town', category: null, description: '', lon: 1, lat: 1, importance: 0 }]);
    const n = await importPlacesFromGeoJsonSeq(t.db, file);
    expect(n).toBe(3);
    const names = (await t.db.query('SELECT name FROM places ORDER BY name')).rows.map((r) => r.name);
    expect(names).toEqual(['Canberra', 'Mount Ainslie Lookout', 'Northbourne Avenue']);
    const results = await placeService.searchPlaces(t.db, 'northborne', null, 5);
    expect(results[0]!.name).toBe('Northbourne Avenue');
    // Re-import works (staging table recreated, indexes renamed)
    await expect(importPlacesFromGeoJsonSeq(t.db, file)).resolves.toBe(3);
  });
});

describe('OSM refresh orchestration', () => {
  it('runs the steps in order, swaps outputs, records data date and log', async () => {
    const dataDir = join(dir, 'data');
    await mkdir(join(dataDir, 'graphhopper', 'graph-current'), { recursive: true });
    const commands: string[] = [];
    const fake: RunCommand = async (cmd, args, onLine) => {
      commands.push(`${cmd} ${args[0]}`);
      const argv = args.join(' ');
      if (cmd === 'curl') await writeFile(args[args.indexOf('-o') + 1]!, 'x');
      if (cmd === 'osmium' && args[0] === 'fileinfo') onLine('2026-09-10T20:21:02Z');
      if (cmd === 'java' && argv.includes('graph.location')) {
        const loc = args.find((a) => a.includes('graph.location'))!.split('=')[1]!;
        await mkdir(loc, { recursive: true });
        await writeFile(join(loc, 'nodes'), 'graph');
      }
      if (cmd === 'java' && argv.includes('--output=')) {
        const out = args.find((a) => a.startsWith('--output='))!.slice(9);
        expect(out.endsWith('.pmtiles')).toBe(true); // Planetiler needs the real extension
        await writeFile(out, 'pmtiles');
      }
      if (cmd === 'osmium' && args[0] === 'export') {
        await writeFile(args[args.indexOf('-o') + 1]!, seq([feature('n9', { place: 'town', name: 'Queanbeyan' }, [149.23, -35.35])]));
      }
      onLine(`ran ${cmd}`);
    };
    const runId = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    await runOsmRefresh(
      t.db,
      runId,
      { dataDir, pbfUrl: 'https://example.test/au.osm.pbf', graphhopperJar: 'gh.jar', graphhopperConfig: 'c.yml', graphhopperHeap: '1g', planetilerJar: 'p.jar', planetilerHeap: '1g', skip: ['download'] },
      fake,
    );
    expect(commands).toEqual(['osmium fileinfo', 'java -Xmx1g', 'java -Xmx1g', 'osmium tags-filter', 'osmium export']);
    expect(await readFile(join(dataDir, 'graphhopper', 'graph-current', 'nodes'), 'utf8')).toBe('graph');
    expect(await readFile(join(dataDir, 'tiles', 'australia.pmtiles'), 'utf8')).toBe('pmtiles');
    expect((await readFile(join(dataDir, 'graphhopper', 'graph-version'), 'utf8')).trim()).toMatch(/^\d+$/);
    // A second run reuses the graph and tiles already built for this extract.
    const runId2 = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    commands.length = 0;
    await runOsmRefresh(
      t.db,
      runId2,
      { dataDir, pbfUrl: 'https://example.test/au.osm.pbf', graphhopperJar: 'gh.jar', graphhopperConfig: 'c.yml', graphhopperHeap: '1g', planetilerJar: 'p.jar', planetilerHeap: '1g', skip: ['download'] },
      fake,
    );
    expect(commands.filter((c) => c.startsWith('java'))).toEqual([]);

    const [, run] = await opsService.listPipelineRuns(t.db);
    expect(run).toMatchObject({ status: 'succeeded', osmDataDate: '2026-09-10T20:21:02Z' });
    expect(run!.logTail).toContain('== graph done');
    expect((await adminService.getAppState<string>(t.db, opsService.OSM_DATA_DATE_KEY))?.value).toBe('2026-09-10T20:21:02Z');
    expect((await t.db.query("SELECT name FROM places")).rows.map((r) => r.name)).toEqual(['Queanbeyan']);
  });

  it('marks the run failed and keeps live data when a step fails', async () => {
    const dataDir = join(dir, 'data2');
    const runId = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    const failing: RunCommand = async (cmd) => {
      if (cmd === 'java') throw new Error('java exited with code 137');
    };
    await expect(
      runOsmRefresh(t.db, runId, { dataDir, pbfUrl: 'x', graphhopperJar: 'a', graphhopperConfig: 'b', graphhopperHeap: '1g', planetilerJar: 'p', planetilerHeap: '1g', skip: ['download'] }, failing),
    ).rejects.toThrow(/137/);
    const run = (await opsService.listPipelineRuns(t.db)).find((r) => r.id === runId)!;
    expect(run.status).toBe('failed');
    expect(run.logTail).toContain('!! java exited with code 137');
    expect((await t.db.query("SELECT name FROM places")).rows.map((r) => r.name)).toEqual(['Queanbeyan']);
  });
});
