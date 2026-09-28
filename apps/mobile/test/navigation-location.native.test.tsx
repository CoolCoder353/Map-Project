/// <reference types="jest" />
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
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
