/** Entry point for `pnpm play …`; the commands are in scripts/play/cli.ts. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { run } from './play/cli.js';

const root = resolve(import.meta.dirname, '..');
process.exitCode = await run(process.argv.slice(2), {
  root,
  env: process.env,
  readFile: (path) => readFile(path),
  readDir: (path) => readdir(path).catch(() => []),
  fetch: (url, init) => fetch(url, init),
  log: (line) => console.log(line),
  nowSeconds: () => Math.floor(Date.now() / 1000),
});
