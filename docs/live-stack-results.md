# Live stack results

Recorded 2026-09-18 on the development machine (12 threads, 31 GB RAM), running the Docker
stack with the Geofabrik Australia extract dated 2026-09-16.

## Data pipeline

| Step | Result |
|---|---|
| OSM refresh (graph, tiles, places, swap) | succeeded in 39 min |
| GraphHopper graph | car + foot, CH + LM; 6.03 M car nodes |
| Vector tiles (Planetiler → PMTiles) | z0–14, 16 layers |
| Places | imported; suburb, POI, fuzzy and reverse search all work |

A failed run now resumes: the graph and tiles are reused if they are newer than the extract.

## `pnpm verify:stack` — 15/15

| Check | Result |
|---|---|
| Health, public config, style, tilejson | ok |
| Vector tile over Canberra (z12) | 142 KB raw, 91 KB zstd through Caddy |
| Font glyphs | 75 KB raw, 40 KB zstd through Caddy |
| Search "Braddon", fuzzy "Mount Ainslie", reverse geocode | ok (118 ms, 165 ms, 15 ms) |
| Fastest car route Braddon → Lanyon | 30.4 km, 28 min, 32 steps (33 ms) |
| Explore routes, +20 min budget | 3 routes: +10 min / 45.9 km new, +5 min / 35.0 km new, +0 min / 31.9 km new (262 ms) |
| Walking route | 2.1 km, 25 min |
| 60 min round-trip walk | 66, 58, 56 min loops (41 ms) |
| Discover | City Hill, Mahony Griffin Lookout, Mount Ainslie, Regatta Point, Anzac Parade (1.4 s) |

## `pnpm bench:explore 50000 20`

A synthetic heavy user with 50,000 visited cells around Sydney; only trips whose ends are on
the road network are sampled.

| Request | p50 | p95 | max | Target |
|---|---|---|---|---|
| Explore A→B, car, +15 min | 489 ms | 1,051 ms | 1,137 ms | p95 < 2 s ✅ |
| Round trip, foot, 60 min | 131 ms | 187 ms | 202 ms | p95 < 3 s ✅ |

## Live-graph integration tests

`GRAPHHOPPER_LIVE_URL=http://localhost:8989 pnpm test:integration`: 79 passed, including real
roads with turn instructions, walking slower than driving, explore routes adding new ground
within the budget, and round trips returning near the target time.

## Map over real tiles

Screenshots are in `apps/web/.impeccable/review/live-*.png` (light and dark). Route chips read
clearly over the base map. Routes and the fog now sit beneath place labels.

## Not yet checked

- The Android app on a real device (tracking through app kill and Doze, a real reroute).
- A full backup/restore drill.
