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

  it('requires a database', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration:\nDATABASE_URL/);
  });
});
