import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normaliseServerUrl } from './apiClient';

const SERVER_KEY = 'wf.serverUrl';

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
  return normaliseServerUrl(raw) ?? raw.trim().replace(/\/+$/, '');
}

/** Save the address as typed, made usable ("maps.example.com" → "https://maps.example.com"). */
export async function setServerUrl(url: string): Promise<string> {
  const clean = normaliseServerUrl(url);
  if (!clean) throw new Error('Enter your group’s server address, like maps.example.com.');
  await SecureStore.setItemAsync(SERVER_KEY, clean);
  return clean;
}
