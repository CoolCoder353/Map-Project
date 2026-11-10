/// <reference types="jest" />
import { currentAccountId, setCurrentAccountId } from '../src/lib/account';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

it('forgets the trip planned on signing out, so the next account never sees it', async () => {
  await setCurrentAccountId('u1');
  mockStore.set('wayfinder.lastPlan', '{"account":"u1"}');
  await setCurrentAccountId(null);
  expect(mockStore.has('wayfinder.lastPlan')).toBe(false);
  expect(await currentAccountId()).toBeNull();
});
