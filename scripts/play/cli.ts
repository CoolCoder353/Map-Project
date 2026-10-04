/**
 * `pnpm play …`: release the Android app to Google Play from this machine.
 *
 *   pnpm play status                                  what is on each track
 *   pnpm play upload [--track internal] [--rollout]   upload dist/wayfinder.aab
 *   pnpm play promote --version-code 5 --track closed  put an uploaded build on another track
 *   pnpm play listing                                 sync store/play text and graphics
 *
 * Releases are drafts unless --rollout is given. --dry-run makes the same changes in an edit,
 * asks Play to validate them, then throws the edit away. The service account key is read from
 * PLAY_SERVICE_ACCOUNT (default infra/android/play-service-account.json, not in git). Setup is in
 * docs/play-store-android-auto.md.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Fetch, getAccessToken, hintFor, type Listing, parseServiceAccount, PlayApi, PlayApiError, type Release } from './api.js';

export const PACKAGE_NAME = 'app.wayfinder.maps';
export const DEFAULT_KEY = 'infra/android/play-service-account.json';
export const DEFAULT_BUNDLE = 'dist/wayfinder.aab';
export const LISTING_DIR = 'store/play/listing';

export interface Deps {
  root: string;
  env: Record<string, string | undefined>;
  readFile: (path: string) => Promise<Buffer>;
  /** File names in a directory, or [] when it doesn't exist. */
  readDir: (path: string) => Promise<string[]>;
  fetch: Fetch;
  log: (line: string) => void;
  nowSeconds: () => number;
}

const TRACK_ALIASES: Record<string, string> = { closed: 'alpha', open: 'beta' };
export const trackName = (name: string) => TRACK_ALIASES[name] ?? name;

const USAGE = `Usage:
  pnpm play status
  pnpm play upload [--aab ${DEFAULT_BUNDLE}] [--track internal|closed|open|production] [--rollout] [--notes "…"]
  pnpm play promote --version-code N [--track closed] [--rollout] [--notes "…"]
  pnpm play listing
Options for every change: --dry-run (validate, change nothing), --no-review (don't send for review on commit)`;

const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

/** The track's releases after adding `release`: a live release replaces everything, a draft replaces only the old draft. */
export function mergeReleases(existing: Release[], release: Release): Release[] {
  if (release.status === 'draft') return [...existing.filter((r) => r.status !== 'draft'), release];
  return [release];
}

export async function readListings(deps: Deps): Promise<{ listing: Listing; screenshots: Buffer[] }[]> {
  const dir = join(deps.root, LISTING_DIR);
  const languages = (await deps.readDir(dir)).sort();
  if (languages.length === 0) throw new Error(`No listings found in ${LISTING_DIR}/<language>/.`);
  const shotsDir = join(deps.root, 'store/play/screenshots/phone');
  const shotNames = (await deps.readDir(shotsDir)).filter((f) => f.endsWith('.png')).sort();
  if (shotNames.length === 1 || shotNames.length > 8) throw new Error(`Play takes 2 to 8 phone screenshots; store/play/screenshots/phone has ${shotNames.length}.`);
  const screenshots = await Promise.all(shotNames.map((f) => deps.readFile(join(shotsDir, f))));
  const text = async (language: string, file: string) => (await deps.readFile(join(dir, language, file))).toString('utf8').trim();
  return Promise.all(
    languages.map(async (language) => {
      const listing: Listing = {
        language,
        title: await text(language, 'title.txt'),
        shortDescription: await text(language, 'short-description.txt'),
        fullDescription: await text(language, 'full-description.txt'),
      };
      for (const [field, max] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
        const length = [...listing[field]].length;
        if (length === 0 || length > max) throw new Error(`${language} ${field} is ${length} characters; Play takes 1 to ${max}.`);
      }
      return { listing, screenshots };
    }),
  );
}

