import { gridDisk } from 'h3-js';
import {
  type BBox,
  type CoverageResponse,
  type CoverageStats,
  VISIT_RES,
  bboxToCells,
  bigIntToCell,
  cellToBigInt,
  childCount,
  pointToCell,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { roadStats, roadsInView } from './roads.js';

const MAX_R5_FILTER = 4000;
const MAX_ROADS_OUT = 4000;

/** Res-5 cells (as bigint strings) covering a bbox, or null when the bbox is too large to filter by. */
export function r5CellsForBBox(bbox: BBox): string[] | null {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  if (width * height > 400) return null; // roughly a 20°×20° box — just load everything
  const core = bboxToCells(bbox, 5);
  // polygonToCells only returns cells whose centres fall inside; add a ring to cover edges.
  const seeds = core.length ? core : [pointToCell([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], 5)];
  const set = new Set<string>();
  for (const c of seeds) for (const n of gridDisk(c, 1)) set.add(n);
  if (set.size > MAX_R5_FILTER) return null;
  return [...set].map((c) => cellToBigInt(c).toString());
}

/** Visited VISIT_RES cells (hex strings) for a user, optionally limited to a bbox. */
export async function loadVisitedCells(db: DbClient, userId: string, bbox?: BBox): Promise<string[]> {
  return (await loadVisitedCellRows(db, userId, bbox)).map((r) => r.cell);
}

async function loadVisitedCellRows(db: DbClient, userId: string, bbox?: BBox): Promise<Array<{ cell: string; recent: boolean }>> {
  const r5 = bbox ? r5CellsForBBox(bbox) : null;
  const rows = (
    await db.query<{ cell: string; recent: boolean }>(
      `SELECT cell, first_visited_at > now() - interval '7 days' AS recent FROM visited_cells
       WHERE user_id = $1 ${r5 ? 'AND r5 = ANY($2::bigint[])' : ''}`,
      r5 ? [userId, r5] : [userId],
    )
  ).rows;
  return rows.map((r) => ({ cell: bigIntToCell(r.cell), recent: r.recent }));
}

export async function getCoverage(db: DbClient, userId: string, bbox: BBox, _zoom: number): Promise<CoverageResponse> {
  const roads = await roadsInView(db, userId, bbox, MAX_ROADS_OUT + 1);
  const truncated = roads.length > MAX_ROADS_OUT;
  return { roads: truncated ? roads.slice(0, MAX_ROADS_OUT) : roads, truncated };
}

/** Unexplored share (0–1) per AREA_RES cell for the given area cells. */
export async function areaUnexplored(db: DbClient, userId: string, areaCells: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(areaCells.map((c) => [c, 1]));
  if (areaCells.length === 0) return out;
  const rows = (
    await db.query<{ r7: string; n: string }>(
      'SELECT r7, count(*) AS n FROM visited_cells WHERE user_id = $1 AND r7 = ANY($2::bigint[]) GROUP BY r7',
      [userId, areaCells.map((c) => cellToBigInt(c).toString())],
    )
  ).rows;
  for (const r of rows) {
    const cell = bigIntToCell(r.r7);
    out.set(cell, Math.max(0, 1 - Number(r.n) / childCount(cell, VISIT_RES)));
  }
  return out;
}

export async function getCoverageStats(db: DbClient, userId: string): Promise<CoverageStats> {
  const [roads, first, trips] = await Promise.all([
    roadStats(db, userId),
    db.query<{ first: Date | null }>('SELECT min(first_visited_at) AS first FROM visited_ways WHERE user_id = $1', [userId]),
    db.query<{ n: string; d: number | null }>(
      'SELECT count(*) AS n, sum(distance_m) AS d FROM trips WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    ),
  ]);
  const t = trips.rows[0]!;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    roadKm: round(roads.km),
    roadsTravelled: roads.ways,
    newRoadsWeek: roads.newThisWeek,
    newRoadsMonth: roads.newThisMonth,
    byMode: { carKm: round(roads.carKm), footKm: round(roads.footKm) },
    firstVisitAt: first.rows[0]?.first ? first.rows[0]!.first!.toISOString() : null,
    tripCount: Number(t.n),
    distanceKm: round(Number(t.d ?? 0) / 1000),
  };
}

/** Coverage as GeoJSON lines, for clients that just hand it to a map layer. */
export function coverageToGeoJson(cov: CoverageResponse) {
  return {
    type: 'FeatureCollection' as const,
    features: cov.roads.map((r) => ({
      type: 'Feature' as const,
      properties: { wayId: r.wayId, recent: r.recent, modes: r.modes },
      geometry: { type: 'LineString' as const, coordinates: r.geometry },
    })),
  };
}
