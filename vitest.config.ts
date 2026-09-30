import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    // `pnpm test:coverage` fails if coverage drops below these floors. Raise them as tests are
    // added; never lower them to make a change pass (docs/testing.md).
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'apps/mobile/src/lib/apiClient.ts', 'apps/mobile/src/tracking/queue.ts', 'apps/mobile/src/car/protocol.ts', 'apps/mobile/src/car/navModel.ts', 'apps/mobile/src/lib/categories.ts'],
      exclude: [
        '**/index.ts',
        '**/*.d.ts',
        // Process entry points: started by the e2e stack and the Docker images, not unit-testable.
        'apps/api/src/server.ts',
        'apps/api/src/cli.ts',
        'apps/worker/src/main.ts',
        'apps/worker/src/refresh-cli.ts',
        'apps/worker/src/pipeline/import-places-cli.ts',
        'apps/web/src/main.tsx',
      ],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 96, statements: 93, functions: 92, branches: 86 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/{api,worker}/test/unit/**/*.test.ts', 'apps/mobile/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/test/integration/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/core/test/integration/**/*.test.ts', 'apps/{api,worker}/test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      'apps/web/vitest.config.ts',
    ],
  },
});
