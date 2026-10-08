import type { ExpoConfig } from 'expo/config';

// Display name on the home screen. The in-app name comes from the server's admin settings.
const config: ExpoConfig = {
  name: process.env.APP_DISPLAY_NAME ?? 'Wayfinder',
  slug: 'wayfinder',
  scheme: 'wayfinder',
  version: '0.5.0',
  icon: './assets/icons/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'app.wayfinder.maps',
    versionCode: 6,
    adaptiveIcon: {
      foregroundImage: './assets/icons/adaptive-foreground.png',
      monochromeImage: './assets/icons/adaptive-monochrome.png',
      backgroundColor: '#1765cc',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      // Background locations reach the recording task as persisted jobs, which Android refuses
      // (closing the app) without this.
      'RECEIVE_BOOT_COMPLETED',
    ],
    // The contacts plugin asks for write access as well; the app only ever reads.
    // Also blocked: SYSTEM_ALERT_WINDOW (Expo template; no overlays) and the external-storage pair
    // (expo-image-picker declares them for Android 12 and lower, but the photo picker we use
    // needs neither). Biometric permissions come from expo-secure-store and are left alone.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.WRITE_CONTACTS',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    // Android 13+ back gesture previews. The Expo template opts out; nothing in app/ or src/
    // intercepts back by hand (no BackHandler), so the system callback is safe to use.
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-screen-orientation',
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
    // Refuse cleartext in normal builds; ALLOW_HTTP=1 test builds may reach a local http server.
    ['./plugins/withNetworkSecurityConfig', { allowCleartext: process.env.ALLOW_HTTP === '1' }],
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
