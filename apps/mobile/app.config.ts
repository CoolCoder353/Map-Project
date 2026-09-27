import type { ExpoConfig } from 'expo/config';

// Display name on the home screen. The in-app name comes from the server's admin settings.
const config: ExpoConfig = {
  name: process.env.APP_DISPLAY_NAME ?? 'Wayfinder',
  slug: 'wayfinder',
  scheme: 'wayfinder',
  version: '0.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'app.wayfinder.maps',
    versionCode: 2,
    adaptiveIcon: { backgroundColor: '#1765cc' },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ],
    // The contacts plugin asks for write access as well; the app only ever reads.
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.WRITE_CONTACTS'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    '@maplibre/maplibre-react-native',
    // Feedback screenshots come from the system photo picker; no camera or microphone.
    ['expo-contacts', { contactsPermission: 'Wayfinder can look up an address saved with one of your contacts when you search for their name. Contacts stay on your phone.' }],
    ['expo-image-picker', { photosPermission: 'Wayfinder lets you attach a screenshot to feedback.', cameraPermission: false, microphonePermission: false }],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Wayfinder records where you travel so it can suggest places you haven’t been. You can turn this off at any time in Settings.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ['expo-build-properties', { android: { minSdkVersion: 26, usesCleartextTraffic: process.env.ALLOW_HTTP === '1' } }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    // The server this build talks to, pre-filled on the sign-in screen and changeable there.
    // Empty when unset: an empty box asks the user for an address, where a placeholder would
    // quietly send every request to a domain that isn't theirs.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  },
};

export default config;
