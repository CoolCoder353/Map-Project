/**
 * `pnpm device …`: screenshots, taps, typing, GPS and drive replay on a phone (with the Desktop
 * Head Unit for Android Auto) or the emulator. Safeguards, all enforced here and tested in
 * scripts/test/device: a phone must be registered; taps only land in Wayfinder (or its permission
 * prompts), never on Sign out or Delete account; everything that changes anything needs the app
 * signed in to the configured test account; drives need an app version that keeps each account's
 * queued points apart; `down` signs the test account out and undoes the rest. docs/development.md,
 * "Device harness".
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type AdbCommand, type Device, type Key, APP, LIST_DEVICES, MIN_SAFE_VERSION_CODE, adbArgs, carShowsWayfinder, focusedPackage, parseDevices, pickDevice, versionCode } from './adb.js';
import { CAR_KEYS, type CarKey, DHU_CONFIG, dhuCommand } from './dhu.js';
import { type Fix, readRoute, replay } from './route.js';
import { type Config, type Files, type Session, clearSession, harnessDir, loadConfig, loadSession, saveConfig, saveSession } from './state.js';
import { type UiNode, centre, describeScreen, findByText, forbiddenAt, isSignInScreen, label, parseUiDump, screenSize, signedInEmail } from './ui.js';

export interface Deps {
  root: string;
  adb: (args: string[]) => Promise<{ code: number; out: Buffer; err: string }>;
  files: Files;
  writeBinary: (path: string, data: Buffer) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  /** Start the DHU reading console commands from `fifo`; returns its pid. */
  startDhu: (o: { fifo: string; config: string; headless: boolean }) => Promise<number>;
  sendDhu: (fifo: string, line: string) => Promise<void>;
  alive: (pid: number) => boolean;
  kill: (pid: number) => void;
  startEmulator: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
  log: (line: string) => void;
  onInterrupt: (fn: () => void) => void;
}

/** Apps a phone tap may land in: Wayfinder, and the permission prompts it causes. */
export const TAP_PACKAGES = [APP, 'com.google.android.permissioncontroller', 'com.android.permissioncontroller'];

const USAGE = `Usage: pnpm device <command>
  register <serial>            allow the harness to use this phone
  account <email>              the test account the app must be signed in to
  devices                      attached devices, and which may be used
  up [--car] [--window] [--emulator] [--device <serial>]
                               check the app is on the test account; --car starts the head unit
  shot phone|car [--out f.png] screenshot; prints the file
  ui                           what's on the phone's screen, and where to tap it
  tap <text> | tap <x> <y> | tap car <x> <y>
  type <text>   key back|home|enter   swipe <x1> <y1> <x2> <y2>
  gps <lon> <lat> [--phone|--car]   gps reset
  drive <route.geojson|.gpx> [--speed <km/h>]
  car day|night | car key ${CAR_KEYS.join('|')} | car restrict on|off
  logs                         app and car logs since the last look
  install <apk>                emulator only
  down                         sign the test account out and undo everything`;

class Refused extends Error {}

interface Ctx {
  deps: Deps;
  config: Config;
  session: Session | null;
  device: Device;
}

async function adb(ctx: Ctx, cmd: AdbCommand): Promise<Buffer> {
  const r = await ctx.deps.adb(adbArgs(ctx.device, cmd));
  if (r.code !== 0) throw new Error(`adb ${cmd.kind} failed: ${r.err.trim() || `exit ${r.code}`}`);
  return r.out;
}
const text = async (ctx: Ctx, cmd: AdbCommand) => (await adb(ctx, cmd)).toString('utf8');
const screen = async (ctx: Ctx): Promise<UiNode[]> => parseUiDump(await text(ctx, { kind: 'uiDump' }));
const save = (ctx: Ctx) => saveSession(ctx.deps.files, ctx.deps.root, ctx.session!);
const sameEmail = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

function requireSession(ctx: Ctx): Session {
  const s = ctx.session;
  if (!s || s.serial !== ctx.device.serial) throw new Refused('No harness session on this device: run pnpm device up first.');
  if (!ctx.config.testAccountEmail) throw new Refused('No test account set: pnpm device account <email>.');
  if (!sameEmail(s.account, ctx.config.testAccountEmail)) throw new Refused(`Wayfinder isn't known to be signed in to the test account (${ctx.config.testAccountEmail}). Ask for it to be signed in, then run pnpm device up.`);
  return s;
}

