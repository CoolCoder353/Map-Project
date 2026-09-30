/**
 * Tests that need React Native or Expo modules (jest-expo + React Native Testing Library):
 * screens (*.screen.test.tsx) and device code (*.native.test.tsx). Plain logic runs in Vitest.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/test/**/*.screen.test.tsx', '<rootDir>/test/**/*.native.test.tsx'],
  // Workspace packages export TypeScript sources under the `development` condition (as for
  // Metro and Vite), and their sources import siblings with .js extensions.
  testEnvironmentOptions: { customExportConditions: ['development', 'react-native', 'require', 'default'] },
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/test/stubs/lucide.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // `pnpm test:mobile:coverage` fails below these floors (docs/testing.md). The API client and
  // upload queue are plain TypeScript tested in Vitest, and measured there.
  collectCoverageFrom: ['app/**/*.tsx', 'src/**/*.{ts,tsx}', '!src/lib/apiClient.ts', '!src/tracking/queue.ts', '!src/car/protocol.ts', '!src/car/navModel.ts', '!src/lib/categories.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'html'],
  coverageThreshold: { global: { lines: 94.7, statements: 91.2, functions: 82, branches: 89 } },
  transformIgnorePatterns: [
    // pnpm nests packages under node_modules/.pnpm/<id>/node_modules/<name>; let those through.
    'node_modules/(?!\\.pnpm|(?:jest-)?react-native[^/]*|@react-native[^/]*/|expo[^/]*|@expo[^/]*/|@maplibre/|lucide-react-native|@tanstack/)',
  ],
};
