/// <reference types="jest" />
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { PhoneFixNative } from '../modules/wayfinder-car';
import { NAVIGATION_TASK, setNavigationFixHandler, startNavigationLocation, stopNavigationLocation } from '../src/nav/navigationLocation';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

type Task = (body: { data?: { locations?: unknown[] }; error?: unknown }) => Promise<void>;
const [name, task] = jest.mocked(TaskManager.defineTask).mock.calls[0] as unknown as [string, Task];

it('runs every second with a notification that says where you are going', async () => {
  await startNavigationLocation('Mt Coot-tha Lookout');
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
    NAVIGATION_TASK,
    expect.objectContaining({ timeInterval: 1000, distanceInterval: 5, deferredUpdatesInterval: 0, foregroundService: expect.objectContaining({ notificationTitle: 'Navigating to Mt Coot-tha Lookout', killServiceOnDestroy: true }) }),
  );
});

it('hands each batch of locations to navigation', async () => {
  expect(name).toBe(NAVIGATION_TASK);
  const got: unknown[][] = [];
  setNavigationFixHandler((locs) => got.push(locs));
  await task({ data: { locations: [{ a: 1 }] } });
  await task({ error: new Error('x') });
  expect(got).toEqual([[{ a: 1 }]]);
  setNavigationFixHandler(null);
});

it('stops only a service that is running', async () => {
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValueOnce(false);
  await stopNavigationLocation();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  await stopNavigationLocation();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK);
});

/** The module's phone positions: what JavaScript asked of it, and a way to play the phone's GPS. */
function fakePhone(starts = true) {
  let listener: ((loc: unknown) => void) | null = null;
  const phone = {
    watchPhoneLocation: jest.fn(() => starts),
    stopPhoneLocation: jest.fn(),
    addListener: jest.fn((_event: 'onPhoneFix', fn: (loc: unknown) => void) => {
      listener = fn;
      return { remove: () => void (listener = null) };
    }),
    fix: (loc: unknown) => listener?.(loc),
    listening: () => listener !== null,
  };
  return phone as typeof phone & PhoneFixNative;
}

// Android 16 holds back the background jobs expo-location hands a locked phone's fixes through, so
// the car's directions stopped as soon as the phone locked. The module's own listener sends them straight.
it('hands navigation the phone’s positions straight from the module, which keep coming with the phone locked', async () => {
  const phone = fakePhone();
  const got: unknown[][] = [];
  setNavigationFixHandler((locs) => got.push(locs));
  await startNavigationLocation('Mt Coot-tha Lookout', phone);
  expect(phone.addListener).toHaveBeenCalledWith('onPhoneFix', expect.any(Function));
  expect(phone.watchPhoneLocation).toHaveBeenCalledTimes(1);
  phone.fix({ timestamp: 1, coords: { longitude: 153, latitude: -27.4 } });
  expect(got).toEqual([[{ timestamp: 1, coords: { longitude: 153, latitude: -27.4 } }]]);
  await stopNavigationLocation(phone);
  expect(phone.stopPhoneLocation).toHaveBeenCalled();
  expect(phone.listening()).toBe(false);
  phone.fix({ timestamp: 2, coords: { longitude: 153, latitude: -27.4 } });
  expect(got).toHaveLength(1);
  setNavigationFixHandler(null);
});

it('listens once however often the trip asks', async () => {
  const phone = fakePhone();
  await startNavigationLocation(null, phone);
  await startNavigationLocation(null, phone);
  expect(phone.watchPhoneLocation).toHaveBeenCalledTimes(1);
  await stopNavigationLocation(phone);
});

it('stops listening when the module can’t give positions', async () => {
  const phone = fakePhone(false);
  await startNavigationLocation(null, phone);
  expect(phone.listening()).toBe(false);
  await stopNavigationLocation(phone);
});

it('leaves the module alone when the location service doesn’t start', async () => {
  const phone = fakePhone();
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(new Error('not allowed from the background'));
  await expect(startNavigationLocation(null, phone)).rejects.toThrow();
  expect(phone.watchPhoneLocation).not.toHaveBeenCalled();
});
