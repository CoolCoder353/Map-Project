import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  GRAPHHOPPER_URL: z.string().url().default('http://localhost:8989'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Origins allowed to call the API with credentials (comma separated). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),
  PMTILES_PATH: z.string().default('./data/australia.pmtiles'),
  MAP_ASSETS_DIR: z.string().default('../../infra/map-assets'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(600),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = ConfigSchema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return r.data;
}
