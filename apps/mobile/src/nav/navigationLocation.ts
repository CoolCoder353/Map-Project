import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { native, type PhoneFixNative } from '../../modules/wayfinder-car';

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

let phoneFixes: { remove(): void } | null = null;

/**
 * A foreground service for the length of a trip, so directions keep coming with the phone locked
 * or in a pocket while the car shows them. Started by the person from the app, so Android allows
 * it with "while using the app" location permission alone.
 *
 * With the phone locked, expo-location hands the service's fixes over one background job each, and
 * Android 16 holds those jobs back (its job quota now counts jobs run beside a foreground service),
 * so directions stopped the moment the phone locked. The service keeps location allowed; the app's
 * own module (PhoneLocation.kt) then sends each fix straight here. The jobs' late copies of the same
 * fixes are dropped by navigation as already followed.
 */
export async function startNavigationLocation(destinationName: string | null, phone: PhoneFixNative | null = native) {
  try {
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
  } finally {
    // The service is refused with no app screen showing (a trip started from the car, phone locked).
    // Someone who allowed location all the time still gets positions from the module without it.
    if (phone && !phoneFixes) {
      phoneFixes = phone.addListener('onPhoneFix', (loc) => onFixes?.([loc]));
      if (!phone.watchPhoneLocation()) stopPhoneFixes(phone);
    }
  }
}

function stopPhoneFixes(phone: PhoneFixNative | null) {
  phoneFixes?.remove();
  phoneFixes = null;
  phone?.stopPhoneLocation();
}

export async function stopNavigationLocation(phone: PhoneFixNative | null = native) {
  stopPhoneFixes(phone);
  if (await Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(NAVIGATION_TASK);
}
