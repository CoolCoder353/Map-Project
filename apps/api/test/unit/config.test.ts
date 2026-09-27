import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const required = { DATABASE_URL: 'postgres://x', JWT_SECRET: 's'.repeat(32) };

describe('API configuration', () => {
  it('fills in defaults', () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      GRAPHHOPPER_URL: 'http://localhost:8989',
      PUBLIC_WEB_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://localhost:5173',
      COOKIE_SECURE: false,
      TRUST_PROXY: false,
      PMTILES_PATH: './data/australia.pmtiles',
      RATE_LIMIT_PER_MIN: 600,
      AUTH_RATE_LIMIT_PER_MIN: 10,
    });
    expect(loadConfig(required).PUBLIC_ORIGIN).toBeUndefined();
  });

  it('reads flags as true/false or 1/0, and numbers from strings', () => {
    expect(loadConfig({ ...required, COOKIE_SECURE: 'true', TRUST_PROXY: '1', PORT: '8080' })).toMatchObject({ COOKIE_SECURE: true, TRUST_PROXY: true, PORT: 8080 });
    expect(loadConfig({ ...required, COOKIE_SECURE: '0' }).COOKIE_SECURE).toBe(false);
  });

  it('names every problem at once', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short', GRAPHHOPPER_URL: 'not a url', TRUST_PROXY: 'yes' })).toThrow(
      /Invalid configuration:\nDATABASE_URL: .*\nJWT_SECRET: JWT_SECRET must be at least 32 characters\nGRAPHHOPPER_URL: .*\nTRUST_PROXY: /s,
    );
  });
});
