import type { Deps } from '../../device/cli.js';

/** One node of a `uiautomator dump`. */
export const node = (o: { text?: string; desc?: string; id?: string; b: [number, number, number, number] }) =>
  `<node index="0" text="${o.text ?? ''}" resource-id="${o.id ?? ''}" class="android.widget.TextView" package="app.wayfinder.maps" content-desc="${o.desc ?? ''}" bounds="[${o.b[0]},${o.b[1]}][${o.b[2]},${o.b[3]}]" />`;
/** A whole dump: a full-screen root, the nodes, and the line uiautomator prints after it. */
export const dump = (...nodes: string[]) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${node({ b: [0, 0, 1080, 2400] })}${nodes.join('')}</hierarchy>UI hierchary dumped to: /dev/tty`;

export const ROOT = '/repo';
export const TEST_EMAIL = 'claude-harness@example.test';

export const settings = (email = TEST_EMAIL) =>
  dump(node({ text: `${email} · Wayfinder at maps.example.test`, b: [40, 300, 1040, 340] }), node({ text: 'Sync now', b: [40, 500, 400, 560] }), node({ desc: 'Sign out', b: [40, 2000, 400, 2100] }));
export const signIn = () => dump(node({ text: 'Email', b: [0, 400, 1080, 460] }), node({ text: 'Password', b: [0, 500, 1080, 560] }), node({ text: 'Sign in', b: [40, 700, 1040, 780] }));
export const planScreen = () => dump(node({ text: 'Search', b: [40, 200, 1040, 300] }), node({ text: 'Sign out', b: [40, 2000, 400, 2100] }));

export interface World {
  deps: Deps;
  calls: string[][];
  dhuLines: string[];
  files: Map<string, string>;
  binary: Map<string, Buffer>;
  /** Screens returned by successive UI dumps; the last one repeats. */
  screens: string[];
  focus: string;
  version: number;
  carLog: string;
  devices: string;
  interrupt: () => void;
  dhuAlive: boolean;
  slept: number;
}

export function world(over: Partial<Pick<World, 'focus' | 'version' | 'carLog' | 'devices' | 'screens'>> = {}): World {
  const w: World = {
    calls: [],
    dhuLines: [],
    files: new Map([[`${ROOT}/.harness/config.json`, JSON.stringify({ testAccountEmail: TEST_EMAIL, phones: ['R5CT1234'] })]]),
    binary: new Map(),
    screens: over.screens ?? [settings()],
    focus: over.focus ?? 'app.wayfinder.maps',
    version: over.version ?? 17,
    carLog: over.carLog ?? 'I WayfinderCar: car screen shown\n',
    devices: over.devices ?? 'List of devices attached\nR5CT1234\tdevice\n',
    interrupt: () => undefined,
    dhuAlive: true,
    slept: 0,
    deps: undefined as unknown as Deps,
  };
  const ok = (out: string | Buffer) => ({ code: 0, out: Buffer.isBuffer(out) ? out : Buffer.from(out), err: '' });
  w.deps = {
    root: ROOT,
    adb: async (args) => {
      w.calls.push(args);
      const line = args.join(' ');
      if (line === 'devices') return ok(w.devices);
      if (line.includes('screencap')) return ok(Buffer.from('PNG'));
      if (line.includes('uiautomator')) return ok(w.screens.length > 1 ? w.screens.shift()! : w.screens[0]!);
      if (line.includes('dumpsys window')) return ok(`mCurrentFocus=Window{1 u0 ${w.focus}/x.Main}`);
      if (line.includes('dumpsys package')) return ok(`versionCode=${w.version} minSdk=26`);
      if (line.includes('-s WayfinderCar:I')) return ok(w.carLog);
      return ok('');
    },
    files: {
      read: async (p) => w.files.get(p) ?? null,
      write: async (p, t) => void w.files.set(p, t),
      remove: async (p) => void w.files.delete(p),
    },
    writeBinary: async (p, b) => void w.binary.set(p, b),
    exists: async (p) => w.binary.has(p) || w.files.has(p),
    startDhu: async () => 4242,
    sendDhu: async (_fifo, line) => {
      w.dhuLines.push(line);
      const shot = /^screenshot (.+)$/.exec(line);
      if (shot) w.binary.set(shot[1]!, Buffer.from('PNG'));
      if (line === 'quit') w.dhuAlive = false;
    },
    alive: () => w.dhuAlive,
    kill: () => void (w.dhuAlive = false),
    startEmulator: async () => undefined,
    sleep: async (ms) => void (w.slept += ms),
    nowMs: () => Date.parse('2026-11-09T01:00:00Z'),
    log: () => undefined,
    onInterrupt: (fn) => void (w.interrupt = fn),
  };
  return w;
}

/** The adb shell/exec-out/logcat calls after the device serial, as text. */
export const sent = (w: World) => w.calls.filter((c) => c[0] === '-s').map((c) => c.slice(2).join(' '));
