import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAccessToken, hintFor, parseServiceAccount, PlayApiError, signJwt } from '../play/api.js';
import { type Deps, mergeReleases, PACKAGE_NAME, run, trackName } from '../play/cli.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = {
  type: 'service_account',
  client_email: 'publisher@wayfinder.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const NOW = 1_790_000_000;
const API = `/androidpublisher/v3/applications/${PACKAGE_NAME}`;

type Handler = (call: Call) => unknown;
interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake Google: routes are 'METHOD /path' (no host, no query); an undeclared call fails the test. */
function fakeGoogle(routes: Record<string, Handler | { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const raw = init.body;
    const body = typeof raw === 'string' && headers['content-type'] === 'application/json' ? JSON.parse(raw) : raw;
    const call: Call = { method: init.method ?? 'GET', path: u.pathname, query: u.searchParams, headers, body };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (!route) throw new Error(`Unexpected ${call.method} ${call.path}`);
    if (typeof route === 'function') return Response.json(route(call) ?? {});
    return Response.json(route.body, { status: route.status });
  };
  return { fetch, calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}

const signIn = { 'POST /token': () => ({ access_token: 'tok-1' }) };
const edit = {
  'POST /androidpublisher/v3/applications/app.wayfinder.maps/edits': () => ({ id: 'e1' }),
  [`DELETE ${API}/edits/e1`]: () => ({}),
  [`POST ${API}/edits/e1:commit`]: () => ({ id: 'e1' }),
  [`POST ${API}/edits/e1:validate`]: () => ({ id: 'e1' }),
};

function deps(google: ReturnType<typeof fakeGoogle>, files: Record<string, string | Buffer> = {}, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const all: Record<string, string | Buffer> = { 'infra/android/play-service-account.json': JSON.stringify(KEY), ...files };
  const d: Deps = {
    root: '/repo',
    env,
    readFile: async (path) => {
      const rel = path.replace('/repo/', '');
      const f = all[rel];
      if (f === undefined) throw new Error(`ENOENT ${rel}`);
      return Buffer.from(f);
    },
    readDir: async (path) => {
      const rel = path.replace('/repo/', '') + '/';
      const names = new Set(Object.keys(all).filter((p) => p.startsWith(rel)).map((p) => p.slice(rel.length).split('/')[0]!));
      return [...names];
    },
    fetch: google.fetch,
    log: (line) => lines.push(line),
    nowSeconds: () => NOW,
  };
  return { d, lines };
}

describe('service account sign-in', () => {
  it('signs an RS256 JWT for the androidpublisher scope that the public key verifies', () => {
    const jwt = signJwt(parseServiceAccount(JSON.stringify(KEY)), NOW);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      iss: KEY.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: NOW,
      exp: NOW + 3600,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it('trades the JWT for an access token at the key’s token_uri', async () => {
    const google = fakeGoogle({ 'POST /custom-token': () => ({ access_token: 'tok-9' }) });
    const sa = parseServiceAccount(JSON.stringify({ ...KEY, token_uri: 'https://oauth2.example.test/custom-token' }));
    expect(await getAccessToken(sa, google.fetch, NOW)).toBe('tok-9');
    const body = new URLSearchParams(google.calls[0]!.body as string);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(body.get('assertion')!.split('.')).toHaveLength(3);
  });

  it('explains a refused key', async () => {
    const google = fakeGoogle({ 'POST /token': { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } } });
    await expect(getAccessToken(parseServiceAccount(JSON.stringify(KEY)), google.fetch, NOW)).rejects.toThrow('Google refused the service account key: Invalid JWT Signature.');
  });

  it('rejects files that are not service account keys', () => {
    expect(() => parseServiceAccount('not json')).toThrow(/not JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user', client_email: 'a', private_key: 'b' }))).toThrow(/not a service account key/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'a' }))).toThrow(/not a service account key/);
  });
});

describe('hints for Play errors', () => {
  it.each([
    ['Only releases with status draft may be created on draft app.', 400, /without --rollout/],
    ['Package not found: app.wayfinder.maps.', 404, /upload the first bundle there by hand/],
    ['Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.', 400, /--no-review/],
    ['APK specifies a version code that has already been used.', 403, /Bump versionCode/],
    ['The caller does not have permission', 403, /Users and permissions/],
  ])('%s', (message, status, hint) => {
    expect(hintFor(new PlayApiError(message, status))).toMatch(hint);
  });

  it('has nothing to add for other errors', () => {
    expect(hintFor(new PlayApiError('Backend error', 500))).toBeUndefined();
  });
});

describe('mergeReleases', () => {
  const live = { versionCodes: ['4'], status: 'completed' as const };
  const oldDraft = { versionCodes: ['3'], status: 'draft' as const };
  it('keeps the live release and swaps the old draft for a new one', () => {
    expect(mergeReleases([live, oldDraft], { versionCodes: ['5'], status: 'draft' })).toEqual([live, { versionCodes: ['5'], status: 'draft' }]);
  });
  it('lets a rolled-out release replace everything on the track', () => {
    expect(mergeReleases([live, oldDraft], { versionCodes: ['5'], status: 'completed' })).toEqual([{ versionCodes: ['5'], status: 'completed' }]);
  });
  it('maps the friendly track names to Play’s', () => {
    expect([trackName('closed'), trackName('open'), trackName('internal'), trackName('production')]).toEqual(['alpha', 'beta', 'internal', 'production']);
  });
});

describe('pnpm play upload', () => {
  const aab = { 'dist/wayfinder.aab': Buffer.from('PK-bundle') };

  it('uploads the bundle as a draft on internal testing and commits', async () => {
    let trackBody: unknown;
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`POST /upload${API}/edits/e1/bundles`]: () => ({ versionCode: 5 }),
      [`GET ${API}/edits/e1/tracks/internal`]: () => ({ track: 'internal', releases: [{ versionCodes: ['4'], status: 'completed' }] }),
      [`PUT ${API}/edits/e1/tracks/internal`]: (c) => ((trackBody = c.body), {}),
    });
    const { d, lines } = deps(google, aab);
    expect(await run(['upload', '--notes', 'Faster start-up'], d)).toBe(0);

    const upload = google.calls.find((c) => c.path.endsWith('/bundles'))!;
    expect(upload.query.get('uploadType')).toBe('media');
    expect(upload.headers['content-type']).toBe('application/octet-stream');
    expect(upload.headers.authorization).toBe('Bearer tok-1');
    expect(Buffer.from(upload.body as Uint8Array).toString()).toBe('PK-bundle');
    expect(trackBody).toEqual({
      track: 'internal',
      releases: [
        { versionCodes: ['4'], status: 'completed' },
        { versionCodes: ['5'], status: 'draft', releaseNotes: [{ language: 'en-AU', text: 'Faster start-up' }] },
      ],
    });
    expect(google.paths().at(-1)).toBe(`POST ${API}/edits/e1:commit`);
    expect(google.calls.at(-1)!.query.has('changesNotSentForReview')).toBe(false);
    expect(lines).toContain('Uploaded dist/wayfinder.aab: versionCode 5.');
    expect(lines.at(-1)).toBe('Committed.');
  });

  it('rolls out to closed testing with a release name, without sending for review', async () => {
    let trackBody: unknown;
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`POST /upload${API}/edits/e1/bundles`]: () => ({ versionCode: 6 }),
      [`GET ${API}/edits/e1/tracks/alpha`]: () => ({ track: 'alpha' }),
      [`PUT ${API}/edits/e1/tracks/alpha`]: (c) => ((trackBody = c.body), {}),
    });
    const { d } = deps(google, aab);
    expect(await run(['upload', '--track', 'closed', '--rollout', '--name', '0.4.1', '--no-review'], d)).toBe(0);
    expect(trackBody).toEqual({ track: 'alpha', releases: [{ versionCodes: ['6'], status: 'completed', name: '0.4.1' }] });
    expect(google.calls.at(-1)!.query.get('changesNotSentForReview')).toBe('true');
  });

  it('on a dry run validates and throws the edit away', async () => {
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`POST /upload${API}/edits/e1/bundles`]: () => ({ versionCode: 5 }),
      [`GET ${API}/edits/e1/tracks/internal`]: () => ({ track: 'internal' }),
      [`PUT ${API}/edits/e1/tracks/internal`]: () => ({}),
    });
    const { d, lines } = deps(google, aab);
    expect(await run(['upload', '--dry-run'], d)).toBe(0);
    expect(google.paths().slice(-2)).toEqual([`POST ${API}/edits/e1:validate`, `DELETE ${API}/edits/e1`]);
    expect(google.paths()).not.toContain(`POST ${API}/edits/e1:commit`);
    expect(lines).toContain('Dry run: Play accepted these changes. Nothing was published.');
  });

  it('discards the edit and explains when Play refuses a live release on a draft app', async () => {
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`POST /upload${API}/edits/e1/bundles`]: () => ({ versionCode: 5 }),
      [`GET ${API}/edits/e1/tracks/internal`]: () => ({ track: 'internal' }),
      [`PUT ${API}/edits/e1/tracks/internal`]: { status: 400, body: { error: { code: 400, message: 'Only releases with status draft may be created on draft app.' } } },
    });
    const { d, lines } = deps(google, aab);
    expect(await run(['upload', '--rollout'], d)).toBe(1);
    expect(google.paths().at(-1)).toBe(`DELETE ${API}/edits/e1`);
    expect(lines).toEqual(['Uploaded dist/wayfinder.aab: versionCode 5.', 'Only releases with status draft may be created on draft app.', expect.stringMatching(/without --rollout/)]);
  });

  it('says how to build a bundle when there is none', async () => {
    const google = fakeGoogle({ ...signIn });
    const { d, lines } = deps(google);
    expect(await run(['upload'], d)).toBe(1);
    expect(lines[0]).toMatch(/No bundle at \/repo\/dist\/wayfinder.aab. Build one with infra\/scripts\/build-apk.sh/);
  });

  it('says where the key goes when there is none, and reads PLAY_SERVICE_ACCOUNT', async () => {
    const google = fakeGoogle({});
    const { d, lines } = deps(google, {}, { PLAY_SERVICE_ACCOUNT: 'elsewhere/key.json' });
    expect(await run(['status'], d)).toBe(1);
    expect(lines[0]).toMatch(/No service account key at \/repo\/elsewhere\/key.json/);
    expect(google.calls).toEqual([]);
  });
});

