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
});
