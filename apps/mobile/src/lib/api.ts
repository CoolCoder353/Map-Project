import * as SecureStore from 'expo-secure-store';
import type { AuthResponse } from '@wayfinder/shared/schemas';
import { createApiClient } from './apiClient';
import { getServerUrl } from './server';

const REFRESH_KEY = 'wf.refreshToken';
type Listener = (auth: AuthResponse | null) => void;
const listeners = new Set<Listener>();

export const onSession = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Singleton client shared by screens and the background tracking task. */
export const api = createApiClient({
  baseUrl: getServerUrl,
  tokens: {
    getRefreshToken: () => SecureStore.getItemAsync(REFRESH_KEY),
    setRefreshToken: async (t) => {
      if (t) await SecureStore.setItemAsync(REFRESH_KEY, t);
      else await SecureStore.deleteItemAsync(REFRESH_KEY);
    },
  },
  onSession: (auth) => listeners.forEach((l) => l(auth)),
});

export { ApiError, errorMessage } from './apiClient';
