import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../apps/web/vite.config';

const caddyfile = readFileSync(resolve(__dirname, '../../infra/caddy/Caddyfile'), 'utf8');

// Caddy itself is checked by using it (docs/testing.md); these keep the fixes from a security
// review of the live site from quietly going missing.
describe('web app hardening', () => {
  it('builds the web app without source maps', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
  });

  it('refuses source maps before any file is served', () => {
    const refuse = caddyfile.indexOf('handle @sourcemaps');
    expect(caddyfile).toMatch(/@sourcemaps path \*\.map\n\s*handle @sourcemaps \{\n\s*respond 404\n/);
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(caddyfile.indexOf('handle @backend'));
    expect(refuse).toBeLessThan(caddyfile.indexOf('file_server'));
  });

  it('stops other sites framing any page', () => {
    expect(caddyfile).toMatch(/Content-Security-Policy "[^"]*frame-ancestors 'none'/);
    expect(caddyfile).toMatch(/X-Frame-Options DENY/);
  });
});
