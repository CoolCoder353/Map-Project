import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.WAYFINDER_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['development'] },
  // MapLibre 6 loads its worker relative to its own module (import.meta.url); pre-bundling breaks that.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    proxy: {
      // xfwd: the API builds absolute style URLs from X-Forwarded-Host (TRUST_PROXY=true in dev).
      '/api': { target: API, xfwd: true },
      '/tiles': { target: API, xfwd: true },
      '/map': { target: API, xfwd: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
