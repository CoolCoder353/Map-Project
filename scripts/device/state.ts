import { join } from 'node:path';

/** `.harness/config.json` (git-ignored): the test account and the phones the harness may use. No secrets. */
export interface Config {
  testAccountEmail: string;
  phones: string[];
  /** How the head unit's tap grid compares with its screenshots (see dhuCommand.tap). */
  carTapScale?: number;
}

/** `.harness/session.json`: what `up` set going, so `down` can undo every part of it. */
export interface Session {
  serial: string;
  emulator: boolean;
  /** The test account's email once `up` has read it on Wayfinder's Settings; null while unconfirmed. */
  account: string | null;
  testProvider: boolean;
  forward: boolean;
  dhu: { pid: number; fifo: string } | null;
  startedEmulator: boolean;
  /** Epoch seconds; `logs` shows lines after this. */
  logsSince: number;
}

export interface Files {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const harnessDir = (root: string) => join(root, '.harness');
const configPath = (root: string) => join(harnessDir(root), 'config.json');
const sessionPath = (root: string) => join(harnessDir(root), 'session.json');

export async function loadConfig(files: Files, root: string): Promise<Config> {
  const text = await files.read(configPath(root));
  const c = text ? (JSON.parse(text) as Partial<Config>) : {};
  return { testAccountEmail: c.testAccountEmail ?? '', phones: c.phones ?? [], ...(c.carTapScale ? { carTapScale: c.carTapScale } : {}) };
}
export const saveConfig = (files: Files, root: string, c: Config) => files.write(configPath(root), `${JSON.stringify(c, null, 2)}\n`);

export async function loadSession(files: Files, root: string): Promise<Session | null> {
  const text = await files.read(sessionPath(root));
  return text ? (JSON.parse(text) as Session) : null;
}
export const saveSession = (files: Files, root: string, s: Session) => files.write(sessionPath(root), `${JSON.stringify(s, null, 2)}\n`);
export const clearSession = (files: Files, root: string) => files.remove(sessionPath(root));
