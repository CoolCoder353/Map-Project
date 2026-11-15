import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { currentAccountId } from '../lib/account';
import { api } from '../lib/api';
import { flushQueue } from './queue';
import { sqliteQueueStore } from './sqliteStore';

let flushing: Promise<unknown> | null = null;

/** The phone's answer about the network can fail to come at all (a background wake-up); go on without it. */
const NETWORK_CHECK_MS = 10_000;
/** A run that hasn't finished by now is stuck: later ones start afresh instead of waiting on it for ever. */
const RUN_MAX_MS = 120_000;

/** [promise], or [value] if it hasn't answered within [ms] ([onTimeout] runs then). */
async function within<T, V>(promise: Promise<T>, ms: number, value: V, onTimeout?: () => void): Promise<T | V> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<V>((resolve) => {
        timer = setTimeout(() => {
          onTimeout?.();
          resolve(value);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Upload queued points if online. Safe to call often; concurrent calls share one run. */
export function syncQueue() {
  if (flushing) return flushing;
  const state = { abandoned: false };
  // A run given up on goes on in the background; it must send nothing more.
  const run = within(upload(state), RUN_MAX_MS, null, () => (state.abandoned = true)).finally(() => {
    if (flushing === run) flushing = null;
  });
  flushing = run;
  return run;
}

async function upload(state: { abandoned: boolean }) {
  const net = await within(NetInfo.fetch(), NETWORK_CHECK_MS, null);
  if (net?.isConnected === false) return null;
  // A background task may run before any screen restored the session.
  if (!api.hasAccessToken) await api.refresh();
  const account = await currentAccountId();
  if (!account) return null; // nobody signed in: nobody to send them as
  return await flushQueue(
    sqliteQueueStore,
    async (req) => {
      // The sign-in may have changed while this run waited: its points are only ever sent as the
      // account that recorded them, and never after the run was given up on.
      if (state.abandoned || (await currentAccountId()) !== account) throw new Error('Upload stopped');
      await api.request('api/tracks/batches', { method: 'POST', body: req });
    },
    () => Crypto.randomUUID(),
    account,
  );
}
