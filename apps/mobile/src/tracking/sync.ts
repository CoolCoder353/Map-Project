import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { currentAccountId } from '../lib/account';
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
      const account = await currentAccountId();
      if (!account) return null; // nobody signed in: nobody to send them as
      return await flushQueue(
        sqliteQueueStore,
        (req) => api.request('api/tracks/batches', { method: 'POST', body: req }),
        () => Crypto.randomUUID(),
        account,
      );
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
