import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

/** Light or dark for the app and its maps, or the phone's own setting (P58). */
export type AppearanceChoice = 'auto' | 'light' | 'dark';

const KEY = 'wayfinder_appearance';
let current: AppearanceChoice = 'auto';

const apply = (c: AppearanceChoice) => Appearance.setColorScheme(c === 'auto' ? 'unspecified' : c);

export const appearance = (): AppearanceChoice => current;

/** Chosen in Settings: applied at once and kept for next time. */
export async function setAppearance(c: AppearanceChoice): Promise<void> {
  current = c;
  apply(c);
  await SecureStore.setItemAsync(KEY, c).catch(() => undefined);
}

/** At start-up: the choice last made, if any. */
export async function restoreAppearance(): Promise<void> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (saved === 'light' || saved === 'dark' || saved === 'auto') {
    current = saved;
    apply(saved);
  }
}