/** Before anything that touches the phone: the test account's session, Wayfinder in front, still signed in, and not a control the harness never taps. */
async function guardPhone(ctx: Ctx, at?: [number, number]): Promise<UiNode[]> {
  const s = requireSession(ctx);
  const pkg = focusedPackage(await text(ctx, { kind: 'focus' }));
  if (!pkg || !TAP_PACKAGES.includes(pkg)) throw new Refused(`Wayfinder isn't in front (${pkg ? `${pkg} is` : 'the lock screen or notification shade is'}), so nothing was done.`);
  const nodes = await screen(ctx);
  if (pkg === APP && isSignInScreen(nodes)) {
    s.account = null;
    await save(ctx);
    throw new Refused('Wayfinder is on its sign-in screen, so the test account is signed out. Ask for it to be signed in again, then run pnpm device up.');
  }
  if (at) {
    const f = forbiddenAt(nodes, at[0], at[1]);
    if (f) throw new Refused(`That would tap "${f}". The harness never does: pnpm device down signs the test account out.`);
  }
  return nodes;
}

async function guardVersion(ctx: Ctx) {
  const v = versionCode(await text(ctx, { kind: 'version' }));
  if (v === null || v < MIN_SAFE_VERSION_CODE) {
    throw new Refused(`Wayfinder here is versionCode ${v ?? 'unknown'}. Moving the GPS needs ${MIN_SAFE_VERSION_CODE} or later, which keeps each account's recorded points to that account; update it from Play's internal testing first.`);
  }
}

function requireDhu(ctx: Ctx): { pid: number; fifo: string } {
  const dhu = ctx.session?.dhu;
  if (!dhu || !ctx.deps.alive(dhu.pid)) throw new Refused('The head unit isn’t running: pnpm device up --car.');
  return dhu;
}

async function readSettings(ctx: Ctx): Promise<UiNode[]> {
  await adb(ctx, { kind: 'open', path: '/settings' });
  await ctx.deps.sleep(2500);
  return screen(ctx);
}

async function up(ctx: Ctx, o: { car: boolean; window: boolean; startedEmulator: boolean }) {
  const { deps, config, device } = ctx;
  if (!config.testAccountEmail) throw new Refused('No test account set: pnpm device account <email>.');
  if (ctx.session) throw new Refused('A session is already open: pnpm device down first.');
  ctx.session = { serial: device.serial, emulator: device.emulator, account: null, testProvider: false, forward: false, dhu: null, startedEmulator: o.startedEmulator, logsSince: deps.nowMs() / 1000 };
  await save(ctx); // first, so down can undo whatever follows even if up stops part-way

  const nodes = await readSettings(ctx);
  if (isSignInScreen(nodes)) throw new Refused(`Wayfinder is signed out. Ask for it to be signed in to ${config.testAccountEmail}, then run up again.`);
  const email = signedInEmail(nodes);
  if (!sameEmail(email, config.testAccountEmail)) {
    throw new Refused(`Wayfinder is signed in as ${email ?? 'someone the harness can’t read on Settings'}, not the test account (${config.testAccountEmail}). Nothing was tapped. Run pnpm device down, sign in to the test account, then up again.`);
  }
  ctx.session.account = email;
  await save(ctx);
  const v = versionCode(await text(ctx, { kind: 'version' }));
  deps.log(`${device.emulator ? 'Emulator' : 'Phone'} ${device.serial}: Wayfinder versionCode ${v ?? '?'}, signed in to the test account ${email}.`);
  if (v === null || v < MIN_SAFE_VERSION_CODE) deps.log(`gps and drive will refuse until it's versionCode ${MIN_SAFE_VERSION_CODE} or later.`);

  if (o.car) {
    await adb(ctx, { kind: 'forward', add: true });
    ctx.session.forward = true;
    await save(ctx);
    const dir = harnessDir(deps.root);
    const ini = join(dir, 'dhu.ini');
    await deps.files.write(ini, DHU_CONFIG);
    const fifo = join(dir, 'dhu.fifo');
    const pid = await deps.startDhu({ fifo, config: ini, headless: !o.window });
    ctx.session.dhu = { pid, fifo };
    await save(ctx);
    await deps.sleep(3000);
    if (!deps.alive(pid)) {
      const log = (await deps.files.read(join(dir, 'dhu.log'))) ?? '';
      throw new Refused(
        log.includes('libc++')
          ? 'The head unit needs libc++: sudo pacman -S libc++ (Arch) or apt install libc++1 libc++abi1.'
          : `The head unit stopped straight away. On the phone, start Android Auto's head unit server (Android Auto settings, ⋮, Start head unit server), then pnpm device down and up --car again. Its log: ${join(dir, 'dhu.log')}`,
      );
    }
    deps.log('Head unit running.');
  }
}

