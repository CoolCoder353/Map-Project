import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { isNavigationRecording } from './navigationRecording';
import { sqliteQueueStore } from './sqliteStore';
import { syncQueue } from './sync';

export const BACKGROUND_TASK = 'wayfinder-background-location';

// Must be defined at module scope and imported from the root layout so Android can wake it.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  // A navigated trip is recording these same moments itself.
  if (isNavigationRecording()) return;
  try {
    await sqliteQueueStore.append(
      data.locations
        .filter((l) => l?.coords && Number.isFinite(l.coords.longitude) && Number.isFinite(l.coords.latitude))
        .map((l) => ({
          ts: l.timestamp,
          lon: l.coords.longitude,
          lat: l.coords.latitude,
          accuracyM: l.coords.accuracy ?? null,
          speedMps: l.coords.speed ?? null,
          headingDeg: l.coords.heading ?? null,
          source: 'background' as const,
          mode: null,
          sessionId: null,
        })),
    );
    if ((await sqliteQueueStore.count()) >= 50) await syncQueue();
  } catch {
    // Storage or upload failed while the app was in the background; the next wake-up retries.
  }
});

export type TrackingPermission = 'granted' | 'foreground-only' | 'denied';

export async function trackingPermission(): Promise<TrackingPermission> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted ? 'granted' : 'foreground-only';
}

/** Android asks for "while using" first, then separately for "Allow all the time". */
export async function requestTrackingPermission(): Promise<TrackingPermission> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted ? 'granted' : 'foreground-only';
}

export async function isTrackingRunning() {
  return Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK).catch(() => false);
}

export async function startBackgroundTracking(appName: string) {
  if (await isTrackingRunning()) return;
  await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
    // Battery-conscious: balanced accuracy, a fix every ~25 m, delivered in batches.
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 25,
    timeInterval: 15_000,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: `${appName} is recording your travels`,
      notificationBody: 'Turn this off any time in Settings.',
      notificationColor: '#1765cc',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopBackgroundTracking() {
  if (await isTrackingRunning()) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
  await syncQueue().catch(() => undefined);
}

/** Bring the device in line with the account setting. */
export async function reconcileTracking(enabled: boolean, appName: string) {
  if (enabled && (await trackingPermission()) === 'granted') await startBackgroundTracking(appName);
  if (!enabled) await stopBackgroundTracking();
}
