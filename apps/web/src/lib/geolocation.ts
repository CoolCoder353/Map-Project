import type { LngLat } from '@wayfinder/shared';

export function currentPosition(timeoutMs = 8000): Promise<LngLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      (err) =>
        reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission was denied' : 'Couldn’t get your location')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
