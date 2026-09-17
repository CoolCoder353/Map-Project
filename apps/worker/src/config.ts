import { z } from 'zod';

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
  /** Cron for the automatic monthly refresh; empty disables it. */
  OSM_REFRESH_CRON: z.string().default('0 3 2 * *'),
  DISK_PATH: z.string().default('/'),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const r = ConfigSchema.safeParse(env);
  if (!r.success) throw new Error(`Invalid configuration:\n${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}
