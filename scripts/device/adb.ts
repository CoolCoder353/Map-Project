/**
 * Every adb command the device harness sends is built here and nowhere else. On a real phone the
 * harness may only look, tap and type, set a test location, and forward the head unit's port:
 * nothing here installs, uninstalls, clears data, deletes files, reboots or changes settings, and
 * scripts/test/device/adb.test.ts holds it to that. See docs/development.md, "Device harness".
 */
export const APP = 'app.wayfinder.maps';
/** The first version whose upload queue keeps each account's points to that account. */
export const MIN_SAFE_VERSION_CODE = 17;
export const DHU_PORT = 5277;
export const LIST_DEVICES = ['devices'];

export interface Device {
  serial: string;
  emulator: boolean;
}

export type Key = 'back' | 'home' | 'enter';
const KEYCODES: Record<Key, string> = { back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER' };

export type AdbCommand =
  | { kind: 'screencap' }
  | { kind: 'uiDump' }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: Key }
  | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'focus' }
  | { kind: 'version' }
  | { kind: 'open'; path?: string }
  | { kind: 'logs'; sinceEpochS: number }
  | { kind: 'carLog' }
  | { kind: 'mockLocation'; allow: boolean }
  | { kind: 'testProvider'; add: boolean }
  | { kind: 'testLocation'; lon: number; lat: number }
  | { kind: 'forward'; add: boolean }
  | { kind: 'geoFix'; lon: number; lat: number }
  | { kind: 'collapseShade' }
  | { kind: 'mediaPause' }
  | { kind: 'install'; apk: string }
  | { kind: 'emuKill' };

const EMULATOR_ONLY = new Set<AdbCommand['kind']>(['geoFix', 'install', 'emuKill']);

/** Quoted for the device's shell, so typed text is only ever text. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const int = (n: number) => {
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${n}`);
  return String(Math.round(n));
};
const coord = (n: number, max: number) => {
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new Error(`Not a coordinate: ${n}`);
  return n.toFixed(6);
};

/** The adb arguments for a command. Throws for an emulator-only command on a phone. */
export function adbArgs(device: Device, cmd: AdbCommand): string[] {
  if (EMULATOR_ONLY.has(cmd.kind) && !device.emulator) throw new Error(`${cmd.kind} only runs on the emulator`);
  const s = ['-s', device.serial];
  switch (cmd.kind) {
    case 'screencap':
      return [...s, 'exec-out', 'screencap', '-p'];
    case 'uiDump':
      return [...s, 'exec-out', 'uiautomator', 'dump', '/dev/tty'];
    case 'tap':
      return [...s, 'shell', 'input', 'tap', int(cmd.x), int(cmd.y)];
    case 'text':
      // `input text` takes %s for a space.
      return [...s, 'shell', 'input', 'text', shellQuote(cmd.text.replace(/ /g, '%s'))];
    case 'key':
      return [...s, 'shell', 'input', 'keyevent', KEYCODES[cmd.key]];
    case 'swipe':
      return [...s, 'shell', 'input', 'swipe', int(cmd.x1), int(cmd.y1), int(cmd.x2), int(cmd.y2), '300'];
    case 'focus':
      return [...s, 'shell', 'dumpsys', 'window'];
    case 'version':
      return [...s, 'shell', 'dumpsys', 'package', APP];
    case 'open':
      return cmd.path === undefined
        ? [...s, 'shell', 'am', 'start', '-n', `${APP}/.MainActivity`]
        : [...s, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shellQuote(`wayfinder://${cmd.path}`), APP];
    case 'logs':
      return [...s, 'logcat', '-d', '-v', 'epoch', '-T', cmd.sinceEpochS.toFixed(3), 'ReactNativeJS:V', 'WayfinderCar:V', 'AndroidRuntime:E', '*:S'];
    case 'carLog':
      return [...s, 'logcat', '-d', '-s', 'WayfinderCar:I'];
    case 'mockLocation':
      return [...s, 'shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', cmd.allow ? 'allow' : 'deny'];
    case 'testProvider':
      return [...s, 'shell', 'cmd', 'location', 'providers', cmd.add ? 'add-test-provider' : 'remove-test-provider', 'gps'];
    case 'testLocation':
      return [...s, 'shell', 'cmd', 'location', 'providers', 'set-test-provider-location', 'gps', '--location', `${coord(cmd.lat, 90)},${coord(cmd.lon, 180)}`];
    case 'forward':
      return cmd.add ? [...s, 'forward', `tcp:${DHU_PORT}`, `tcp:${DHU_PORT}`] : [...s, 'forward', '--remove', `tcp:${DHU_PORT}`];
    case 'geoFix':
      return [...s, 'emu', 'geo', 'fix', coord(cmd.lon, 180), coord(cmd.lat, 90)];
    case 'collapseShade':
      return [...s, 'shell', 'cmd', 'statusbar', 'collapse'];
    case 'mediaPause':
      return [...s, 'shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE'];
    case 'install':
      return [...s, 'install', '-r', cmd.apk];
    case 'emuKill':
      return [...s, 'emu', 'kill'];
  }
}

/**
 * The app with focus on the phone's own screen, from `dumpsys window`
 * ("mCurrentFocus=Window{… u0 app.wayfinder.maps/….MainActivity}"). With Android Auto connected
 * the dump has a section per display, the car's included, so only display 0's counts.
 */
export function focusedPackage(dumpsys: string): string | null {
  const phone = /Display: mDisplayId=0\b[\s\S]*?(?=\n\s*Display: mDisplayId=|\nWINDOW MANAGER |$)/.exec(dumpsys)?.[0] ?? dumpsys;
  const focus = /mCurrentFocus=(Window\{[^}]*\}|\S+)/.exec(phone)?.[1] ?? '';
  return /^Window\{[^}]*?\s([\w.]+)\/[^\s}]+\}/.exec(focus)?.[1] ?? null;
}

export function versionCode(dumpsys: string): number | null {
  const m = /versionCode=(\d+)/.exec(dumpsys);
  return m ? Number(m[1]) : null;
}

/** Whether the car's screen shows Wayfinder, by the car app's last "car screen …" line (CarVisibility.kt). */
export function carShowsWayfinder(log: string): boolean {
  return log.split('\n').filter((l) => l.includes('car screen ')).at(-1)?.includes('car screen shown') ?? false;
}

export interface ListedDevice {
  serial: string;
  state: string;
}

export function parseDevices(out: string): ListedDevice[] {
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[0])
    .map(([serial, state]) => ({ serial: serial!, state: state! }));
}

/**
 * The device to act on: the one named, or the only one attached. A phone (anything not an
 * emulator) only once registered, so the harness never acts on a phone by accident.
 */
export function pickDevice(listed: ListedDevice[], registered: readonly string[], named?: string): Device {
  const ready = listed.filter((d) => d.state === 'device');
  const candidates = named ? ready.filter((d) => d.serial === named) : ready;
  if (candidates.length === 0) throw new Error(named ? `${named} isn't attached (or isn't allowed USB debugging).` : 'No device attached.');
  if (candidates.length > 1) throw new Error(`More than one device attached (${candidates.map((d) => d.serial).join(', ')}): name one with --device.`);
  const d = candidates[0]!;
  const emulator = d.serial.startsWith('emulator-');
  if (!emulator && !registered.includes(d.serial)) throw new Error(`${d.serial} isn't registered. If it's the phone to test with: pnpm device register ${d.serial}`);
  return { serial: d.serial, emulator };
}