describe('pnpm play promote', () => {
  it('puts an uploaded versionCode on closed testing without uploading anything', async () => {
    let trackBody: unknown;
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`GET ${API}/edits/e1/tracks/alpha`]: () => ({ track: 'alpha', releases: [] }),
      [`PUT ${API}/edits/e1/tracks/alpha`]: (c) => ((trackBody = c.body), {}),
    });
    const { d } = deps(google);
    expect(await run(['promote', '--version-code', '5', '--rollout'], d)).toBe(0);
    expect(trackBody).toEqual({ track: 'alpha', releases: [{ versionCodes: ['5'], status: 'completed' }] });
    expect(google.paths().some((p) => p.includes('/upload/'))).toBe(false);
  });

  it('needs a versionCode', async () => {
    const google = fakeGoogle({ ...signIn });
    const { d, lines } = deps(google);
    expect(await run(['promote', '--track', 'production'], d)).toBe(1);
    expect(lines[0]).toMatch(/promote needs --version-code N/);
  });
});

describe('pnpm play status', () => {
  it('lists each track’s releases and closes the edit', async () => {
    const google = fakeGoogle({
      ...signIn,
      ...edit,
      [`GET ${API}/edits/e1/tracks`]: () => ({
        tracks: [
          { track: 'internal', releases: [{ name: '0.4.0', versionCodes: ['5'], status: 'completed' }] },
          { track: 'production', releases: [{ versionCodes: ['5'], status: 'inProgress', userFraction: 0.2 }] },
          { track: 'alpha' },
        ],
      }),
    });
    const { d, lines } = deps(google, {}, { PLAY_PACKAGE_NAME: 'app.wayfinder.maps' });
    expect(await run(['status'], d)).toBe(0);
    expect(lines).toEqual([
      'app.wayfinder.maps, signed in as publisher@wayfinder.iam.gserviceaccount.com',
      '  internal: 0.4.0 [5] completed',
      '  production: (no name) [5] inProgress to 20%',
      '  alpha: nothing',
    ]);
    expect(google.paths().at(-1)).toBe(`DELETE ${API}/edits/e1`);
  });

  it('explains a service account Play hasn’t been told about', async () => {
    const google = fakeGoogle({
      ...signIn,
      [`POST ${API}/edits`]: { status: 403, body: { error: { code: 403, message: 'The caller does not have permission' } } },
    });
    const { d, lines } = deps(google);
    expect(await run(['status'], d)).toBe(1);
    expect(lines).toEqual(['The caller does not have permission', expect.stringMatching(/Users and permissions/)]);
  });
});

