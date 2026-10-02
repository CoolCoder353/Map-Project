import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const moduleDir = join(__dirname, '../modules/wayfinder-car/android');

describe('Android Auto module', () => {
  it('declares a navigation app Android Auto will list', () => {
    const manifest = readFileSync(join(moduleDir, 'src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('<action android:name="androidx.car.app.CarAppService" />');
    expect(manifest).toContain('<category android:name="androidx.car.app.category.NAVIGATION" />');
    expect(manifest).toContain('android:name="androidx.car.app.NAVIGATION_TEMPLATES"');
    expect(manifest).toContain('android:name="androidx.car.app.ACCESS_SURFACE"');
    expect(manifest).toContain('android:name="com.google.android.gms.car.application"');
    expect(manifest).toContain('android:name="androidx.car.app.minCarApiLevel"');
  });

  it('draws the car map with the same MapLibre Native as the phone map', () => {
    const gradle = readFileSync(join(moduleDir, 'build.gradle'), 'utf8');
    const props = readFileSync(join(__dirname, '../node_modules/@maplibre/maplibre-react-native/android/gradle.properties'), 'utf8');
    const phone = /org\.maplibre\.reactnative\.nativeVersion=(\S+)/.exec(props)![1];
    const variant = /org\.maplibre\.reactnative\.nativeVariant=(\S+)/.exec(props)![1];
    expect(gradle).toContain(`def maplibreVersion = '${phone}'`);
    expect(gradle).toContain(`org.maplibre.gl:android-sdk-${variant}:`);
  });

  it('asks the phone only for things the JavaScript side answers', () => {
    const kotlin = readFileSync(join(moduleDir, 'src/main/java/app/wayfinder/car/bridge/BridgeCarApi.kt'), 'utf8');
    const handlers = readFileSync(join(__dirname, '../src/car/handlers.ts'), 'utf8');
    const sent = [...kotlin.matchAll(/(?:ask|bridge\.call)\("(\w+)"/g)].map((m) => m[1]!);
    expect(sent.length).toBeGreaterThan(0);
    for (const method of sent) expect(handlers, method).toMatch(new RegExp(`^  (async )?${method}\\(`, 'm'));
  });

  it('handles navigate requests from Google Assistant and other apps (geo: links)', () => {
    const manifest = readFileSync(join(moduleDir, 'src/main/AndroidManifest.xml'), 'utf8');
    const service = manifest.slice(manifest.indexOf('<service'), manifest.indexOf('</service>'));
    const filters = [...service.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]!);
    const navigate = filters.find((f) => f.includes('androidx.car.app.action.NAVIGATE'));
    expect(navigate, 'a navigate intent filter on the car service').toBeDefined();
    expect(navigate).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(navigate).toContain('<data android:scheme="geo" />');
    // The car service filter is still there beside it.
    expect(filters.some((f) => f.includes('androidx.car.app.CarAppService'))).toBe(true);
  });

  it('reads the intent that opened the car app and ones that arrive later', () => {
    const session = readFileSync(join(moduleDir, 'src/main/java/app/wayfinder/car/WayfinderSession.kt'), 'utf8');
    expect(session).toContain('override fun onNewIntent(intent: Intent)');
    expect(session).toMatch(/navigate\.handle\(intent\)/);
    expect(session).toMatch(/requests\?\.handle\(intent\)/);
  });

  it('turns the geo: latitude,longitude order into [lon, lat] in one place only', () => {
    const intents = readFileSync(join(moduleDir, 'src/main/java/app/wayfinder/car/nav/NavigateIntents.kt'), 'utf8');
    expect(intents.match(/LngLat\(/g)!.length).toBeGreaterThan(0);
    expect(intents).not.toMatch(/LngLat\(lat\s*[,=]/);
  });

  it('posts a navigation notification the car can show', () => {
    const src = readFileSync(join(moduleDir, 'src/main/java/app/wayfinder/car/nav/NavNotifications.kt'), 'utf8');
    for (const part of ['.setOngoing(true)', '.setOnlyAlertOnce(true)', 'CATEGORY_NAVIGATION', 'CarAppExtender.Builder()', 'IMPORTANCE_HIGH']) expect(src).toContain(part);
  });

  it('answers the host’s auto drive with a test drive the phone side handles', () => {
    const coordinator = readFileSync(join(moduleDir, 'src/main/java/app/wayfinder/car/nav/NavigationCoordinator.kt'), 'utf8');
    expect(coordinator).toContain('override fun onAutoDriveEnabled()');
    expect(coordinator).toContain('api.simulate');
  });
});
