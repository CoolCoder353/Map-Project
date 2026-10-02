import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../../../infra/scripts/build-apk.sh');
const text = readFileSync(script, 'utf8');

// The script itself is checked by using it (docs/testing.md); these keep its Play bundle step from
// quietly going missing, which only shows up when someone tries to upload to Google Play.
describe('build-apk.sh', () => {
  it('is valid shell', () => {
    expect(() => execFileSync('sh', ['-n', script])).not.toThrow();
  });

  it('builds the APK and the bundle in both the signed and unsigned runs', () => {
    expect(text.match(/\.\/gradlew assembleRelease bundleRelease/g)).toHaveLength(2);
    expect(text).not.toMatch(/\.\/gradlew assembleRelease\s*(\\|$)/m);
  });

  it('copies the signed bundle to dist/wayfinder.aab', () => {
    expect(text).toContain('app/build/outputs/bundle/release/app-release.aab /workspace/dist/wayfinder.aab');
  });

  it('refuses a documentation address before building anything', () => {
    let stderr = '';
    try {
      execFileSync('sh', [script], { env: { ...process.env, EXPO_PUBLIC_API_URL: 'https://maps.example.com' }, stdio: 'pipe' });
    } catch (e) {
      stderr = String((e as { stderr: Buffer }).stderr);
    }
    expect(stderr).toContain('documentation');
  });
});
