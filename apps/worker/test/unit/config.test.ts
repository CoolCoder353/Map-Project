import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('worker configuration', () => {
  it('defaults to building Australia monthly', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toMatchObject({
      DATA_DIR: '/data',
      OSM_PBF_URL: 'https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf',
      OSM_REFRESH_CRON: '0 3 2 * *',
      OSM_REFRESH_ENABLED: true,
      GRAPHHOPPER_IMPORT_HEAP: '12g',
      DISK_PATH: '/',
    });
  });

  it('can switch refreshes off for a small server', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', OSM_REFRESH_ENABLED: 'false' }).OSM_REFRESH_ENABLED).toBe(false);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', OSM_REFRESH_ENABLED: 'no' })).toThrow(/OSM_REFRESH_ENABLED/);
  });

  it('takes G-NAF addresses for every state from data.gov.au unless told otherwise', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toMatchObject({
      GNAF_DATASET_URL: 'https://data.gov.au/data/api/3/action/package_show?id=geocoded-national-address-file-g-naf',
      GNAF_STATES: ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'],
    });
    expect(loadConfig({ DATABASE_URL: 'postgres://x', GNAF_DATASET_URL: '', GNAF_STATES: 'qld' })).toMatchObject({ GNAF_DATASET_URL: '', GNAF_STATES: ['QLD'] });
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', GNAF_STATES: 'QLD,XX' })).toThrow(/GNAF_STATES: Unknown state\(s\): XX/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', GNAF_DATASET_URL: 'data.gov.au' })).toThrow(/GNAF_DATASET_URL/);
  });

  it('requires a database', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration:\nDATABASE_URL/);
  });
});
