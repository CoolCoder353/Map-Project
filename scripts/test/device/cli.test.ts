import { describe, expect, it } from 'vitest';
import { run } from '../../device/cli.js';
import { ROOT, TEST_EMAIL, planScreen, sent, settings, signIn, world } from './fakes.js';

const logged = (w: ReturnType<typeof world>) => {
  const lines: string[] = [];
  w.deps.log = (l) => void lines.push(l);
  return lines;
};
const session = (w: ReturnType<typeof world>) => JSON.parse(w.files.get(`${ROOT}/.harness/session.json`) ?? 'null');

describe('setting up', () => {
  it('prints how to use it without touching any device', async () => {
    const w = world();
    const lines = logged(w);
    expect(await run([], w.deps)).toBe(0);
    expect(await run(['wipe'], w.deps)).toBe(1);
    expect(lines[0]).toContain('Usage: pnpm device');
    expect(w.calls).toHaveLength(0);
  });

  it('registers a phone and the test account', async () => {
    const w = world();
    w.files.clear();
    expect(await run(['register', 'R5CT9999'], w.deps)).toBe(0);
    expect(await run(['account', 'tester@example.test'], w.deps)).toBe(0);
    expect(JSON.parse(w.files.get(`${ROOT}/.harness/config.json`)!)).toEqual({ testAccountEmail: 'tester@example.test', phones: ['R5CT9999'] });
  });

  it('starts only when Wayfinder is signed in to the test account', async () => {
    const w = world();
    expect(await run(['up'], w.deps)).toBe(0);
    expect(sent(w)).toContain("shell am start -a android.intent.action.VIEW -d 'wayfinder:///settings' app.wayfinder.maps");
    expect(session(w)).toMatchObject({ serial: 'R5CT1234', account: TEST_EMAIL, dhu: null });
  });

  it('touches nothing when the app is signed in to someone else, such as the phone’s owner', async () => {
    const w = world({ screens: [settings('owner@example.test')] });
    const lines = logged(w);
    expect(await run(['up'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('signed in as owner@example.test, not the test account');
    expect(session(w).account).toBeNull();
    // So every command that changes anything refuses, sign-out included.
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(1);
    expect(await run(['down'], w.deps)).toBe(0);
    expect(sent(w).some((c) => c.startsWith('shell input'))).toBe(false);
  });

  it('refuses an unregistered phone', async () => {
    const w = world({ devices: 'List of devices attached\nOTHERPHONE\tdevice\n' });
    const lines = logged(w);
    expect(await run(['up'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('pnpm device register OTHERPHONE');
    expect(w.calls.filter((c) => c[0] === '-s')).toHaveLength(0);
  });

  it('starts the head unit with --car, and says what to do when it doesn’t stay up', async () => {
    const w = world();
    expect(await run(['up', '--car'], w.deps)).toBe(0);
    expect(sent(w)).toContain('forward tcp:5277 tcp:5277');
    expect(session(w)).toMatchObject({ forward: true, dhu: { pid: 4242 } });
    expect(w.files.get(`${ROOT}/.harness/dhu.ini`)).toContain('location = true');

    const dead = world();
    dead.dhuAlive = false;
    dead.files.set(`${ROOT}/.harness/dhu.log`, 'error while loading shared libraries: libc++.so.1');
    const lines = logged(dead);
    expect(await run(['up', '--car'], dead.deps)).toBe(1);
    expect(lines.join('\n')).toContain('libc++');
  });
});

describe('tapping and typing', () => {
  const started = async (over: Parameters<typeof world>[0] = {}) => {
    const w = world(over);
    await run(['up'], w.deps);
    w.calls.length = 0;
    return w;
  };

  it('taps by visible text, at its centre', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['tap', 'Search'], w.deps)).toBe(0);
    expect(sent(w)).toContain('shell input tap 540 250');
  });

  it('only in Wayfinder or its permission prompts', async () => {
    const w = await started();
    w.focus = 'com.google.android.apps.messaging';
    const lines = logged(w);
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('com.google.android.apps.messaging is');
    w.focus = 'com.google.android.permissioncontroller';
    expect(await run(['tap', '540', '1200'], w.deps)).toBe(0);
    expect(sent(w).filter((c) => c.startsWith('shell input tap'))).toEqual(['shell input tap 540 1200']);
  });

  it('never taps Sign out or Delete account, by name or by position', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['tap', 'Sign out'], w.deps)).toBe(1);
    expect(await run(['tap', '220', '2050'], w.deps)).toBe(1);
    expect(sent(w).some((c) => c.startsWith('shell input tap'))).toBe(false);
  });

  it('stops when the app shows the sign-in screen, until up confirms the account again', async () => {
    const w = await started({ screens: [settings(), signIn()] });
    expect(await run(['type', 'hello'], w.deps)).toBe(1);
    expect(session(w).account).toBeNull();
    expect(await run(['key', 'back'], w.deps)).toBe(1);
  });

  it('types text quoted for the phone’s shell', async () => {
    const w = await started({ screens: [settings(), planScreen()] });
    expect(await run(['type', 'Mt', 'Coot-tha'], w.deps)).toBe(0);
    expect(sent(w)).toContain("shell input text 'Mt%sCoot-tha'");
  });

  it('taps the car only while it shows Wayfinder', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    expect(await run(['tap', 'car', '400', '240'], w.deps)).toBe(0);
    expect(w.dhuLines).toContain('tap 400 240');
    w.carLog = 'I WayfinderCar: car screen shown\nI WayfinderCar: car screen hidden\n';
    expect(await run(['tap', 'car', '100', '100'], w.deps)).toBe(1);
    expect(w.dhuLines).not.toContain('tap 100 100');
  });
});

