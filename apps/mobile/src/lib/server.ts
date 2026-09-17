import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const SERVER_KEY = 'wf.serverUrl';

/** The self-hosted server this app talks to (changeable on the sign-in screen). */
export async function getServerUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(SERVER_KEY);
  const fallback = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '';
  return (stored ?? fallback).replace(/\/+$/, '');
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_KEY, url.trim().replace(/\/+$/, ''));
}
