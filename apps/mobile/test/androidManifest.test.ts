import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = join(__dirname, '..');

/** Permissions the built app will hold: Expo's manifest after every config plugin, less the removed ones. */
function manifestPermissions(): string[] {
  const out = execFileSync(join(appDir, 'node_modules/.bin/expo'), ['config', '--type', 'introspect', '--json'], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
  });
  const entries = JSON.parse(out)._internal.modResults.android.manifest.manifest['uses-permission'] as { $: Record<string, string> }[];
  return entries.filter((p) => p.$['tools:node'] !== 'remove').map((p) => p.$['android:name']!);
}

describe('Android manifest', () => {
  it('can hand background locations to the recording task', () => {
    // expo-task-manager passes each batch of background locations on as a persisted job, and
    // Android rejects persisted jobs from apps without this permission: the app closed the
    // first time background tracking had a location to record, which was usually on a drive.
    expect(manifestPermissions()).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  }, 60_000);
});
