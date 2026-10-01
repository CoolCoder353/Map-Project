/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import { startCarController, startCarNavigationFeed } from '../src/car/controller';
import { fakeCarNative } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/nav/navigationService', () => ({ navigation: { subscribe: () => () => undefined, getSnapshot: () => ({ active: false }) } }));

it('tells the car it is listening, then answers', async () => {
  const car = fakeCarNative();
  const stop = startCarController({ echo: async (p) => p }, car as never);
  expect(car.ready).toHaveBeenCalled();
  const id = car.ask('echo', { a: 1 });
  await waitFor(() => expect(car.answerTo(id)).toEqual({ a: 1 }));
  stop();
  car.ask('echo');
  expect(car.resolve).toHaveBeenCalledTimes(1);
});

it('turns a failure into words the car can show', async () => {
  const car = fakeCarNative();
  startCarController({ search: async () => { throw new Error('Can’t reach your server.'); } }, car as never);
  const id = car.ask('search', { q: 'x' });
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, 'Can’t reach your server.'));
});

it('says so when the car asks for something this build doesn’t do', async () => {
  const car = fakeCarNative();
  startCarController({}, car as never);
  const id = car.ask('teleport');
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, expect.stringMatching(/update Wayfinder/)));
});

it('does nothing where there is no car app (Expo Go, tests)', () => {
  expect(startCarController({ echo: async () => 1 }, null)()).toBeUndefined();
});

it('falls back to the real native module when none is given', () => {
  // No car app in Jest (test/setup.ts mocks it to null), so this exercises the default parameter
  // the same way apps/mobile/index.ts calls startCarController(carHandlers) at boot.
  expect(startCarController({ echo: async () => 1 })()).toBeUndefined();
});

it('keeps the car up to date with navigation, and clears it when the trip ends', () => {
  const car = fakeCarNative();
  let snap: Record<string, unknown> = { active: false, route: null };
  const listeners = new Set<() => void>();
  const nav = { getSnapshot: () => snap as never, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) };
  const stop = startCarNavigationFeed(car as never, nav as never, () => 0);
  expect(car.setNavigation).toHaveBeenLastCalledWith(null);
  snap = { active: true, route: { id: 'r1', distanceM: 1000, durationS: 60, instructions: [] }, destinationName: 'Lookout', state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null };
  listeners.forEach((l) => l());
  expect(JSON.parse(car.setNavigation.mock.calls.at(-1)![0] as string)).toMatchObject({ routeId: 'r1', status: 'starting' });
  stop();
  expect(listeners.size).toBe(0);
});

it('sends no navigation where there is no car app', () => {
  expect(startCarNavigationFeed(null)()).toBeUndefined();
  // The default arguments, as apps/mobile/index.ts calls it at boot.
  expect(startCarNavigationFeed()()).toBeUndefined();
});
