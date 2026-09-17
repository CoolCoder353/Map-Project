import { gridDisk } from 'h3-js';
import {
  type BBox,
  type CoverageResponse,
  type CoverageStats,
  VISIT_RES,
  bboxToCells,
  bigIntToCell,
  cellAreaKm2,
  cellToBigInt,
  childCount,
  coverageResForZoom,
  parentCell,
  pointToCell,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';

const MAX_R5_FILTER = 4000;
const MAX_CELLS_OUT = 25_000;

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
  const r5 = bbox ? r5CellsForBBox(bbox) : null;
  const rows = (
    await db.query<{ cell: string }>(
      r5
        ? 'SELECT cell FROM visited_cells WHERE user_id = $1 AND r5 = ANY($2::bigint[])'
        : 'SELECT cell FROM visited_cells WHERE user_id = $1',
      r5 ? [userId, r5] : [userId],
    )
  ).rows;
  return rows.map((r) => bigIntToCell(r.cell));
}

export async function getCoverage(db: DbClient, userId: string, bbox: BBox, zoom: number): Promise<CoverageResponse> {
  const res = coverageResForZoom(zoom);
  const visited = await loadVisitedCells(db, userId, bbox);
  let cells: CoverageResponse['cells'];
  if (res === VISIT_RES) {
    cells = visited.map((h3) => ({ h3, fraction: 1 }));
  } else {
    const counts = new Map<string, number>();
    for (const c of visited) {
      const p = parentCell(c, res);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    cells = [...counts].map(([h3, n]) => ({ h3, fraction: Math.min(1, n / childCount(h3, VISIT_RES)) }));
  }
  const truncated = cells.length > MAX_CELLS_OUT;
  if (truncated) cells = cells.sort((a, b) => b.fraction - a.fraction).slice(0, MAX_CELLS_OUT);
  return { res, cells, truncated };
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
  const s = (
    await db.query<{
      cells: string;
      week: string;
      month: string;
      car: string;
      foot: string;
      first: Date | null;
      sample: string | null;
    }>(
      `SELECT count(*) AS cells,
              count(*) FILTER (WHERE first_visited_at > now() - interval '7 days') AS week,
              count(*) FILTER (WHERE first_visited_at > now() - interval '30 days') AS month,
              count(*) FILTER (WHERE modes & 1 = 1) AS car,
              count(*) FILTER (WHERE modes & 2 = 2) AS foot,
              min(first_visited_at) AS first,
              min(cell)::text AS sample
       FROM visited_cells WHERE user_id = $1`,
      [userId],
    )
  ).rows[0]!;
  const t = (
    await db.query<{ n: string; d: number | null }>(
      'SELECT count(*) AS n, sum(distance_m) AS d FROM trips WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    )
  ).rows[0]!;
  const cells = Number(s.cells);
  // Res-9 cells vary only slightly in area; use a sample cell's area.
  const perCell = s.sample ? cellAreaKm2(bigIntToCell(s.sample)) : 0.105;
  return {
    cellsVisited: cells,
    areaKm2: Math.round(cells * perCell * 100) / 100,
    newCellsWeek: Number(s.week),
    newCellsMonth: Number(s.month),
    byMode: { car: Number(s.car), foot: Number(s.foot) },
    firstVisitAt: s.first ? s.first.toISOString() : null,
    tripCount: Number(t.n),
    distanceKm: Math.round((Number(t.d ?? 0) / 1000) * 10) / 10,
  };
}
