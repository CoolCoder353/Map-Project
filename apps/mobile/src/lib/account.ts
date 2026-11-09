import * as SecureStore from 'expo-secure-store';

const KEY = 'wf.accountId';
let cached: string | null | undefined;

/**
 * The account signed in on this phone. Kept in secure storage as well as memory so the
 * background location task, which can run with no screen open, knows whose points it records.
 */
export async function currentAccountId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

/** The account as last seen this run, for code that can't wait (a navigation fix every second). */
export const cachedAccountId = () => cached ?? null;

export async function setCurrentAccountId(id: string | null): Promise<void> {
  cached = id;
  try {
    if (id) await SecureStore.setItemAsync(KEY, id);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Memory still has it for this run; the next sign-in writes it again.
  }
}
