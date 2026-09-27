import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

/** Component tests for the web app: jsdom, a fake map and a fake API (see test/harness.tsx). */
export default defineProject({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  resolve: { conditions: ['development'] },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
  },
});
