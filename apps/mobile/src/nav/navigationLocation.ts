import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const NAVIGATION_TASK = 'wayfinder-navigation-location';

let onFixes: ((locs: Location.LocationObject[]) => void) | null = null;

// Must be defined at module scope so Android can hand it locations (see tracking/background.ts).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(NAVIGATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  onFixes?.(data.locations);
});

/** Where the navigation session takes these fixes. */
export function setNavigationFixHandler(fn: ((locs: Location.LocationObject[]) => void) | null) {
  onFixes = fn;
}

/**
 * A foreground service for the length of a trip, so directions keep coming with the phone locked
 * or in a pocket while the car shows them. Started by the person from the app, so Android allows
 * it with "while using the app" location permission alone.
 */
export async function startNavigationLocation(destinationName: string | null) {
  await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: destinationName ? `Navigating to ${destinationName}` : 'Navigating',
      notificationBody: 'Directions keep going with the screen off.',
      notificationColor: '#1765cc',
      killServiceOnDestroy: true,
    },
  });
}

export async function stopNavigationLocation() {
  if (await Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(NAVIGATION_TASK);
}
