/** Entry point for `pnpm device …`; the commands are in scripts/device/cli.ts. */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { constants, openSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run } from './device/cli.js';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? join(process.env.ANDROID_DIR ?? join(homedir(), 'Android'), 'Sdk');
const adbPath = join(sdk, 'platform-tools/adb');
const dhuDir = join(sdk, 'extras/google/auto');

process.exitCode = await run(process.argv.slice(2), {
  root,
  adb: (args) =>
    new Promise((done) =>
      execFile(adbPath, args, { encoding: 'buffer', maxBuffer: 64 << 20 }, (err, stdout, stderr) =>
        done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout, err: stderr.toString() }),
      ),
    ),
  files: {
    read: (p) => readFile(p, 'utf8').catch(() => null),
    write: async (p, t) => {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, t);
    },
    remove: (p) => rm(p, { force: true }),
  },
  writeBinary: async (p, b) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, b);
  },
  exists: (p) => stat(p).then(() => true, () => false),
  startDhu: async ({ fifo, config, headless }) => {
    await mkdir(dirname(fifo), { recursive: true });
    await rm(fifo, { force: true });
    execFileSync('mkfifo', [fifo]);
    // Opened read-write so the DHU never sees end-of-input between commands.
    const input = openSync(fifo, 'r+');
    const log = openSync(join(dirname(fifo), 'dhu.log'), 'a');
    const child = spawn(join(dhuDir, 'desktop-head-unit'), ['-c', config, ...(headless ? ['--headless'] : [])], { cwd: dhuDir, stdio: [input, log, log], detached: true });
    child.unref();
    return child.pid!;
  },
  sendDhu: async (fifo, line) => {
    // Non-blocking: with no head unit reading, this fails instead of hanging.
    const fh = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      await fh.write(`${line}\n`);
    } finally {
      await fh.close();
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill: (pid) => {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  },
  startEmulator: () =>
    new Promise((done, fail) => execFile('sh', [join(root, 'infra/scripts/android-emulator.sh'), 'start'], (err) => (err ? fail(err) : done()))),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  nowMs: () => Date.now(),
  log: (line) => console.log(line),
  onInterrupt: (fn) => {
    process.once('SIGINT', fn);
    process.once('SIGTERM', fn);
  },
});
