/** Screen tests for the Expo app (jest-expo + React Native Testing Library). */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEach: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/test/**/*.screen.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@maplibre/.*|lucide-react-native)/)',
  ],
};
