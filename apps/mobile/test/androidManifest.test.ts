import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = join(__dirname, '..');
const require = createRequire(import.meta.url);
const withNetworkSecurityConfig = require('../plugins/withNetworkSecurityConfig.js') as ((
  c: unknown,
  o?: { allowCleartext?: boolean },
) => unknown) & {
  networkSecurityConfigXml: (allow: boolean) => string;
};

type Manifest = {
  application: { $: Record<string, string> }[];
  'uses-permission': { $: Record<string, string> }[];
};

/** Expo's manifest after every config plugin, as the prebuild would start from it. */
function introspectManifest(env: Record<string, string> = {}): Manifest {
  const out = execFileSync(
    join(appDir, 'node_modules/.bin/expo'),
    ['config', '--type', 'introspect', '--json'],
    {
      cwd: appDir,
      encoding: 'utf8',
      env: { ...process.env, ALLOW_HTTP: '', EXPO_NO_TELEMETRY: '1', ...env },
    },
  );
  return JSON.parse(out)._internal.modResults.android.manifest.manifest as Manifest;
}

/** Permissions the built app will hold: the manifest less the removed ones. */
function permissions(m: Manifest): string[] {
  return m['uses-permission']
    .filter((p) => p.$['tools:node'] !== 'remove')
    .map((p) => p.$['android:name']!);
}

function removedPermissions(m: Manifest): string[] {
  return m['uses-permission']
    .filter((p) => p.$['tools:node'] === 'remove')
    .map((p) => p.$['android:name']!);
}

const normal = introspectManifest();
const allowHttp = introspectManifest({ ALLOW_HTTP: '1' });

describe('Android manifest', () => {
  it('can hand background locations to the recording task', () => {
    // expo-task-manager passes each batch of background locations on as a persisted job, and
    // Android rejects persisted jobs from apps without this permission: the app closed the
    // first time background tracking had a location to record, which was usually on a drive.
    expect(permissions(normal)).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  }, 60_000);

  it('asks for only the permissions the app uses', () => {
    // Overlays, and the external-storage pair expo-image-picker adds for Android 12 and lower
    // (feedback screenshots use the photo picker, which needs neither), are removed.
    const held = permissions(normal);
    for (const gone of [
      'SYSTEM_ALERT_WINDOW',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'RECORD_AUDIO',
      'WRITE_CONTACTS',
      'CAMERA',
    ]) {
      expect(held).not.toContain(`android.permission.${gone}`);
      expect(removedPermissions(normal)).toContain(`android.permission.${gone}`);
    }
    // Background tracking and navigation need these.
    for (const needed of [
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'READ_CONTACTS',
    ]) {
      expect(held).toContain(`android.permission.${needed}`);
    }
  }, 60_000);

  it('uses predictive back', () => {
    expect(normal.application[0]!.$['android:enableOnBackInvokedCallback']).toBe('true');
  });

  it('declares a network security configuration in normal builds', () => {
    const app = normal.application[0]!.$;
    expect(app['android:usesCleartextTraffic']).toBe('false');
    expect(app['android:networkSecurityConfig']).toBe('@xml/network_security_config');
  });

  it('declares the same configuration in ALLOW_HTTP builds, with cleartext on', () => {
    const app = allowHttp.application[0]!.$;
    expect(app['android:usesCleartextTraffic']).toBe('true');
    expect(app['android:networkSecurityConfig']).toBe('@xml/network_security_config');
  });
});

describe('network security configuration file', () => {
  it('refuses cleartext and trusts system authorities only, by default', () => {
    const xml = withNetworkSecurityConfig.networkSecurityConfigXml(false);
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).not.toContain('user');
    expect(xml).not.toContain('cleartextTrafficPermitted="true"');
  });

  it('permits cleartext for ALLOW_HTTP builds', () => {
    expect(withNetworkSecurityConfig.networkSecurityConfigXml(true)).toContain(
      '<base-config cleartextTrafficPermitted="true">',
    );
  });

  for (const allowCleartext of [false, true]) {
    it(`is written into the prebuild's res/xml (allowCleartext=${allowCleartext})`, async () => {
      const { compileModsAsync } =
        require('expo/config-plugins') as typeof import('expo/config-plugins');
      const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'nsc-'));
      const mainDir = join(root, 'android/app/src/main');
      mkdirSync(mainDir, { recursive: true });
      writeFileSync(
        join(mainDir, 'AndroidManifest.xml'),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:name=".MainApplication"/></manifest>',
      );
      const config = withNetworkSecurityConfig(
        { name: 'x', slug: 'x', android: { package: 'a.b' } },
        { allowCleartext },
      );
      await compileModsAsync(config as never, {
        projectRoot: root,
        platforms: ['android'],
        assertMissingModProviders: false,
      });
      expect(readFileSync(join(mainDir, 'res/xml/network_security_config.xml'), 'utf8')).toBe(
        withNetworkSecurityConfig.networkSecurityConfigXml(allowCleartext),
      );
      expect(readFileSync(join(mainDir, 'AndroidManifest.xml'), 'utf8')).toContain(
        'android:networkSecurityConfig="@xml/network_security_config"',
      );
    }, 30_000);
  }
});

describe('backup and device-transfer rules', () => {
  const xmlDir = join(appDir, 'node_modules/expo-secure-store/android/src/main/res/xml');

  it('point at the secure-store rules for Android 11 and lower and for 12 and higher', () => {
    const app = normal.application[0]!.$;
    expect(app['android:fullBackupContent']).toBe('@xml/secure_store_backup_rules');
    expect(app['android:dataExtractionRules']).toBe('@xml/secure_store_data_extraction_rules');
  });

  it('back up shared preferences only, never the sign-in token or the offline queue database', () => {
    // An include list means everything not listed is left out: the `databases` domain, where
    // wayfinder-tracking.db lives, is not listed, and the SecureStore preferences are excluded.
    for (const file of [
      'secure_store_backup_rules.xml',
      'secure_store_data_extraction_rules.xml',
    ]) {
      const xml = readFileSync(join(xmlDir, file), 'utf8');
      expect(xml).toContain('<include domain="sharedpref" path="."/>');
      expect(xml).toContain('<exclude domain="sharedpref" path="SecureStore"/>');
      expect(xml).not.toMatch(/domain="(database|file|root|external)"/);
    }
    const extraction = readFileSync(join(xmlDir, 'secure_store_data_extraction_rules.xml'), 'utf8');
    expect(extraction).toContain('<cloud-backup>');
    expect(extraction).toContain('<device-transfer>');
  });
});
