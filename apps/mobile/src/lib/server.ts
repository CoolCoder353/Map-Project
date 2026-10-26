import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normaliseServerUrl } from './apiClient';

const SERVER_KEY = 'wf.serverUrl';

// Servers that have moved, old address → new. Sign-in saves the address, so without this a phone
// that signed in before a move keeps asking the old one after updating. Same server, so the saved
// sign-in still works.
const MOVED: Record<string, string> = {
  'https://maps.paulsjones.com': 'https://maps.coolcodertech.com',
};

/** The self-hosted server this app talks to (changeable on the sign-in screen). */
export async function getServerUrl(): Promise<string> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(SERVER_KEY);
  } catch {
    // Unreadable storage (it happens after a phone restore): fall back to the built-in address.
  }
  const raw = stored ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '';
  // Addresses saved by older versions may lack "https://"; the client refuses anything unusable.
  const url = normaliseServerUrl(raw) ?? raw.trim().replace(/\/+$/, '');
  const moved = MOVED[url];
  if (moved && stored) await SecureStore.setItemAsync(SERVER_KEY, moved).catch(() => undefined);
  return moved ?? url;
}

/** Save the address as typed, made usable ("maps.example.com" → "https://maps.example.com"). */
export async function setServerUrl(url: string): Promise<string> {
  const clean = normaliseServerUrl(url);
  if (!clean) throw new Error('Enter your group’s server address, like maps.example.com.');
  const current = MOVED[clean] ?? clean;
  await SecureStore.setItemAsync(SERVER_KEY, current);
  return current;
}
