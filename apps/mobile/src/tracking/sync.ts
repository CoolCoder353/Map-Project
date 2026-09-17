import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { api } from '../lib/api';
import { flushQueue } from './queue';
import { sqliteQueueStore } from './sqliteStore';

let flushing: Promise<unknown> | null = null;

/** Upload queued points if online. Safe to call often; concurrent calls share one run. */
export function syncQueue() {
  flushing ??= (async () => {
    try {
      const net = await NetInfo.fetch();
      if (net.isConnected === false) return null;
      // A background task may run before any screen restored the session.
      if (!api.hasAccessToken) await api.refresh();
      return await flushQueue(
        sqliteQueueStore,
        (req) => api.request('api/tracks/batches', { method: 'POST', body: req }),
        () => Crypto.randomUUID(),
      );
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
