import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type GnafTables, gnafAddresses, gnafAddressesFromFiles, gnafStates, latestRelease, readPsv, stateFiles, titleCase } from '../../src/pipeline/gnaf.js';

const all = async <T>(g: AsyncIterable<T[]>) => {
  const out: T[] = [];
  for await (const b of g) out.push(...b);
  return out;
};

// pid, retired, flat, level, prefix, first, suffix, street, alias, postcode, confidence
const detail = (pid: string, over: Partial<{ retired: string; flat: string; level: string; prefix: string; first: string; suffix: string; street: string; alias: string; postcode: string; confidence: string }> = {}) => {
  const d = { retired: '', flat: '', level: '', prefix: '', first: '12', suffix: '', street: 'S1', alias: 'P', postcode: '4163', confidence: '2', ...over };
  return [pid, d.retired, d.flat, d.level, d.prefix, d.first, d.suffix, d.street, d.alias, d.postcode, d.confidence];
};
const tables = (details: string[][], geocodes: string[][], over: Partial<GnafTables> = {}): GnafTables => ({
  streetSuffixes: [['N', 'NORTH']],
  localities: [
    ['L1', 'CLEVELAND', '4163', ''],
    ['L2', 'MOUNT COOT-THA', '', ''],
  ],
  streets: [
    ['S1', 'WELLINGTON', 'STREET', '', 'L1', ''],
    ['S2', 'SHORE', 'STREET', 'N', 'L1', ''],
    ['S3', 'SIR SAMUEL GRIFFITH', 'DRIVE', '', 'L2', ''],
    ['S4', 'OLD', 'ROAD', '', 'L1', '2020-01-01'],
  ],
  details,
  geocodes,
  ...over,
});
const at = (pid: string, lon = '153.26', lat = '-27.52', retired = '') => [pid, lon, lat, retired];

describe('G-NAF addresses', () => {
  it('makes a place of each address, with its street, suburb, state and postcode', async () => {
    const places = await all(gnafAddresses('QLD', tables([detail('GAQLD1'), detail('GAQLD2', { first: '7', suffix: 'a', street: 'S2' })], [at('GAQLD1'), at('GAQLD2', '153.27', '-27.51')])));
    expect(places).toEqual([
      {
        id: 'GAQLD1', name: '12 Wellington Street', kind: 'address', category: null, description: 'Cleveland 4163', lon: 153.26, lat: -27.52, importance: 0,
        suburb: 'Cleveland', state: 'QLD', postcode: '4163', poiType: null, brand: null, openingHours: null,
      },
      expect.objectContaining({ id: 'GAQLD2', name: '7A Shore Street North', lon: 153.27, lat: -27.51 }),
    ]);
  });

  it('keeps one place for a number with units, at the building where it has its own point', async () => {
    const places = await all(
      gnafAddresses(
        'QLD',
        tables(
          [detail('U1', { flat: '1' }), detail('B', {}), detail('U2', { flat: '2' }), detail('L3', { first: '20', level: '3' }), detail('L4', { first: '20', level: '4' })],
          [at('U1', '153.1'), at('B', '153.2'), at('U2', '153.3'), at('L3', '153.4'), at('L4', '153.5')],
        ),
      ),
    );
    expect(places.map((p) => [p.id, p.name, p.lon])).toEqual([
      ['B', '12 Wellington Street', 153.2],
      ['L3', '20 Wellington Street', 153.4],
    ]);
  });

  it('leaves out retired addresses, aliases, lots without a number and ones nothing vouches for', async () => {
    const details = [
      detail('RETIRED', { first: '1', retired: '2024-02-01' }),
      detail('ALIAS', { first: '2', alias: 'A' }),
      detail('LOT', { first: '' }),
      detail('UNSURE', { first: '4', confidence: '-1' }),
      detail('OLDSTREET', { first: '5', street: 'S4' }),
      detail('NOSTREET', { first: '6', street: 'S9' }),
      detail('NOPOINT', { first: '7' }),
      detail('BADPOINT', { first: '8' }),
      detail('OLDPOINT', { first: '9' }),
      detail('GOOD', { first: '10' }),
    ];
    const geocodes = ['RETIRED', 'ALIAS', 'LOT', 'UNSURE', 'OLDSTREET', 'NOSTREET'].map((p) => at(p)).concat([at('BADPOINT', '0', '0'), at('OLDPOINT', '153.2', '-27.5', '2023-01-01'), at('GOOD')]);
    expect((await all(gnafAddresses('QLD', tables(details, geocodes)))).map((p) => p.id)).toEqual(['GOOD']);
  });

  it("uses the suburb's postcode where the address has none, and none where neither has", async () => {
    const places = await all(gnafAddresses('QLD', tables([detail('A', { postcode: '' }), detail('B', { postcode: '', street: 'S3' })], [at('A'), at('B')])));
    expect(places.map((p) => [p.name, p.suburb, p.postcode, p.description])).toEqual([
      ['12 Wellington Street', 'Cleveland', '4163', 'Cleveland 4163'],
      ['12 Sir Samuel Griffith Drive', 'Mount Coot-Tha', null, 'Mount Coot-Tha'],
    ]);
  });

  it('hands the places over in batches', async () => {
    const details = [1, 2, 3, 4, 5].map((n) => detail(`P${n}`, { first: String(n) }));
    const batches: number[] = [];
    for await (const b of gnafAddresses('QLD', tables(details, details.map((d) => at(d[0]!))), 2)) batches.push(b.length);
    expect(batches).toEqual([2, 2, 1]);
  });

  it('reads a state from its unzipped files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-gnaf-'));
    await writeFile(join(dir, 'Authority_Code_STREET_SUFFIX_AUT_psv.psv'), 'CODE|NAME|DESCRIPTION\nN|NORTH|NORTH\n');
    await writeFile(join(dir, 'QLD_LOCALITY_psv.psv'), 'LOCALITY_PID|DATE_CREATED|DATE_RETIRED|LOCALITY_NAME|PRIMARY_POSTCODE|LOCALITY_CLASS_CODE|STATE_PID\nL1|2021-08-17||CLEVELAND|4163|G|3\n');
    await writeFile(
      join(dir, 'QLD_STREET_LOCALITY_psv.psv'),
      'STREET_LOCALITY_PID|DATE_CREATED|DATE_RETIRED|STREET_CLASS_CODE|STREET_NAME|STREET_TYPE_CODE|STREET_SUFFIX_CODE|LOCALITY_PID\nS1|2021-11-10||C|SHORE|STREET|N|L1\n',
    );
    await writeFile(
      join(dir, 'QLD_ADDRESS_DETAIL_psv.psv'),
      'ADDRESS_DETAIL_PID|DATE_RETIRED|FLAT_NUMBER|LEVEL_NUMBER|NUMBER_FIRST_PREFIX|NUMBER_FIRST|NUMBER_FIRST_SUFFIX|NUMBER_LAST|STREET_LOCALITY_PID|ALIAS_PRINCIPAL|POSTCODE|CONFIDENCE\nGAQLD9|||||18||20|S1|P|4163|2\n',
    );
    await writeFile(
      join(dir, 'QLD_ADDRESS_DEFAULT_GEOCODE_psv.psv'),
      'ADDRESS_DEFAULT_GEOCODE_PID|DATE_CREATED|DATE_RETIRED|ADDRESS_DETAIL_PID|GEOCODE_TYPE_CODE|LONGITUDE|LATITUDE\n1|2012-11-01||GAQLD9|PC|153.28|-27.52\n',
    );
    // A range ("18-20") goes under its first number.
    expect((await all(gnafAddressesFromFiles('QLD', dir))).map((p) => [p.id, p.name, p.lon, p.lat])).toEqual([['GAQLD9', '18 Shore Street North', 153.28, -27.52]]);
  });
});

