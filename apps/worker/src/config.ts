import { z } from 'zod';
import { GNAF_DATASET, gnafStates } from './pipeline/gnaf.js';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GRAPHHOPPER_URL: z.string().url().default('http://localhost:8989'),
  LOG_LEVEL: z.string().default('info'),
  DATA_DIR: z.string().default('/data'),
  OSM_PBF_URL: z.string().url().default('https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf'),
  GRAPHHOPPER_JAR: z.string().default('/opt/graphhopper/graphhopper-web.jar'),
  GRAPHHOPPER_CONFIG: z.string().default('/opt/graphhopper/config.yml'),
  GRAPHHOPPER_IMPORT_HEAP: z.string().default('12g'),
  PLANETILER_JAR: z.string().default('/opt/planetiler/planetiler.jar'),
  PLANETILER_HEAP: z.string().default('8g'),
  OSM_REFRESH_SKIP: z.string().default(''),
  /**
   * Where a refresh finds the current G-NAF release (street addresses for search, from
   * data.gov.au). Empty switches G-NAF off: addresses then come from OpenStreetMap alone.
   */
  GNAF_DATASET_URL: z.union([z.literal(''), z.string().url()]).default(GNAF_DATASET),
  /** The states to take G-NAF addresses for, e.g. "QLD" for a Queensland-only server. Empty: all. */
  GNAF_STATES: z.string().default('').transform((v, ctx) => {
    try {
      return gnafStates(v);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message });
      return z.NEVER;
    }
  }),
  /** Cron for the automatic monthly refresh; empty disables it. */
  OSM_REFRESH_CRON: z.string().default('0 3 2 * *'),
  /**
   * false on servers too small to build map data (an Australia import needs ~16 GB RAM): the
   * data is built elsewhere and copied in, and refresh requests are refused with a message.
   */
  OSM_REFRESH_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  DISK_PATH: z.string().default('/'),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const r = ConfigSchema.safeParse(env);
  if (!r.success) throw new Error(`Invalid configuration:\n${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}