async function shot(ctx: Ctx, which: string, out?: string) {
  const stamp = new Date(ctx.deps.nowMs()).toISOString().replace(/[:.]/g, '-');
  const path = out ?? join(harnessDir(ctx.deps.root), 'shots', `${which}-${stamp}.png`);
  if (/\s/.test(path)) throw new Refused('Screenshot paths can’t contain spaces (the head unit splits on them).');
  if (which === 'phone') {
    await ctx.deps.writeBinary(path, await adb(ctx, { kind: 'screencap' }));
  } else if (which === 'car') {
    const dhu = requireDhu(ctx);
    await ctx.deps.sendDhu(dhu.fifo, dhuCommand.screenshot(path));
    let waited = 0;
    while (!(await ctx.deps.exists(path))) {
      if (waited >= 10_000) throw new Error('The head unit didn’t save the screenshot.');
      await ctx.deps.sleep(250);
      waited += 250;
    }
  } else throw new Refused('shot phone or shot car');
  ctx.deps.log(path);
}

async function tap(ctx: Ctx, args: string[]) {
  const nums = args.map(Number);
  if (args[0] === 'car') {
    if (!Number.isFinite(nums[1]) || !Number.isFinite(nums[2])) throw new Refused('tap car <x> <y>');
    requireSession(ctx);
    const dhu = requireDhu(ctx);
    if (!carShowsWayfinder(await text(ctx, { kind: 'carLog' }))) throw new Refused('The car screen isn’t showing Wayfinder (by its log), so nothing was tapped.');
    await ctx.deps.sendDhu(dhu.fifo, dhuCommand.tap(nums[1]!, nums[2]!));
    return;
  }
  if (args.length === 2 && nums.every(Number.isFinite)) {
    await guardPhone(ctx, [nums[0]!, nums[1]!]);
    await adb(ctx, { kind: 'tap', x: nums[0]!, y: nums[1]! });
    return;
  }
  const nodes = await guardPhone(ctx);
  const [x, y] = centre(findByText(nodes, args.join(' ')));
  const f = forbiddenAt(nodes, x, y);
  if (f) throw new Refused(`That would tap "${f}". The harness never does: pnpm device down signs the test account out.`);
  await adb(ctx, { kind: 'tap', x, y });
}

async function setPosition(ctx: Ctx, f: Pick<Fix, 'lon' | 'lat' | 'speedMps' | 'bearingDeg'>, phone: boolean, car: boolean) {
  const s = ctx.session!;
  if (phone) {
    if (ctx.device.emulator) await adb(ctx, { kind: 'geoFix', lon: f.lon, lat: f.lat });
    else {
      if (!s.testProvider) {
        await adb(ctx, { kind: 'mockLocation', allow: true });
        await adb(ctx, { kind: 'testProvider', add: true });
        s.testProvider = true;
        await save(ctx);
      }
      await adb(ctx, { kind: 'testLocation', lon: f.lon, lat: f.lat });
    }
  }
  if (car && s.dhu) await ctx.deps.sendDhu(s.dhu.fifo, dhuCommand.location(f.lon, f.lat, f.speedMps, f.bearingDeg));
}

async function resetGps(ctx: Ctx) {
  const s = ctx.session;
  if (!s?.testProvider) return;
  await adb(ctx, { kind: 'testProvider', add: false });
  await adb(ctx, { kind: 'mockLocation', allow: false });
  s.testProvider = false;
  await save(ctx);
}