describe('screenshots', () => {
  it('saves the phone’s and the car’s under .harness/shots', async () => {
    const w = world();
    const lines = logged(w);
    await run(['up', '--car'], w.deps);
    expect(await run(['shot', 'phone'], w.deps)).toBe(0);
    expect(await run(['shot', 'car'], w.deps)).toBe(0);
    const paths = lines.filter((l) => l.endsWith('.png'));
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(`${ROOT}/.harness/shots/`))).toBe(true);
    expect(w.dhuLines.some((l) => l.startsWith('screenshot '))).toBe(true);
  });
});

describe('location', () => {
  it('needs an app version that keeps accounts’ points apart', async () => {
    const w = world({ version: 16 });
    await run(['up'], w.deps);
    const lines = logged(w);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain('versionCode 16');
    expect(sent(w).some((c) => c.includes('location'))).toBe(false);
  });

  it('sets the phone through a test provider, and the car through the head unit, [lon, lat] in', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(0);
    expect(await run(['gps', '153.03', '-27.48'], w.deps)).toBe(0);
    const s = sent(w);
    expect(s.filter((c) => c.includes('add-test-provider'))).toHaveLength(1);
    expect(s).toContain('shell appops set com.android.shell android:mock_location allow');
    expect(s).toContain('shell cmd location providers set-test-provider-location gps --location -27.470000,153.020000');
    expect(w.dhuLines).toContain('location -27.480000 153.030000 5 0 0.0 0');
  });

  it('uses geo fix on the emulator', async () => {
    const w = world({ devices: 'List of devices attached\nemulator-5554\tdevice\n' });
    await run(['up'], w.deps);
    expect(await run(['gps', '153.02', '-27.47'], w.deps)).toBe(0);
    expect(sent(w)).toContain('emu geo fix 153.020000 -27.470000');
  });

  it('replays a drive a fix a second, and cleans everything up when interrupted', async () => {
    const w = world({ screens: [settings()] });
    w.files.set('/r.geojson', JSON.stringify({ type: 'LineString', coordinates: [[153, -27.5], [153.001, -27.5]] }));
    await run(['up', '--car'], w.deps);
    expect(await run(['drive', '/r.geojson', '--speed', '36'], w.deps)).toBe(0);
    const fixes = sent(w).filter((c) => c.includes('set-test-provider-location'));
    expect(fixes.length).toBeGreaterThan(9);
    expect(w.dhuLines.filter((l) => l.startsWith('location')).at(-1)).toMatch(/ 0\.0 90$/);

    w.deps.sleep = async () => w.interrupt();
    w.screens = [settings(), signIn()];
    expect(await run(['drive', '/r.geojson'], w.deps)).toBe(130);
    expect(session(w)).toBeNull();
    expect(sent(w)).toContain('shell cmd location providers remove-test-provider gps');
  });
});

describe('down', () => {
  it('signs the test account out, turns the test location off and stops the head unit', async () => {
    const w = world();
    await run(['up', '--car'], w.deps);
    await run(['gps', '153.02', '-27.47'], w.deps);
    w.calls.length = 0;
    w.screens = [settings(), signIn()];
    const lines = logged(w);
    expect(await run(['down'], w.deps)).toBe(0);
    const s = sent(w);
    expect(s).toContain('shell input tap 220 2050');
    expect(s).toContain('shell cmd location providers remove-test-provider gps');
    expect(s).toContain('shell appops set com.android.shell android:mock_location deny');
    expect(s).toContain('forward --remove tcp:5277');
    expect(w.dhuLines.at(-1)).toBe('quit');
    expect(session(w)).toBeNull();
    expect(lines.join('\n')).toContain('Signed out of');
  });

  it('says plainly when the test account may still be signed in', async () => {
    const w = world();
    await run(['up'], w.deps);
    w.screens = [settings()]; // Sign out tapped, but the sign-in screen never comes
    const lines = logged(w);
    expect(await run(['down'], w.deps)).toBe(1);
    expect(lines.join('\n')).toContain(`may still be signed in to ${TEST_EMAIL}`);
  });

  it('never signs out an account that isn’t the test account', async () => {
    const w = world();
    await run(['up'], w.deps);
    w.calls.length = 0;
    w.screens = [settings('owner@example.test')];
    expect(await run(['down'], w.deps)).toBe(1);
    expect(sent(w).some((c) => c.startsWith('shell input tap'))).toBe(false);
  });
});

describe('the emulator', () => {
  it('installs an APK there and nowhere else', async () => {
    const phone = world();
    expect(await run(['install', '/a.apk'], phone.deps)).toBe(1);
    expect(sent(phone).some((c) => c.startsWith('install'))).toBe(false);
    const emu = world({ devices: 'List of devices attached\nemulator-5554\tdevice\n' });
    expect(await run(['install', '/a.apk'], emu.deps)).toBe(0);
    expect(sent(emu)).toContain('install -r /a.apk');
  });
});
