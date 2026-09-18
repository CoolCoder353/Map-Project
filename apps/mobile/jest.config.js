/** Screen tests for the Expo app (jest-expo + React Native Testing Library). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.screen.test.tsx'],
  // Workspace packages export TypeScript sources under the `development` condition (as for
  // Metro and Vite), and their sources import siblings with .js extensions.
  testEnvironmentOptions: { customExportConditions: ['development', 'react-native', 'require', 'default'] },
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/test/stubs/lucide.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    // pnpm nests packages under node_modules/.pnpm/<id>/node_modules/<name>; let those through.
    'node_modules/(?!\\.pnpm|(?:jest-)?react-native[^/]*|@react-native[^/]*/|expo[^/]*|@expo[^/]*/|@maplibre/|lucide-react-native|@tanstack/)',
  ],
};
