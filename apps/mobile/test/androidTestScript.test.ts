import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../../../infra/scripts/test-android-native.sh');
const text = readFileSync(script, 'utf8');

// The script is checked by using it (docs/testing.md); these keep the fast loop from quietly
// going missing: the prepare stamp, the test filter and the restore of this machine's node_modules.
describe('test-android-native.sh', () => {
  it('is valid shell', () => {
    expect(() => execFileSync('sh', ['-n', script])).not.toThrow();
  });

  it('passes extra arguments to the Gradle test task', () => {
    expect(text).toMatch(/testDebugUnitTest[^\n]*"\$@"/);
    expect(text).toMatch(/_ "\$@"/);
  });

  it('drops the leading -- that pnpm may hand on', () => {
    expect(text).toMatch(/\[ "\$\{1:-\}" = -- \] && shift/);
  });

  it('skips the install and prebuild only when the stamp matches', () => {
    expect(text).toContain('.prepare-stamp');
    for (const input of ['pnpm-lock.yaml', 'apps/mobile/app.json', 'wayfinder-car/android/build.gradle']) {
      expect(text).toContain(input);
    }
    expect(text).toMatch(/if \[ "\$\(cat [^\n]*\.prepare-stamp[^\n]*\)" != "\$STAMP" \]/);
    const prepare = text.indexOf('if [ "$(cat');
    expect(prepare).toBeGreaterThan(-1);
    expect(text.indexOf('expo prebuild')).toBeGreaterThan(prepare);
    expect(text.indexOf('expo prebuild')).toBeLessThan(text.indexOf('./gradlew'));
  });

  it('writes the stamp only after a successful prepare', () => {
    expect(text.indexOf('expo prebuild')).toBeLessThan(text.indexOf('> apps/mobile/android/.prepare-stamp'));
  });

  it('checks the coverage floor on a full run only, and copies the report out either way', () => {
    expect(text).toContain('jacocoCarCoverageVerification');
    expect(text).toMatch(/if \[ "\$#" -eq 0 \]/);
    expect(text).toContain('apps/mobile/coverage-android');
    expect(text.indexOf('jacocoCarCoverageVerification')).toBeLessThan(text.indexOf('coverage-android'));
  });

  it('puts this machine\'s node_modules back whether or not the tests pass', () => {
    expect(text).toContain('|| status=$?');
    expect(text.indexOf('|| status=$?')).toBeLessThan(text.indexOf('pnpm install --frozen-lockfile >/dev/null'));
    expect(text).toContain('exit "$status"');
  });
});

describe('wayfinder-car build.gradle', () => {
  const gradle = readFileSync(resolve(__dirname, '../modules/wayfinder-car/android/build.gradle'), 'utf8');

  it('measures coverage of the Robolectric tests', () => {
    expect(gradle).toContain("id 'jacoco'");
    expect(gradle).toContain('includeNoLocationClasses = true');
  });

  it('has a verification rule on lines and branches', () => {
    expect(gradle).toContain("tasks.register('jacocoCarCoverageVerification'");
    expect(gradle).toMatch(/counter = 'LINE'\s+minimum = 0\.\d+/);
    expect(gradle).toMatch(/counter = 'BRANCH'\s+minimum = 0\.\d+/);
  });

  it('excludes only generated code and the React boot glue', () => {
    const excluded = [...gradle.matchAll(/'(\*\*\/[^']+)'/g)].map((m) => m[1]);
    expect(excluded).toEqual(['**/R.class', '**/R$*.class', '**/BuildConfig.*', '**/bridge/ReactBoot*']);
  });
});