/** Opens an edit, runs `change`, then commits it, or validates and discards it on a dry run. */
async function inEdit(api: PlayApi, opts: { dryRun: boolean; sendForReview: boolean }, log: Deps['log'], change: (editId: string) => Promise<void>) {
  const editId = await api.insertEdit();
  let done = false;
  try {
    await change(editId);
    if (opts.dryRun) {
      await api.validateEdit(editId);
      log('Dry run: Play accepted these changes. Nothing was published.');
    } else {
      await api.commitEdit(editId, { sendForReview: opts.sendForReview });
      done = true;
      log('Committed.');
    }
  } finally {
    if (!done) await api.deleteEdit(editId).catch(() => undefined);
  }
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      aab: { type: 'string', default: DEFAULT_BUNDLE },
      track: { type: 'string' },
      'version-code': { type: 'string' },
      rollout: { type: 'boolean', default: false },
      notes: { type: 'string' },
      name: { type: 'string' },
      language: { type: 'string', default: 'en-AU' },
      'dry-run': { type: 'boolean', default: false },
      'no-review': { type: 'boolean', default: false },
    },
  });
  if (!command || !['status', 'upload', 'promote', 'listing'].includes(command)) {
    deps.log(USAGE);
    return 2;
  }

  try {
    const keyPath = join(deps.root, deps.env.PLAY_SERVICE_ACCOUNT ?? DEFAULT_KEY);
    const keyText = await deps.readFile(keyPath).catch(() => {
      throw new Error(`No service account key at ${keyPath}. Make one in Google Cloud and save it there (docs/play-store-android-auto.md).`);
    });
    const sa = parseServiceAccount(keyText.toString('utf8'));
    const token = await getAccessToken(sa, deps.fetch, deps.nowSeconds());
    const packageName = deps.env.PLAY_PACKAGE_NAME ?? PACKAGE_NAME;
    const api = new PlayApi(packageName, token, deps.fetch);
    const editOpts = { dryRun: values['dry-run'], sendForReview: !values['no-review'] };

    if (command === 'status') {
      const editId = await api.insertEdit();
      try {
        const tracks = await api.listTracks(editId);
        deps.log(`${packageName}, signed in as ${sa.client_email}`);
        for (const t of tracks) {
          const releases = t.releases ?? [];
          if (releases.length === 0) deps.log(`  ${t.track}: nothing`);
          for (const r of releases) {
            const fraction = r.userFraction ? ` to ${Math.round(r.userFraction * 100)}%` : '';
            deps.log(`  ${t.track}: ${r.name ?? '(no name)'} [${(r.versionCodes ?? []).join(', ')}] ${r.status}${fraction}`);
          }
        }
      } finally {
        await api.deleteEdit(editId).catch(() => undefined);
      }
      return 0;
    }

    if (command === 'listing') {
      const listings = await readListings(deps);
      const icon = await deps.readFile(join(deps.root, 'store/play/icon-512.png'));
      const feature = await deps.readFile(join(deps.root, 'store/play/feature-graphic.png'));
      await inEdit(api, editOpts, deps.log, async (editId) => {
        for (const { listing, screenshots } of listings) {
          await api.updateListing(editId, listing);
          await api.replaceImages(editId, listing.language, 'icon', [icon]);
          await api.replaceImages(editId, listing.language, 'featureGraphic', [feature]);
          if (screenshots.length > 0) await api.replaceImages(editId, listing.language, 'phoneScreenshots', screenshots);
          deps.log(`Listing ${listing.language}: text, icon, feature graphic${screenshots.length ? `, ${screenshots.length} phone screenshots` : ' (no phone screenshots yet, left as they are)'}.`);
        }
      });
      return 0;
    }

    const track = trackName(values.track ?? (command === 'upload' ? 'internal' : 'alpha'));
    let bundle: Buffer | undefined;
    if (command === 'upload') {
      const path = join(deps.root, values.aab);
      bundle = await deps.readFile(path).catch(() => {
        throw new Error(`No bundle at ${path}. Build one with infra/scripts/build-apk.sh (docs/build-android.md).`);
      });
    } else if (!/^\d+$/.test(values['version-code'] ?? '')) {
      throw new Error('promote needs --version-code N, the build to put on the track (see `pnpm play status`).');
    }

    await inEdit(api, editOpts, deps.log, async (editId) => {
      const versionCode = bundle ? String(await api.uploadBundle(editId, bundle)) : values['version-code']!;
      if (bundle) deps.log(`Uploaded ${values.aab}: versionCode ${versionCode}.`);
      const release: Release = {
        versionCodes: [versionCode],
        status: values.rollout ? 'completed' : 'draft',
        ...(values.name ? { name: values.name } : {}),
        ...(values.notes ? { releaseNotes: [{ language: values.language, text: values.notes }] } : {}),
      };
      const existing = (await api.getTrack(editId, track)).releases ?? [];
      await api.updateTrack(editId, track, mergeReleases(existing, release));
      deps.log(`${track}: versionCode ${versionCode} as ${values.rollout ? 'a release rolled out to everyone on the track' : 'a draft (roll it out in Play Console, or run again with --rollout)'}.`);
    });
    return 0;
  } catch (e) {
    deps.log(e instanceof Error ? e.message : String(e));
    const hint = e instanceof PlayApiError ? hintFor(e) : undefined;
    if (hint) deps.log(hint);
    return 1;
  }
}