/** Sign the test account out through Settings, only if Settings shows the test account. */
async function signOut(ctx: Ctx) {
  const s = ctx.session!;
  if (!s.account) return; // never confirmed as the test account: leave the app as it is
  let nodes = await readSettings(ctx);
  if (isSignInScreen(nodes)) return;
  const email = signedInEmail(nodes);
  if (!sameEmail(email, ctx.config.testAccountEmail)) throw new Error(`Settings shows ${email ?? 'no account'}, not the test account, so it was left signed in.`);
  const [w, h] = screenSize(nodes);
  for (let i = 0; i < 6 && !nodes.some((n) => label(n) === 'Sign out'); i++) {
    await adb(ctx, { kind: 'swipe', x1: w / 2, y1: h * 0.75, x2: w / 2, y2: h * 0.25 });
    await ctx.deps.sleep(600);
    nodes = await screen(ctx);
  }
  const [x, y] = centre(findByText(nodes, 'Sign out'));
  await adb(ctx, { kind: 'tap', x, y });
  await ctx.deps.sleep(2500);
  if (!isSignInScreen(await screen(ctx))) throw new Error('Sign out was tapped but the sign-in screen didn’t appear.');
  s.account = null;
  await save(ctx);
  ctx.deps.log(`Signed out of ${ctx.config.testAccountEmail}.`);
}

