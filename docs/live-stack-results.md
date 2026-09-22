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

## Search (after the 2026-09-18 places re-import)

The places-only refresh took 6.7 min. It found 9 states and territories and 15,650 suburb/locality boundaries. 4,537 settlements mapped twice were removed.

| Kind | Rows | With suburb | With state | With postcode |
|---|---|---|---|---|
| Address | 5,088,934 | 100% | 100% | 95% |
| Street | 607,076 | 99.9% | 100% | 78% |
| Business / POI | 380,567 | 99.8% | 99.8% | 84% |
| Suburb / town | 24,623 | — | 99.8% | ~30% (mostly localities and hamlets with no addresses in OSM) |

Sample queries from Braddon (Canberra), straight against the live database:

| Query | Top result | Time |
|---|---|---|
| Woolworths | Woolworths · Supermarket · Dickson ACT 2602 · 2.3 km, then the next four nearest branches | 140 ms |
| petrol / servo | 7/11 Braddon · Petrol station · 0.6 km (from Queanbeyan: Ampol, 0.3 km) | 77–87 ms |
| Main Street (from Queanbeyan) | Main Street · Moruya NSW 2537 · 98.7 km; Queanbeyan's own Erin and Monaro Streets no longer come first | 104 ms |
| Bunnings | Bunnings Belconnen · Hardware store · 7.0 km · Open until 9 pm | 84 ms |
| Sydney | Sydney · City · NSW · 246 km, then Sydney Avenue, Barton | 79 ms |
| 12 Lonsdale St | Lonsdale Street · Braddon ACT 2612 (St read as Street) | 98 ms |

## After the first user reports (2026-09-23)

Places re-imported with the name-versus-address fix: **892,695 places**, of which POIs rose from
77,154 to **96,413** (+19,259 names recovered). Both `Gumdale State School` and `Belmont State
School` are searchable by name again, with their suburb and postcode.

Explore U-turns, from Brisbane with a 25-minute budget:

| Trip | Before | After |
|---|---|---|
| Redcliffe | 1 U-turn among 3 candidates | 0 across all 3 |
| Ipswich | 0 | 0 |
| Carindale | 1 and 2 | one candidate with 2 no longer offered |

Road coverage, end to end on the live server: a 40-point trip uploaded through the API was
segmented, map-matched and recorded as **37 roads / 2.6 km** within a minute. Asking for the same
route again then reported **0.86 km new (24.7%)** instead of 3.49 km — novelty measured by road.

## Map over real tiles

Screenshots are in `apps/web/.impeccable/review/live-*.png` (light and dark). Route chips read
clearly over the base map. Routes and the fog now sit beneath place labels.

## Not yet checked

- The Android app on a real device (tracking through app kill and Doze, a real reroute).
- A full backup/restore drill.
