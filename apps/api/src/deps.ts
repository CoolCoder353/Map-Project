import type { CoreContext } from '@wayfinder/core';
import type { Config } from './config.js';
import type { TileArchive } from './plugins/tiles.js';

export interface JobControl {
  retry(name: string, id: string): Promise<void>;
}

export interface AppDeps {
  ctx: CoreContext;
  config: Pick<
    Config,
    'CORS_ORIGINS' | 'COOKIE_SECURE' | 'TRUST_PROXY' | 'MAP_ASSETS_DIR' | 'RATE_LIMIT_PER_MIN' | 'AUTH_RATE_LIMIT_PER_MIN' | 'NODE_ENV'
  >;
  tiles: (TileArchive & { available(): Promise<boolean> }) | null;
  jobs: JobControl;
}
