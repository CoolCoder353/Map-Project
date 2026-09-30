import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import type { LngLat } from '@wayfinder/shared/geo';
import { PublicConfigSchema } from '@wayfinder/shared/schemas';
import * as Location from 'expo-location';
import { api, hasSavedSession } from '../lib/api';
import { isServerUrl } from '../lib/apiClient';
import { getServerUrl } from '../lib/server';
import type { CarHandlers } from './controller';
import type { CarStatus } from './protocol';

let copyCache: CopyCatalog | null = null;

/** The server's chosen voice for words shown in the car; plain until the server says. */
async function copy(): Promise<CopyCatalog> {
  if (copyCache) return copyCache;
  try {
    copyCache = copyFor((await api.request('api/config', { schema: PublicConfigSchema })).voice);
    return copyCache;
  } catch {
    return copyFor('plain');
  }
}

/** Where the phone is, or null without permission or any fix. Never prompts: the car can't. */
async function here(fresh = false): Promise<LngLat | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: fresh ? 60_000 : 10 * 60_000 });
    const loc = last ?? (fresh ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }) : null);
    return loc ? [loc.coords.longitude, loc.coords.latitude] : null;
  } catch {
    return null;
  }
}

/** Forget cached words between tests. */
export function resetCarHandlers() {
  copyCache = null;
}

export const carHandlers: CarHandlers = {
  async status(): Promise<CarStatus> {
    const signedIn = api.hasAccessToken || !!(await api.refresh());
    const account = signedIn ? 'signedIn' : (await hasSavedSession()) ? 'offline' : 'signedOut';
    const base = await getServerUrl();
    return {
      account,
      styleUrl: isServerUrl(base) ? { light: `${base}/map/style.json?theme=light`, dark: `${base}/map/style.json?theme=dark` } : null,
      searchHint: (await copy()).searchPlaceholder,
      here: await here(),
    };
  },
};
