import { type AppSettings, AppSettingsSchema, DEFAULT_APP_SETTINGS } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { getAppState, setAppState } from './admin.js';

export const APP_SETTINGS_KEY = 'app.settings';

export async function getAppSettings(db: DbClient): Promise<AppSettings> {
  const stored = await getAppState<Partial<AppSettings>>(db, APP_SETTINGS_KEY);
  const merged = { ...DEFAULT_APP_SETTINGS, ...(stored?.value ?? {}) };
  const parsed = AppSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

export async function updateAppSettings(db: DbClient, patch: Partial<AppSettings>): Promise<{ before: AppSettings; after: AppSettings }> {
  const before = await getAppSettings(db);
  const after = AppSettingsSchema.parse({ ...before, ...patch });
  await setAppState(db, APP_SETTINGS_KEY, after);
  return { before, after };
}