describe('G-NAF files', () => {
  it('reads the named columns of a pipe-separated file, wherever they are', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-psv-'));
    const file = join(dir, 'a.psv');
    await writeFile(file, '\uFEFFA|B|C\r\n1|2|3\r\n\r\n4||6\r\n7\r\n');
    const rows: string[][] = [];
    for await (const r of readPsv(file, ['C', 'A'])) rows.push(r);
    expect(rows).toEqual([['3', '1'], ['6', '4'], ['', '7']]);
  });

  it('says which column is missing when the layout has changed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-psv-'));
    const file = join(dir, 'b.psv');
    await writeFile(file, 'A|B\n1|2\n');
    await expect((async () => { for await (const _ of readPsv(file, ['A', 'LONGITUDE'])) void _; })()).rejects.toThrow(/b\.psv has no LONGITUDE column/);
  });

  it('names the files of a state inside the zip', () => {
    expect(stateFiles('QLD')).toEqual(['QLD_ADDRESS_DETAIL_psv.psv', 'QLD_ADDRESS_DEFAULT_GEOCODE_psv.psv', 'QLD_STREET_LOCALITY_psv.psv', 'QLD_LOCALITY_psv.psv']);
  });

  it('writes names the way people do', () => {
    expect(titleCase('MOUNT COOT-THA')).toBe('Mount Coot-Tha');
    expect(titleCase("O'CONNELL STREET")).toBe("O'Connell Street");
    expect(titleCase("ST PAUL'S TERRACE")).toBe("St Paul's Terrace");
    expect(titleCase('MCDONALD ROAD')).toBe('McDonald Road');
  });
});

describe('G-NAF settings', () => {
  it('takes every state unless some are named', () => {
    expect(gnafStates('')).toEqual(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
    expect(gnafStates(' qld, NSW ,')).toEqual(['NSW', 'QLD']);
    expect(() => gnafStates('QLD, NZ')).toThrow('Unknown state(s): NZ. States: ACT, NSW, NT, QLD, SA, TAS, VIC, WA');
  });

  it('finds the current release, in the datum that lines up with GPS', () => {
    const description = {
      result: {
        resources: [
          { format: 'PDF', name: 'Release report', url: 'https://data.gov.au/report.pdf' },
          { format: 'ZIP', name: 'AUG 2026 - Geoscape G-NAF - GDA94', url: 'https://data.gov.au/g-naf_aug26_allstates_gda94_psv_110.zip' },
          { format: 'ZIP', name: 'AUG 2026 - Geoscape G-NAF - GDA2020', url: 'https://data.gov.au/g-naf_aug26_allstates_gda2020_psv_110.zip' },
        ],
      },
    };
    expect(latestRelease(description)).toEqual({ name: 'AUG 2026 - Geoscape G-NAF - GDA2020', url: 'https://data.gov.au/g-naf_aug26_allstates_gda2020_psv_110.zip' });
    expect(() => latestRelease({ result: { resources: [{ format: 'ZIP', name: 'GDA2020', url: 'http://insecure.test/a.zip' }] } })).toThrow('The G-NAF dataset lists no GDA2020 zip file');
    expect(() => latestRelease({})).toThrow(/no GDA2020 zip/);
  });
});
