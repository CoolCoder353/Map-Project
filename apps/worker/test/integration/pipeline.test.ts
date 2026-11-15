import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminService, opsService, placeService } from '@wayfinder/core';
import { importPlacesFromGeoJsonSeq } from '../../src/pipeline/import-places.js';
import { importRoadFacts } from '../../src/pipeline/osm-roads.js';
import { downloadSpeedSigns } from '../../src/pipeline/speed-signs.js';
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

describe('places import with G-NAF addresses', () => {
  const gnaf = (id: string, name: string, lon: number, over: object = {}) => ({
    id, name, kind: 'address' as const, category: null, description: 'Queanbeyan 2620', lon, lat: -35.352, importance: 0,
    suburb: 'Queanbeyan', state: 'NSW', postcode: '2620', poiType: null, brand: null, openingHours: null, ...over,
  });
  async function* batches(...b: ReturnType<typeof gnaf>[][]) {
    yield* b;
  }

  it('adds them, drops the OpenStreetMap copy of one, and gives their suburb its postcode', async () => {
    const file = join(dir, 'places-gnaf.geojsonseq');
    await writeFile(
      file,
      seq([
        feature('n1', { place: 'town', name: 'Queanbeyan' }, [149.23, -35.35]),
        // The same address as G-NAF's, capitals aside; and one G-NAF hasn't.
        feature('n2', { 'addr:housenumber': '1', 'addr:street': 'Monaro street', 'addr:suburb': 'QUEANBEYAN', 'addr:state': 'NSW' }, [149.232, -35.352]),
        feature('n3', { 'addr:housenumber': '99', 'addr:street': 'Monaro Street', 'addr:suburb': 'Queanbeyan', 'addr:state': 'NSW' }, [149.239, -35.352]),
        // The same number and street in another suburb is another address.
        feature('n4', { 'addr:housenumber': '1', 'addr:street': 'Monaro Street', 'addr:suburb': 'Cooma', 'addr:state': 'NSW' }, [149.12, -36.23]),
        feature('w5', { highway: 'residential', name: 'Monaro Street', 'addr:suburb': 'queanbeyan', 'addr:state': 'NSW' }, [[149.23, -35.352], [149.24, -35.352]], 'LineString'),
      ]),
    );
    const lines: string[] = [];
    const n = await importPlacesFromGeoJsonSeq(t.db, file, (l) => lines.push(l), null, batches([gnaf('GANSW1', '1 Monaro Street', 149.2321)], [gnaf('GANSW2', '3 Monaro Street', 149.2323)]));
    const rows = (await t.db.query('SELECT id, name, suburb, postcode FROM places ORDER BY id')).rows;
    expect(rows).toEqual([
      { id: 'GANSW1', name: '1 Monaro Street', suburb: 'Queanbeyan', postcode: '2620' },
      { id: 'GANSW2', name: '3 Monaro Street', suburb: 'Queanbeyan', postcode: '2620' },
      // No boundaries in this test to say which state the town is in, so it isn't matched to a postcode.
      { id: 'n1', name: 'Queanbeyan', suburb: 'Queanbeyan', postcode: null },
      { id: 'n3', name: '99 Monaro Street', suburb: 'Queanbeyan', postcode: '2620' },
      { id: 'n4', name: '1 Monaro Street', suburb: 'Cooma', postcode: null },
      { id: 'w5', name: 'Monaro Street', suburb: 'queanbeyan', postcode: '2620' },
    ]);
    expect(n).toBe(6);
    expect(lines).toContain('G-NAF addresses: 2');
    expect(lines).toContain('addresses G-NAF also has, dropped: 1');
    // Found by its number in its suburb, and by where it is.
    expect((await placeService.searchPlaces(t.db, '3 Monaro St, Queanbeyan NSW 2620', null, 5))[0]).toMatchObject({ id: 'GANSW2', name: '3 Monaro Street' });
    expect(await placeService.reverseGeocode(t.db, [149.2323, -35.352])).toMatchObject({ id: 'GANSW2' });
  });

  it('is the import it always was when there are none', async () => {
    const file = join(dir, 'places-gnaf.geojsonseq');
    const lines: string[] = [];
    expect(await importPlacesFromGeoJsonSeq(t.db, file, (l) => lines.push(l), null, batches())).toBe(5);
    expect((await t.db.query("SELECT id FROM places WHERE kind = 'address' ORDER BY id")).rows.map((r) => r.id)).toEqual(['n2', 'n3', 'n4']);
    expect(lines).toContain('G-NAF addresses: 0');
  });
});