describe('pnpm play listing', () => {
  const listing = (over: Record<string, string> = {}) => ({
    'store/play/listing/en-AU/title.txt': 'Wayfinder\n',
    'store/play/listing/en-AU/short-description.txt': 'Roads you have not driven.',
    'store/play/listing/en-AU/full-description.txt': 'A map for explorers.',
    'store/play/icon-512.png': 'ICON',
    'store/play/feature-graphic.png': 'FEATURE',
    ...over,
  });
  const routes = (record: Call[]) => ({
    ...signIn,
    ...edit,
    [`PUT ${API}/edits/e1/listings/en-AU`]: (c: Call) => (record.push(c), {}),
    [`DELETE ${API}/edits/e1/listings/en-AU/icon`]: (c: Call) => (record.push(c), {}),
    [`POST /upload${API}/edits/e1/listings/en-AU/icon`]: (c: Call) => (record.push(c), {}),
    [`DELETE ${API}/edits/e1/listings/en-AU/featureGraphic`]: (c: Call) => (record.push(c), {}),
    [`POST /upload${API}/edits/e1/listings/en-AU/featureGraphic`]: (c: Call) => (record.push(c), {}),
    [`DELETE ${API}/edits/e1/listings/en-AU/phoneScreenshots`]: (c: Call) => (record.push(c), {}),
    [`POST /upload${API}/edits/e1/listings/en-AU/phoneScreenshots`]: (c: Call) => (record.push(c), {}),
  });

  it('sends the text and graphics, leaving screenshots alone when there are none', async () => {
    const record: Call[] = [];
    const google = fakeGoogle(routes(record));
    const { d, lines } = deps(google, listing());
    expect(await run(['listing'], d)).toBe(0);
    expect(record[0]!.body).toEqual({ language: 'en-AU', title: 'Wayfinder', shortDescription: 'Roads you have not driven.', fullDescription: 'A map for explorers.' });
    expect(record.map((c) => `${c.method} ${c.path.split('/').pop()}`)).toEqual(['PUT en-AU', 'DELETE icon', 'POST icon', 'DELETE featureGraphic', 'POST featureGraphic']);
    expect(record[2]!.headers['content-type']).toBe('image/png');
    expect(lines[0]).toMatch(/no phone screenshots yet/);
    expect(lines.at(-1)).toBe('Committed.');
  });

  it('replaces phone screenshots in file-name order', async () => {
    const record: Call[] = [];
    const google = fakeGoogle(routes(record));
    const { d } = deps(google, listing({ 'store/play/screenshots/phone/2-route.png': 'TWO', 'store/play/screenshots/phone/1-map.png': 'ONE', 'store/play/screenshots/phone/notes.txt': 'x' }));
    expect(await run(['listing'], d)).toBe(0);
    const shots = record.filter((c) => c.method === 'POST' && c.path.endsWith('phoneScreenshots'));
    expect(shots.map((c) => Buffer.from(c.body as Uint8Array).toString())).toEqual(['ONE', 'TWO']);
  });

  it('refuses text longer than Play allows before calling Play', async () => {
    const google = fakeGoogle({ ...signIn });
    const { d, lines } = deps(google, listing({ 'store/play/listing/en-AU/title.txt': 'Wayfinder: maps for the roads less travelled' }));
    expect(await run(['listing'], d)).toBe(1);
    expect(lines[0]).toBe('en-AU title is 44 characters; Play takes 1 to 30.');
    expect(google.paths()).toEqual(['POST /token']);
  });

  it('refuses a single screenshot', async () => {
    const google = fakeGoogle({ ...signIn });
    const { d, lines } = deps(google, listing({ 'store/play/screenshots/phone/1.png': 'ONE' }));
    expect(await run(['listing'], d)).toBe(1);
    expect(lines[0]).toMatch(/2 to 8 phone screenshots; store\/play\/screenshots\/phone has 1/);
  });

  it('needs a listing folder', async () => {
    const google = fakeGoogle({ ...signIn });
    const { d, lines } = deps(google, {});
    expect(await run(['listing'], d)).toBe(1);
    expect(lines[0]).toMatch(/No listings found/);
  });
});

describe('pnpm play', () => {
  it('prints usage for an unknown command', async () => {
    const { d, lines } = deps(fakeGoogle({}));
    expect(await run(['publish'], d)).toBe(2);
    expect(lines[0]).toMatch(/^Usage:/);
  });

  it('uses the package name the Android app is built with', () => {
    const config = readFileSync(resolve(__dirname, '../../apps/mobile/app.config.ts'), 'utf8');
    expect(config).toContain(`package: '${PACKAGE_NAME}'`);
  });

  it('keeps the real listing within Play’s limits', async () => {
    const root = resolve(__dirname, '../..');
    const { readListings } = await import('../play/cli.js');
    const [en] = await readListings({ ...deps(fakeGoogle({})).d, root, readFile: async (p) => readFileSync(p), readDir: async (p) => (await import('node:fs/promises')).readdir(p).catch(() => []) });
    expect(en!.listing.language).toBe('en-AU');
    expect(en!.listing.title).toBe('Wayfinder');
    expect(readFileSync(join(root, 'store/play/listing/en-AU/full-description.txt'), 'utf8')).not.toMatch(/hexagon/i);
  });
});
