import type { ExpoConfig } from 'expo/config';

// Display name on the home screen. The in-app name comes from the server's admin settings.
const config: ExpoConfig = {
  name: process.env.APP_DISPLAY_NAME ?? 'Wayfinder',
  slug: 'wayfinder',
  scheme: 'wayfinder',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'app.wayfinder.maps',
    versionCode: 1,
    adaptiveIcon: { backgroundColor: '#1765cc' },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    '@maplibre/maplibre-react-native',
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
    // Default server; users can change it on the sign-in screen.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://maps.example.com',
  },
};

export default config;
