import type { LngLat } from '@wayfinder/shared';
import { AppError, unavailable } from './errors.js';

export interface GhInstruction {
  distance: number;
  sign: number;
  interval: [number, number];
  text: string;
  time: number;
  street_name?: string;
  exit_number?: number;
}

export interface GhPath {
  distance: number;
  /** milliseconds */
  time: number;
  points: { type: 'LineString'; coordinates: LngLat[] };
  instructions: GhInstruction[];
  snapped_waypoints?: { coordinates: LngLat[] };
  /** Path details, as [firstPoint, lastPoint, value] runs. `max_speed` is km/h, null where unmapped. */
  details?: { osm_way_id?: Array<[number, number, number]>; max_speed?: Array<[number, number, number | null]> };
}

export interface CustomModel {
  priority?: Array<{ if?: string; else_if?: string; else?: string; multiply_by: number | string }>;
  speed?: Array<{ if?: string; else_if?: string; else?: string; multiply_by?: number | string; limit_to?: number | string }>;
  distance_influence?: number;
  areas?: {
    type: 'FeatureCollection';
    features: Array<{ type: 'Feature'; id: string; properties: Record<string, unknown>; geometry: unknown }>;
  };
}

export interface RouteParams {
  points: LngLat[];
  profile: string;
  customModel?: CustomModel;
  alternatives?: number;
  /** Keep going through via points instead of turning around at them. */
  passThrough?: boolean;
  signal?: AbortSignal;
}

const pointCount = (init?: RequestInit) => {
  try {
    return typeof init?.body === 'string' ? ((JSON.parse(init.body) as { points?: unknown[] }).points?.length ?? 1) : 1;
  } catch {
    return 1;
  }
};

/** GraphHopper's 400 messages carry lat,lon pairs and engine jargon; people get plain words. */
export function noRouteMessage(raw: string, points: number): string {
  const missing = /Cannot find point (\d+)/.exec(raw);
  if (missing) {
    const i = Number(missing[1]);
    const where = i === 0 ? 'your start' : i === points - 1 ? 'your destination' : 'one of your stops';
    return `There is no road or path near ${where}. Try moving it closer to one.`;
  }
  if (/Connection between locations not found/i.test(raw)) {
    return 'These places are not connected by roads or paths for this mode of travel.';
  }
  return 'No route could be found between these places.';
}

export class GraphHopperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch (err) {
      throw unavailable(`Routing engine unreachable: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string } & T;
    if (!res.ok) {
      const message = body.message ?? `GraphHopper error ${res.status}`;
      if (res.status === 400) {
        // Points outside the map, no connection between them, etc.
        throw new AppError(422, 'no_route', noRouteMessage(message, pointCount(init)));
      }
      throw unavailable(message);
    }
    return body;
  }

  /**
   * Snap a recorded track onto the road network. Returns null when the track can't be matched —
   * off-road walking, or GPS too sparse — and the raw line is all there is.
   */
  async match(points: ReadonlyArray<{ lon: number; lat: number; ts?: number }>, profile: string): Promise<GhPath | null> {
    if (points.length < 2) return null;
    const trkpt = points
      .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ts ? `<time>${new Date(p.ts).toISOString()}</time>` : ''}</trkpt>`)
      .join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><trkseg>${trkpt}</trkseg></trk></gpx>`;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/match?profile=${encodeURIComponent(profile)}&points_encoded=false&details=osm_way_id`, {
        method: 'POST',
        headers: { 'content-type': 'application/gpx+xml' },
        body: gpx,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { paths?: GhPath[] };
      return body.paths?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async route(p: RouteParams): Promise<GhPath[]> {
    const body: Record<string, unknown> = {
      points: p.points,
      profile: p.profile,
      points_encoded: false,
      instructions: true,
      calc_points: true,
      locale: 'en',
      // Which OSM way each stretch belongs to (the unit of road coverage), and its speed limit.
      details: ['osm_way_id', 'max_speed'],
    };
    if (p.passThrough && p.points.length > 2) {
      body['ch.disable'] = true;
      body.pass_through = true;
    }
    if (p.customModel) {
      // Per-request custom models need the flexible (LM / A*) algorithms.
      body['ch.disable'] = true;
      body.custom_model = p.customModel;
    }
    if (p.alternatives && p.alternatives > 1 && p.points.length === 2) {
      body['ch.disable'] = true;
      body.algorithm = 'alternative_route';
      body['alternative_route.max_paths'] = p.alternatives;
    }
    const res = await this.request<{ paths: GhPath[] }>('/route', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(p.signal ? { signal: p.signal } : {}),
    });
    return res.paths;
  }

  /** Reachable area within timeLimitS as polygon rings ([lon, lat]). */
  async isochrone(point: LngLat, profile: string, timeLimitS: number): Promise<LngLat[][]> {
    const q = new URLSearchParams({
      point: `${point[1]},${point[0]}`,
      profile,
      time_limit: String(Math.round(timeLimitS)),
      buckets: '1',
    });
    const res = await this.request<{
      polygons: Array<{ geometry: { type: string; coordinates: LngLat[][] | LngLat[][][] } }>;
    }>(`/isochrone?${q}`);
    const rings: LngLat[][] = [];
    for (const f of res.polygons) {
      if (f.geometry.type === 'Polygon') rings.push((f.geometry.coordinates as LngLat[][])[0]!);
      else if (f.geometry.type === 'MultiPolygon')
        for (const poly of f.geometry.coordinates as LngLat[][][]) rings.push(poly[0]!);
    }
    return rings;
  }

  async health(): Promise<{ up: boolean; latencyMs: number | null; detail: string | null }> {
    const start = performance.now();
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return { up: res.ok, latencyMs: performance.now() - start, detail: res.ok ? null : `HTTP ${res.status}` };
    } catch (err) {
      return { up: false, latencyMs: null, detail: (err as Error).message };
    }
  }

  async dataDate(): Promise<string | null> {
    try {
      const res = await this.request<{ data_date?: string }>('/info');
      return res.data_date ?? null;
    } catch {
      return null;
    }
  }
}
