import { describe, expect, it } from 'vitest';
import { type AdbCommand, LIST_DEVICES, adbArgs, carShowsWayfinder, focusedPackage, parseDevices, pickDevice, shellQuote, versionCode } from '../../device/adb.js';

const phone = { serial: 'R5CT1234', emulator: false };
const emulator = { serial: 'emulator-5554', emulator: true };

/** One of every command the harness can send to a phone. */
const PHONE_COMMANDS: AdbCommand[] = [
  { kind: 'screencap' },
  { kind: 'uiDump' },
  { kind: 'tap', x: 10, y: 20 },
  { kind: 'text', text: 'Mt Coot-tha' },
  { kind: 'key', key: 'back' },
  { kind: 'swipe', x1: 1, y1: 2, x2: 3, y2: 4 },
  { kind: 'focus' },
  { kind: 'version' },
  { kind: 'open' },
  { kind: 'open', path: '/settings' },
  { kind: 'logs', sinceEpochS: 1_790_000_000.5 },
  { kind: 'carLog' },
  { kind: 'mockLocation', allow: true },
  { kind: 'mockLocation', allow: false },
  { kind: 'testProvider', add: true },
  { kind: 'testProvider', add: false },
  { kind: 'testLocation', lon: 153.02, lat: -27.47 },
  { kind: 'forward', add: true },
  { kind: 'forward', add: false },
];

describe('adb commands', () => {
  it('only ever looks, taps and types, sets a test location, or forwards the head unit port on a phone', () => {
    const allowedShell = new Set(['input', 'dumpsys', 'am', 'appops', 'cmd']);
    for (const cmd of PHONE_COMMANDS) {
      const args = adbArgs(phone, cmd);
      expect(args.slice(0, 2)).toEqual(['-s', 'R5CT1234']);
      const [verb, first] = args.slice(2);
      expect(['exec-out', 'shell', 'logcat', 'forward']).toContain(verb);
      if (verb === 'shell') expect(allowedShell).toContain(first);
      if (verb === 'exec-out') expect(['screencap', 'uiautomator']).toContain(first);
      const line = args.join(' ');
      for (const banned of ['uninstall', 'install', ' pm ', 'clear', ' rm ', 'reboot', 'settings put', ' wipe', 'factory']) expect(line).not.toContain(banned);
    }
    expect(LIST_DEVICES).toEqual(['devices']);
  });

  it('keeps installing, geo fix and shutting down to the emulator', () => {
    for (const cmd of [{ kind: 'install', apk: 'a.apk' }, { kind: 'geoFix', lon: 1, lat: 2 }, { kind: 'emuKill' }] as AdbCommand[]) {
      expect(() => adbArgs(phone, cmd)).toThrow('only runs on the emulator');
      expect(adbArgs(emulator, cmd).slice(0, 2)).toEqual(['-s', 'emulator-5554']);
    }
    expect(adbArgs(emulator, { kind: 'geoFix', lon: 153.02, lat: -27.47 })).toEqual(['-s', 'emulator-5554', 'emu', 'geo', 'fix', '153.020000', '-27.470000']);
  });

  it('sends typed text as text, never as a shell command', () => {
    const args = adbArgs(phone, { kind: 'text', text: "it's; rm -rf / $(reboot)" });
    expect(args.slice(2)).toEqual(['shell', 'input', 'text', `'it'\\''s;%srm%s-rf%s/%s$(reboot)'`]);
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it('refuses positions and places that aren’t numbers on Earth', () => {
    expect(() => adbArgs(phone, { kind: 'tap', x: Number.NaN, y: 1 })).toThrow('Not a number');
    expect(() => adbArgs(phone, { kind: 'testLocation', lon: 200, lat: 0 })).toThrow('Not a coordinate');
    expect(adbArgs(phone, { kind: 'testLocation', lon: 153.02, lat: -27.47 }).slice(-2)).toEqual(['--location', '-27.470000,153.020000']);
  });

  it('reads the app in front, the installed version and the car app’s log', () => {
    expect(focusedPackage('  mCurrentFocus=Window{8f1 u0 app.wayfinder.maps/app.wayfinder.maps.MainActivity}\n')).toBe('app.wayfinder.maps');
    expect(focusedPackage('mCurrentFocus=Window{1 u0 com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity}')).toBe('com.google.android.permissioncontroller');
    expect(focusedPackage('mCurrentFocus=Window{2 u0 NotificationShade}')).toBeNull();
    expect(focusedPackage('')).toBeNull();
    expect(versionCode('    versionCode=17 minSdk=26 targetSdk=36')).toBe(17);
    expect(versionCode('Unable to find package')).toBeNull();
    expect(carShowsWayfinder('I WayfinderCar: car screen shown\nI WayfinderCar: car screen hidden\n')).toBe(false);
    expect(carShowsWayfinder('I WayfinderCar: car screen hidden\nI WayfinderCar: car screen shown\n')).toBe(true);
    expect(carShowsWayfinder('')).toBe(false);
  });
});

describe('the app in front with Android Auto connected', () => {
  // With the head unit up, Android Auto adds its own displays, each with an mCurrentFocus;
  // only the phone's (display 0) says what's on the phone.
  const dump = (phoneFocus: string) =>
    [
      'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
      '  Display: mDisplayId=821',
      '  mCurrentFocus=null',
      '  Display: mDisplayId=817 (organized)',
      '  mCurrentFocus=Window{1bd675a u0 com.google.android.projection.gearhead/com.google.android.apps.auto.carservice.car.activity.virtualdevice.CarVirtualDeviceActivity}',
      '  Display: mDisplayId=0 (organized)',
      `  mCurrentFocus=${phoneFocus}`,
      'WINDOW MANAGER TOKENS (dumpsys window tokens)',
    ].join('\n');

  it('reads the phone’s display, not the car’s', () => {
    expect(focusedPackage(dump('Window{f1db7ed u0 app.wayfinder.maps/app.wayfinder.maps.MainActivity}'))).toBe('app.wayfinder.maps');
  });

  it('says nothing is in front when the phone’s display has no focus, whatever the car shows', () => {
    expect(focusedPackage(dump('null'))).toBeNull();
    expect(focusedPackage(dump('Window{2 u0 NotificationShade}'))).toBeNull();
  });
});

describe('choosing a device', () => {
  const listed = parseDevices('List of devices attached\nR5CT1234\tdevice\nemulator-5554\tdevice\nXYZ\tunauthorized\n\n');

  it('reads adb devices', () => {
    expect(listed).toEqual([{ serial: 'R5CT1234', state: 'device' }, { serial: 'emulator-5554', state: 'device' }, { serial: 'XYZ', state: 'unauthorized' }]);
  });

  it('never picks a phone that isn’t registered', () => {
    expect(() => pickDevice(listed, [], 'R5CT1234')).toThrow('pnpm device register R5CT1234');
    expect(pickDevice(listed, ['R5CT1234'], 'R5CT1234')).toEqual({ serial: 'R5CT1234', emulator: false });
  });

  it('needs one named when several are attached, and says when none is', () => {
    expect(() => pickDevice(listed, ['R5CT1234'])).toThrow('More than one device');
    expect(pickDevice(listed, [], 'emulator-5554')).toEqual({ serial: 'emulator-5554', emulator: true });
    expect(() => pickDevice([], [])).toThrow('No device attached');
    expect(() => pickDevice(listed, [], 'XYZ')).toThrow("isn't attached");
  });
});