const square = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const BOUNDARIES = seq([
  feature('r1', { boundary: 'administrative', admin_level: '4', name: 'New South Wales' }, square(149.2, -36, 150, -35), 'Polygon'),
  feature('r2', { boundary: 'administrative', admin_level: '10', name: 'Queanbeyan' }, square(149.21, -35.37, 149.25, -35.33), 'Polygon'),
]);
const ROADS = seq([
  feature('n21', { highway: 'traffic_signals' }, [149.232, -35.351]),
  feature('n22', { highway: 'crossing', crossing: 'traffic_signals' }, [149.233, -35.352]),
  feature('w23', { highway: 'residential', maxspeed: '60', 'maxspeed:conditional': '40 @ (Mo-Fr 08:00-09:30,14:30-16:00)' }, [[149.23, -35.35], [149.231, -35.35]], 'LineString'),
]);
const PLACES = seq([
  feature('n9', { place: 'town', name: 'Queanbeyan' }, [149.23, -35.35]),
  // The same town mapped again as an area: dropped in favour of the node.
  feature('w10', { place: 'town', name: 'Queanbeyan' }, [[[149.22, -35.36], [149.24, -35.36], [149.24, -35.34], [149.22, -35.36]]], 'Polygon'),
  feature('n11', { 'addr:housenumber': '1', 'addr:street': 'Monaro Street', 'addr:postcode': '2620' }, [149.232, -35.352]),
  feature('n12', { shop: 'supermarket', brand: 'Woolworths', opening_hours: 'Mo-Su 07:00-22:00' }, [149.233, -35.353]),
  // Outside the locality polygon but 3 km from the town node.
  feature('w13', { highway: 'residential', name: 'Edge Road' }, [[149.26, -35.35], [149.261, -35.35]], 'LineString'),
]);

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
        const out = args[args.indexOf('-o') + 1]!;
        await writeFile(out, out.includes('boundaries') ? BOUNDARIES : out.includes('roads') ? ROADS : PLACES);
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
    expect(commands).toEqual(['osmium fileinfo', 'java -Xmx1g', 'java -Xmx1g', 'osmium tags-filter', 'osmium export', 'osmium tags-filter', 'osmium export', 'osmium tags-filter', 'osmium export']);
    expect(await readFile(join(dataDir, 'graphhopper', 'graph-current', 'nodes'), 'utf8')).toBe('graph');
    expect(await readFile(join(dataDir, 'tiles', 'australia.pmtiles'), 'utf8')).toBe('pmtiles');
    expect((await readFile(join(dataDir, 'graphhopper', 'graph-version'), 'utf8')).trim()).toMatch(/^\d+$/);
    const [run] = await opsService.listPipelineRuns(t.db);
    expect(run).toMatchObject({ status: 'succeeded', osmDataDate: '2026-09-10T20:21:02Z' });
    expect(run!.logTail).toContain('== graph done');
    expect((await adminService.getAppState<string>(t.db, opsService.OSM_DATA_DATE_KEY))?.value).toBe('2026-09-10T20:21:02Z');
    const rows = (await t.db.query('SELECT id, kind, suburb, state, postcode, poi_type, opening_hours FROM places ORDER BY id')).rows;
    expect(rows).toEqual([
      { id: 'n11', kind: 'address', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620', poi_type: null, opening_hours: null },
      { id: 'n12', kind: 'poi', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620', poi_type: 'shop=supermarket', opening_hours: 'Mo-Su 07:00-22:00' },
      { id: 'n9', kind: 'town', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620', poi_type: null, opening_hours: null },
      { id: 'w13', kind: 'street', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620', poi_type: 'highway=residential', opening_hours: null },
    ]);
    // Traffic lights and school zones come in with the places, in the state they're in.
    expect((await t.db.query('SELECT id::text, kind FROM traffic_signals ORDER BY id')).rows).toEqual([
      { id: '21', kind: 'signals' },
      { id: '22', kind: 'crossing' },
    ]);
    expect((await t.db.query('SELECT way_id::text, conditional, variable, state FROM way_speed_rules')).rows).toEqual([
      { way_id: '23', conditional: '40 @ (Mo-Fr 08:00-09:30,14:30-16:00)', variable: false, state: 'NSW' },
    ]);
  });

  it('downloads G-NAF once per release and adds its addresses for the states asked for', async () => {
    const dataDir = join(dir, 'data-gnaf');
    await mkdir(join(dataDir, 'graphhopper', 'graph-current'), { recursive: true });
    const commands: string[] = [];
    let listing: object | null = { result: { resources: [{ format: 'ZIP', name: 'AUG 2026 - Geoscape G-NAF - GDA2020', url: 'https://data.example.test/aug26_gda2020.zip' }] } };
    const fake: RunCommand = async (cmd, args) => {
      const argv = args.join(' ');
      const out = args[args.indexOf('-o') + 1]!;
      if (cmd === 'curl') {
        const url = args.at(-1)!;
        commands.push(`curl ${url}`);
        if (url.includes('package_show')) {
          if (!listing) throw new Error('curl exited with code 22');
          await writeFile(out, JSON.stringify(listing));
        } else await writeFile(out, 'zip');
      }
      if (cmd === 'unzip') {
        const to = args[args.indexOf('-d') + 1]!;
        const state = /\*\/([A-Z]+)_ADDRESS_DETAIL_psv\.psv/.exec(argv)![1]!;
        commands.push(`unzip ${state}`);
        expect(args.slice(0, 4)).toEqual(['-o', '-j', '-q', join(dataDir, 'gnaf', 'g-naf.zip')]);
        expect(argv).toContain('*/Authority_Code_STREET_SUFFIX_AUT_psv.psv');
        await writeFile(join(to, 'Authority_Code_STREET_SUFFIX_AUT_psv.psv'), 'CODE|NAME\nN|NORTH\n');
        await writeFile(join(to, `${state}_LOCALITY_psv.psv`), 'LOCALITY_PID|DATE_RETIRED|LOCALITY_NAME|PRIMARY_POSTCODE\nL1||QUEANBEYAN|2620\n');
        await writeFile(join(to, `${state}_STREET_LOCALITY_psv.psv`), 'STREET_LOCALITY_PID|DATE_RETIRED|STREET_NAME|STREET_TYPE_CODE|STREET_SUFFIX_CODE|LOCALITY_PID\nS1||MONARO|STREET||L1\n');
        await writeFile(
          join(to, `${state}_ADDRESS_DETAIL_psv.psv`),
          `ADDRESS_DETAIL_PID|DATE_RETIRED|FLAT_NUMBER|LEVEL_NUMBER|NUMBER_FIRST_PREFIX|NUMBER_FIRST|NUMBER_FIRST_SUFFIX|STREET_LOCALITY_PID|ALIAS_PRINCIPAL|POSTCODE|CONFIDENCE\nGA${state}1|||||1||S1|P|2620|2\nGA${state}5|||||5||S1|P|2620|2\n`,
        );
        await writeFile(join(to, `${state}_ADDRESS_DEFAULT_GEOCODE_psv.psv`), `ADDRESS_DETAIL_PID|DATE_RETIRED|LONGITUDE|LATITUDE\nGA${state}1||149.2321|-35.352\nGA${state}5||149.2325|-35.352\n`);
      }
      if (cmd === 'osmium' && args[0] === 'export') await writeFile(out, out.includes('boundaries') ? BOUNDARIES : out.includes('roads') ? ROADS : PLACES);
    };
    const cfg = {
      dataDir, pbfUrl: 'https://example.test/au.osm.pbf', graphhopperJar: 'gh.jar', graphhopperConfig: 'c.yml', graphhopperHeap: '1g', planetilerJar: 'p.jar', planetilerHeap: '1g',
      gnafDatasetUrl: 'https://data.example.test/api/3/action/package_show?id=g-naf', gnafStates: ['NSW' as const], skip: ['download', 'graph', 'tiles'],
    };
    const refresh = async (c = cfg) => {
      commands.length = 0;
      const runId = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
      await runOsmRefresh(t.db, runId, c, fake);
      return (await opsService.listPipelineRuns(t.db)).find((r) => r.id === runId)!.logTail;
    };
    const addresses = async () => (await t.db.query("SELECT id, name, suburb, state, postcode FROM places WHERE kind = 'address' ORDER BY id")).rows;

    expect(await refresh()).toContain('downloading AUG 2026 - Geoscape G-NAF - GDA2020');
    expect(commands).toEqual([`curl ${cfg.gnafDatasetUrl}`, 'curl https://data.example.test/aug26_gda2020.zip', 'unzip NSW']);
    // G-NAF's 1 Monaro Street replaces the map's; 5 Monaro Street is new.
    expect(await addresses()).toEqual([
      { id: 'GANSW1', name: '1 Monaro Street', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620' },
      { id: 'GANSW5', name: '5 Monaro Street', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620' },
    ]);
    await expect(readFile(join(dataDir, 'gnaf', 'unzipped', 'NSW_LOCALITY_psv.psv'))).rejects.toThrow(); // unzipped files don't stay

    // The same release next month: not downloaded again.
    expect(await refresh()).toContain('reusing AUG 2026 - Geoscape G-NAF - GDA2020: still the current release');
    expect(commands.filter((c) => c.startsWith('curl'))).toEqual([`curl ${cfg.gnafDatasetUrl}`]);
    expect(await addresses()).toHaveLength(2);

    // data.gov.au down: the release already here still serves.
    listing = null;
    expect(await refresh()).toContain("couldn't check for a newer G-NAF release (curl exited with code 22); keeping the one already downloaded");
    expect(await addresses()).toHaveLength(2);

    // A new release is downloaded.
    listing = { result: { resources: [{ format: 'ZIP', name: 'NOV 2026 - Geoscape G-NAF - GDA2020', url: 'https://data.example.test/nov26_gda2020.zip' }] } };
    await refresh();
    expect(commands.filter((c) => c.startsWith('curl'))).toEqual([`curl ${cfg.gnafDatasetUrl}`, 'curl https://data.example.test/nov26_gda2020.zip']);

    // Only the places step: the addresses still come from the zip that is here.
    await refresh({ ...cfg, skip: ['download', 'gnaf', 'graph', 'tiles'] });
    expect(commands.filter((c) => c.startsWith('curl'))).toEqual([]);
    expect(await addresses()).toHaveLength(2);

    // Switched off: the map's own address is back and nothing is downloaded or unzipped.
    expect(await refresh({ ...cfg, gnafDatasetUrl: '' })).toContain('G-NAF addresses are switched off');
    expect(commands).toEqual([]);
    expect((await addresses()).map((r) => r.id)).toEqual(['n11']);
  });

  it('fails the run when G-NAF is wanted, none is here and the release cannot be found', async () => {
    const dataDir = join(dir, 'data-gnaf-none');
    const runId = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    const down: RunCommand = async (cmd) => {
      if (cmd === 'curl') throw new Error('curl exited with code 6');
    };
    await expect(
      runOsmRefresh(t.db, runId, { dataDir, pbfUrl: 'x', graphhopperJar: 'a', graphhopperConfig: 'b', graphhopperHeap: '1g', planetilerJar: 'p', planetilerHeap: '1g', gnafDatasetUrl: 'https://data.example.test/x', skip: ['download'] }, down),
    ).rejects.toThrow("Couldn't find the current G-NAF release: curl exited with code 6");
    expect((await opsService.listPipelineRuns(t.db)).find((r) => r.id === runId)!.status).toBe('failed');
  });

  it('a retry after a late failure reuses the graph and tiles already built', async () => {
    const dataDir = join(dir, 'data-retry');
    await mkdir(join(dataDir, 'graphhopper', 'graph-current'), { recursive: true });
    const commands: string[] = [];
    let failPlaces = true;
    const fake: RunCommand = async (cmd, args, onLine) => {
      commands.push(`${cmd} ${args[0]}`);
      const argv = args.join(' ');
      if (cmd === 'osmium' && args[0] === 'fileinfo') onLine('2026-09-10T20:21:02Z');
      if (cmd === 'java' && argv.includes('graph.location')) {
        const loc = args.find((a) => a.includes('graph.location'))!.split('=')[1]!;
        await mkdir(loc, { recursive: true });
        await writeFile(join(loc, 'nodes_ch_car'), 'graph');
      }
      if (cmd === 'java' && argv.includes('--output=')) await writeFile(args.find((a) => a.startsWith('--output='))!.slice(9), 'pmtiles');
      if (cmd === 'osmium' && args[0] === 'export') {
        const out = args[args.indexOf('-o') + 1]!;
        if (failPlaces && !out.includes('boundaries')) throw new Error('osmium exited with code 1');
        await writeFile(out, out.includes('boundaries') ? BOUNDARIES : PLACES);
      }
    };
    const cfg = { dataDir, pbfUrl: 'https://example.test/au.osm.pbf', graphhopperJar: 'gh.jar', graphhopperConfig: 'c.yml', graphhopperHeap: '1g', planetilerJar: 'p.jar', planetilerHeap: '1g', skip: ['download'] };

    const first = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    await expect(runOsmRefresh(t.db, first, cfg, fake)).rejects.toThrow(/osmium/);
    expect(commands.filter((c) => c.startsWith('java'))).toHaveLength(2); // graph + tiles built

    failPlaces = false;
    commands.length = 0;
    const second = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    await runOsmRefresh(t.db, second, cfg, fake);
    expect(commands.filter((c) => c.startsWith('java'))).toEqual([]); // both reused
    expect(await readFile(join(dataDir, 'tiles', 'australia.pmtiles'), 'utf8')).toBe('pmtiles');
    expect(await readFile(join(dataDir, 'graphhopper', 'graph-current', 'nodes_ch_car'), 'utf8')).toBe('graph');
    const run = (await opsService.listPipelineRuns(t.db)).find((r) => r.id === second)!;
    expect(run.status).toBe('succeeded');
  });

  it('marks the run failed and keeps live data when a step fails', async () => {
    const dataDir = join(dir, 'data2');
    const before = (await t.db.query('SELECT id FROM places ORDER BY id')).rows;
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
    expect((await t.db.query('SELECT id FROM places ORDER BY id')).rows).toEqual(before);
  });
});

describe('road facts import', () => {
  it('swaps in traffic lights and limit rules, and can do it again', async () => {
    const file = join(dir, 'roads.geojsonseq');
    await writeFile(
      file,
      seq([
        feature('n1', { highway: 'traffic_signals' }, [153.02, -27.47]),
        feature('n2', { highway: 'traffic_signals', traffic_signals: 'ramp_meter' }, [153.03, -27.47]),
        feature('n3', { highway: 'traffic_signals', traffic_signals: 'blinker' }, [153.04, -27.47]),
        feature('w4', { highway: 'motorway', maxspeed: '100', 'maxspeed:variable': 'yes' }, [[153.0, -27.4], [153.01, -27.4]], 'LineString'),
        feature('w5', { highway: 'primary', maxspeed: 'signals' }, [[153.0, -27.41], [153.01, -27.41]], 'LineString'),
        feature('w6', { highway: 'primary', maxspeed: '60' }, [[153.0, -27.42], [153.01, -27.42]], 'LineString'),
        feature('w7', { highway: 'primary', oneway: 'yes', 'turn:lanes': 'left|through|through;right' }, [[153.0, -27.43], [153.01, -27.43]], 'LineString'),
      ]) + 'not json\n\n',
    );
    expect(await importRoadFacts(t.db, file)).toEqual({ signals: 2, rules: 2, lanes: 1 });
    expect(await importRoadFacts(t.db, file)).toEqual({ signals: 2, rules: 2, lanes: 1 });
    expect((await t.db.query('SELECT way_id::text, forward, backward, coords FROM way_lanes')).rows).toEqual([
      { way_id: '7', forward: 'left|through|through;right', backward: null, coords: [[153.0, -27.43], [153.01, -27.43]] },
    ]);
    expect((await t.db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'way_lanes'")).rows).toEqual([{ indexname: 'way_lanes_pkey' }]);
    expect((await t.db.query('SELECT id::text, kind FROM traffic_signals ORDER BY id')).rows).toEqual([
      { id: '1', kind: 'signals' },
      { id: '2', kind: 'ramp_meter' },
    ]);
    expect((await t.db.query('SELECT way_id::text, variable, state FROM way_speed_rules ORDER BY way_id')).rows).toEqual([
      { way_id: '4', variable: true, state: null },
      { way_id: '5', variable: true, state: null },
    ]);
    // The point index is still there under its usual name, for the lookups routes make.
    const idx = (await t.db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'traffic_signals' ORDER BY indexname")).rows.map((r) => r.indexname);
    expect(idx).toEqual(['traffic_signals_pkey', 'traffic_signals_point_idx']);
  });
});

describe('speed signs import', () => {
  const HEADER = 'NUMBER,LATITUDE,LONGITUDE,SPEED,SIGN_TXT,SIGN_NOTE,SIGN_NUM,SIDE,ST_NAME,ST_TYPE,LOCALITY,DIRECTION,DATE,TIME';
  const files: Record<string, string> = {
    'https://data.example/a.csv': `${HEADER}\na1,-27.5,153.0,60,,,R4-1A,LEFT,FORD,ROAD,BURBANK,EAST,5/08/2019,1\na2,-27.5,153.01,40,SCHOOL ZONE,,R4-Q01A,LEFT,FORD,ROAD,BURBANK,EAST,5/08/2019,1\n`,
    'https://data.example/b.csv': `${HEADER}\nb1,-19.2,146.8,50,,,UNSIGNED,,LONG,STREET,TOWNSVILLE,NORTH,1/02/2020,1\na1,-27.5,153.0,60,,,R4-1A,LEFT,FORD,ROAD,BURBANK,EAST,5/08/2019,1\n`,
  };
  const fetchImpl = async (url: string) => {
    const text = files[url];
    const body = { result: { resources: Object.keys(files).map((u) => ({ name: u, url: u, format: 'CSV' })) } };
    return { ok: url.includes('package_show') || text !== undefined, status: text === undefined && !url.includes('package_show') ? 404 : 200, text: async () => text ?? '', json: async () => body };
  };

  it('downloads every region and swaps the signs in, once each', async () => {
    const log: string[] = [];
    expect(await downloadSpeedSigns(t.db, fetchImpl, (m) => log.push(m))).toBe(2);
    expect((await t.db.query("SELECT id, kmh, bearing, unsigned, to_char(surveyed_on, 'YYYY-MM-DD') AS surveyed_on FROM speed_signs ORDER BY id")).rows).toEqual([
      { id: 'a1', kmh: 60, bearing: 90, unsigned: false, surveyed_on: '2019-08-05' },
      { id: 'b1', kmh: 50, bearing: 0, unsigned: true, surveyed_on: '2020-02-01' },
    ]);
    expect(log).toContain('speed signs import complete: 2 signs');
    // The point index keeps its usual name for the lookups routes make.
    const idx = (await t.db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'speed_signs' ORDER BY indexname")).rows.map((r) => r.indexname);
    expect(idx).toEqual(['speed_signs_pkey', 'speed_signs_point_idx']);
  });

  it('keeps the signs it has when a region won’t download', async () => {
    const broken = async (url: string) => (url.endsWith('b.csv') ? { ok: false, status: 500, text: async () => '', json: async () => ({}) } : fetchImpl(url));
    await expect(downloadSpeedSigns(t.db, broken)).rejects.toThrow('download answered 500');
    expect(Number((await t.db.query<{ n: string }>('SELECT count(*) AS n FROM speed_signs')).rows[0]!.n)).toBe(2);
  });
});

