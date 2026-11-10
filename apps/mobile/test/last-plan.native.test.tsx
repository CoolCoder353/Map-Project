/// <reference types="jest" />
import { LAST_PLAN_KEEP_MS, loadLastPlan, saveLastPlan } from '../src/lib/lastPlan';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

const to = { name: 'Bunnings Warehouse', description: 'Hardware store', location: [153.28, -27.58] as [number, number] };
const here = { name: 'Your location', description: '', location: [153.25, -27.56] as [number, number], current: true };

beforeEach(() => mockStore.clear());

it('keeps the trip planned for a while, without "Your location" (U2)', async () => {
  await saveLastPlan({ from: here, to, mode: 'car' }, 1000);
  expect(await loadLastPlan(2000)).toEqual({ to, mode: 'car', at: 1000 });
  expect(await loadLastPlan(1000 + LAST_PLAN_KEEP_MS + 1)).toBeNull();
});

it('keeps a start chosen by name, and forgets the trip once the destination is cleared', async () => {
  const start = { name: 'Cleveland', description: 'Suburb', location: [153.26, -27.52] as [number, number] };
  await saveLastPlan({ from: start, to, mode: 'foot' }, 1000);
  expect(await loadLastPlan(1000)).toEqual({ from: start, to, mode: 'foot', at: 1000 });
  await saveLastPlan({ from: start, to: null, mode: 'foot' }, 2000);
  expect(await loadLastPlan(2000)).toBeNull();
});

it('ignores what it can’t read', async () => {
  mockStore.set('wayfinder.lastPlan', '{not json');
  expect(await loadLastPlan()).toBeNull();
  mockStore.set('wayfinder.lastPlan', JSON.stringify({ to: { name: 'x' }, mode: 'car', at: Date.now() }));
  expect(await loadLastPlan()).toBeNull();
});