async function down(ctx: Ctx): Promise<number> {
  const s = ctx.session;
  if (!s) {
    ctx.deps.log('No session open.');
    return 0;
  }
  const account = s.account;
  const problems: string[] = [];
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${(e as Error).message}`);
    }
  };
  await step('sign out', () => signOut(ctx));
  await step('test location', () => resetGps(ctx));
  if (s.forward) await step('port forward', () => adb(ctx, { kind: 'forward', add: false }));
  if (s.dhu) {
    const dhu = s.dhu;
    await step('head unit', async () => {
      if (ctx.deps.alive(dhu.pid)) await ctx.deps.sendDhu(dhu.fifo, dhuCommand.quit());
      await ctx.deps.sleep(1500);
      if (ctx.deps.alive(dhu.pid)) ctx.deps.kill(dhu.pid);
    });
  }
  if (s.startedEmulator) await step('emulator', () => adb(ctx, { kind: 'emuKill' }));
  await clearSession(ctx.deps.files, ctx.deps.root);
  for (const p of problems) ctx.deps.log(`Not done: ${p}`);
  if (account && problems.some((p) => p.startsWith('sign out'))) ctx.deps.log(`The phone may still be signed in to ${account}. Sign out in Wayfinder, Settings.`);
  return problems.length ? 1 : 0;
}

async function drive(ctx: Ctx, file: string, speedKmh: number): Promise<number> {
  requireSession(ctx);
  await guardVersion(ctx);
  const routeText = await ctx.deps.files.read(file);
  if (routeText === null) throw new Refused(`Can't read ${file}`);
  const fixes = replay(readRoute(routeText, file), speedKmh);
  let stopped = false;
  ctx.deps.onInterrupt(() => void (stopped = true));
  try {
    for (const f of fixes) {
      if (stopped) break;
      await setPosition(ctx, f, true, true);
      await ctx.deps.sleep(1000);
    }
  } catch (e) {
    await down(ctx);
    throw e;
  }
  if (stopped) {
    await down(ctx);
    ctx.deps.log('Stopped; everything undone as by pnpm device down.');
    return 130;
  }
  ctx.deps.log(`Drove ${fixes.length} fixes (${Math.round(fixes.at(-1)!.atS / 60)} min at ${speedKmh} km/h).`);
  return 0;
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  try {
    // A negative number ("-27.47") is a value here, never an option.
    const NEG = '\u0000';
    const parsed = parseArgs({
      args: argv.map((a) => (/^-\d/.test(a) ? `${NEG}${a}` : a)),
      allowPositionals: true,
      options: {
        device: { type: 'string' },
        car: { type: 'boolean', default: false },
        phone: { type: 'boolean', default: false },
        window: { type: 'boolean', default: false },
        emulator: { type: 'boolean', default: false },
        out: { type: 'string' },
        speed: { type: 'string', default: '50' },
      },
    });
    const values = parsed.values;
    const positionals = parsed.positionals.map((a) => (a.startsWith(NEG) ? a.slice(1) : a));
    const [command, ...args] = positionals;
    const config = await loadConfig(deps.files, deps.root);
    if (command === 'register' && args[0]) {
      await saveConfig(deps.files, deps.root, { ...config, phones: [...new Set([...config.phones, args[0]])] });
      deps.log(`Registered ${args[0]}.`);
      return 0;
    }
    if (command === 'account' && args[0]) {
      await saveConfig(deps.files, deps.root, { ...config, testAccountEmail: args[0] });
      deps.log(`Test account: ${args[0]}`);
      return 0;
    }
    const DEVICE_COMMANDS = ['up', 'shot', 'ui', 'tap', 'type', 'key', 'swipe', 'gps', 'drive', 'car', 'logs', 'install', 'down', 'devices'];
    if (!command || !DEVICE_COMMANDS.includes(command)) {
      deps.log(USAGE);
      return command ? 1 : 0;
    }
    const session = await loadSession(deps.files, deps.root);
    const devicesOut = async () => (await deps.adb(LIST_DEVICES)).out.toString('utf8');
    if (command === 'devices') {
      for (const d of parseDevices(await devicesOut())) {
        const ok = d.serial.startsWith('emulator-') || config.phones.includes(d.serial);
        deps.log(`${d.serial}\t${d.state}\t${ok ? 'may be used' : 'not registered'}`);
      }
      return 0;
    }
    let startedEmulator = false;
    if (command === 'up' && values.emulator && !parseDevices(await devicesOut()).some((d) => d.serial.startsWith('emulator-'))) {
      await deps.startEmulator();
      startedEmulator = true;
    }
    const named = values.device ?? session?.serial ?? (values.emulator ? parseDevices(await devicesOut()).find((d) => d.serial.startsWith('emulator-'))?.serial : undefined);
    const device = pickDevice(parseDevices(await devicesOut()), config.phones, named);
    const ctx: Ctx = { deps, config, session, device };

    switch (command) {
      case 'up':
        await up(ctx, { car: values.car!, window: values.window!, startedEmulator });
        return 0;
      case 'shot':
        await shot(ctx, args[0] ?? '', values.out);
        return 0;
      case 'ui':
        for (const line of describeScreen(await screen(ctx))) deps.log(line);
        return 0;
      case 'tap':
        await tap(ctx, args);
        return 0;
      case 'type':
        await guardPhone(ctx);
        await adb(ctx, { kind: 'text', text: args.join(' ') });
        return 0;
      case 'key':
        if (!['back', 'home', 'enter'].includes(args[0] ?? '')) throw new Refused('key back|home|enter');
        await guardPhone(ctx);
        await adb(ctx, { kind: 'key', key: args[0] as Key });
        return 0;
      case 'swipe': {
        const [x1, y1, x2, y2] = args.map(Number);
        await guardPhone(ctx, [x1!, y1!]);
        await adb(ctx, { kind: 'swipe', x1: x1!, y1: y1!, x2: x2!, y2: y2! });
        return 0;
      }
      case 'gps': {
        requireSession(ctx);
        if (args[0] === 'reset') {
          await resetGps(ctx);
          return 0;
        }
        await guardVersion(ctx);
        const [lon, lat] = args.map(Number);
        const both = !values.phone && !values.car;
        await setPosition(ctx, { lon: lon!, lat: lat!, speedMps: 0, bearingDeg: 0 }, both || values.phone!, both || values.car!);
        return 0;
      }
      case 'drive':
        return await drive(ctx, args[0] ?? '', Number(values.speed));
      case 'car': {
        requireSession(ctx);
        const dhu = requireDhu(ctx);
        const [what, arg] = args;
        const line =
          what === 'day' ? dhuCommand.day()
          : what === 'night' ? dhuCommand.night()
          : what === 'key' && (CAR_KEYS as readonly string[]).includes(arg ?? '') ? dhuCommand.key(arg as CarKey)
          : what === 'restrict' && (arg === 'on' || arg === 'off') ? dhuCommand.restrict(arg === 'on')
          : null;
        if (!line) throw new Refused(`car day|night | car key ${CAR_KEYS.join('|')} | car restrict on|off`);
        await deps.sendDhu(dhu.fifo, line);
        return 0;
      }
      case 'logs': {
        const since = ctx.session?.logsSince ?? deps.nowMs() / 1000 - 300;
        deps.log(await text(ctx, { kind: 'logs', sinceEpochS: since }));
        if (ctx.session) {
          ctx.session.logsSince = deps.nowMs() / 1000;
          await save(ctx);
        }
        return 0;
      }
      case 'install':
        if (!device.emulator) throw new Refused('install only runs on the emulator; a phone keeps its Play build.');
        await adb(ctx, { kind: 'install', apk: args[0] ?? '' });
        return 0;
      case 'down':
        return await down(ctx);
      default:
        deps.log(USAGE);
        return command ? 1 : 0;
    }
  } catch (e) {
    deps.log(e instanceof Refused ? `Refused: ${e.message}` : `Error: ${(e as Error).message}`);
    return 1;
  }
}
