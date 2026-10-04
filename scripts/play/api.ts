/**
 * A small client for the Google Play Developer API (androidpublisher v3), enough to upload a
 * bundle, put it on a track and keep the store listing in step with `store/play`.
 *
 * It signs in as a service account (a JSON key made in Google Cloud and invited in Play Console),
 * so releases can be made from this machine without a browser. Every change happens inside an
 * "edit", Play's transaction: nothing is visible until the edit is committed.
 */
import { createSign } from 'node:crypto';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';

export function parseServiceAccount(text: string): ServiceAccount {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The service account key is not JSON. Download it again from Google Cloud (Keys → Add key → JSON).');
  }
  const sa = json as Partial<ServiceAccount> & { type?: string };
  if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
    throw new Error('That file is not a service account key: it needs "type": "service_account", client_email and private_key.');
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** The signed JWT a service account trades for an access token (RFC 7523). */
export function signJwt(sa: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

export async function getAccessToken(sa: ServiceAccount, fetch: Fetch, nowSeconds: number): Promise<string> {
  const res = await fetch(sa.token_uri ?? DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa, nowSeconds) }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new PlayApiError(`Google refused the service account key: ${body.error_description ?? body.error ?? res.status}`, res.status);
  }
  return body.access_token;
}

export class PlayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PlayApiError';
  }
}

/** Plain-English next steps for the errors a first setup runs into. */
export function hintFor(error: PlayApiError): string | undefined {
  const m = error.message;
  if (/has not been used in project|androidpublisher\.googleapis\.com\/overview/i.test(m)) {
    return 'The Google Play Android Developer API is switched off in the service account\'s Google Cloud project. Open the link above, press Enable, wait a few minutes and try again.';
  }
  if (/only releases with status draft/i.test(m)) {
    return 'The app has never been published, so Play only takes draft releases. Run again without --rollout, then roll the draft out in Play Console.';
  }
  if (/package not found/i.test(m) || error.status === 404) {
    return 'Play does not know this app yet. Create it in Play Console and upload the first bundle there by hand; the API can only update an app after that.';
  }
  if (/changesNotSentForReview/i.test(m)) {
    return 'Play will not send these changes for review automatically. Run again with --no-review, then press "Send for review" on the Publishing overview page.';
  }
  if (/version code .* already been used/i.test(m)) {
    return 'That versionCode is already on Play. Bump versionCode in apps/mobile/app.config.ts and rebuild, or use `promote` to move the existing one.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'The service account is not allowed to do this. In Play Console → Users and permissions, check it is invited with the release and store presence permissions for this app. New invites can take a few minutes to start working.';
  }
  return undefined;
}

export interface Release {
  name?: string;
  versionCodes?: string[];
  status: 'draft' | 'inProgress' | 'halted' | 'completed';
  userFraction?: number;
  releaseNotes?: { language: string; text: string }[];
}

export interface Track {
  track: string;
  releases?: Release[];
}

export interface Listing {
  language: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
}

/** The store's contact details, shown on the listing. */
export interface AppDetails {
  contactEmail?: string;
  contactWebsite?: string;
  contactPhone?: string;
}

export type ImageType = 'icon' | 'featureGraphic' | 'phoneScreenshots' | 'sevenInchScreenshots' | 'tenInchScreenshots';

export class PlayApi {
  constructor(
    private readonly packageName: string,
    private readonly token: string,
    private readonly fetch: Fetch,
  ) {}

  private async call<T>(method: string, url: string, body?: { json: unknown } | { bytes: Uint8Array; contentType: string }): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    let payload: BodyInit | undefined;
    if (body && 'json' in body) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body) {
      headers['content-type'] = body.contentType;
      payload = body.bytes as BodyInit;
    }
    const res = await this.fetch(url, { method, headers, body: payload });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const message = (json as { error?: { message?: string } }).error?.message ?? `${method} ${url} failed with ${res.status}`;
      throw new PlayApiError(message, res.status);
    }
    return json as T;
  }

  private app(path: string) {
    return `${API}/${encodeURIComponent(this.packageName)}${path}`;
  }

  private upload(path: string) {
    return `${UPLOAD}/${encodeURIComponent(this.packageName)}${path}?uploadType=media`;
  }

  async insertEdit(): Promise<string> {
    const edit = await this.call<{ id: string }>('POST', this.app('/edits'), { json: {} });
    return edit.id;
  }

  async deleteEdit(editId: string): Promise<void> {
    await this.call('DELETE', this.app(`/edits/${editId}`));
  }

  async validateEdit(editId: string): Promise<void> {
    await this.call('POST', this.app(`/edits/${editId}:validate`));
  }

  async commitEdit(editId: string, opts: { sendForReview: boolean }): Promise<void> {
    const query = opts.sendForReview ? '' : '?changesNotSentForReview=true';
    await this.call('POST', this.app(`/edits/${editId}:commit${query}`));
  }

  /** Uploads an .aab and returns its versionCode. */
  async uploadBundle(editId: string, bytes: Uint8Array): Promise<number> {
    const bundle = await this.call<{ versionCode: number }>('POST', this.upload(`/edits/${editId}/bundles`), { bytes, contentType: 'application/octet-stream' });
    return bundle.versionCode;
  }

  async listTracks(editId: string): Promise<Track[]> {
    const res = await this.call<{ tracks?: Track[] }>('GET', this.app(`/edits/${editId}/tracks`));
    return res.tracks ?? [];
  }

  async getTrack(editId: string, track: string): Promise<Track> {
    return this.call<Track>('GET', this.app(`/edits/${editId}/tracks/${encodeURIComponent(track)}`));
  }

  async updateTrack(editId: string, track: string, releases: Release[]): Promise<void> {
    await this.call('PUT', this.app(`/edits/${editId}/tracks/${encodeURIComponent(track)}`), { json: { track, releases } });
  }

  async updateListing(editId: string, listing: Listing): Promise<void> {
    await this.call('PUT', this.app(`/edits/${editId}/listings/${listing.language}`), { json: listing });
  }

  async updateDetails(editId: string, details: AppDetails): Promise<void> {
    await this.call('PATCH', this.app(`/edits/${editId}/details`), { json: details });
  }

  /** Replaces every image of one type with the given PNGs, in order. */
  async replaceImages(editId: string, language: string, type: ImageType, images: Uint8Array[]): Promise<void> {
    await this.call('DELETE', this.app(`/edits/${editId}/listings/${language}/${type}`));
    for (const bytes of images) {
      await this.call('POST', this.upload(`/edits/${editId}/listings/${language}/${type}`), { bytes, contentType: 'image/png' });
    }
  }
}
