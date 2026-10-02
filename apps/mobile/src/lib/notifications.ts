import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Android 13 and up hides the app's notifications (the "Navigating to …" and recording ones, and
 * the car's turn-by-turn notification) until the person allows them. Asked when they start
 * something that shows one, never from the car. True when notifications can show.
 */
export async function askForNotifications(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  try {
    if (await PermissionsAndroid.check(permission)) return true;
    return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    // No activity to ask from (the app is in the background): carry on without.
    return false;
  }
}
