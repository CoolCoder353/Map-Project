# Architecture

How the pieces fit together today. Why they are this way is in the ADRs:
[0001](adr/0001-h3-instead-of-postgis.md) (no PostGIS),
[0002](adr/0002-place-search.md) (place search),
[0003](adr/0003-coverage-by-roads.md) (coverage by roads). The original design spec
([specs/2026-09-17](superpowers/specs/2026-09-17-explore-maps-design.md)) is kept as history; where
it disagrees with this page, this page is right.

**The one rule:** everything runs on one server. Routing, tiles and search never call an outside
service. The only outside download is the OpenStreetMap extract, fetched by the monthly refresh.

## Components

```
 phone (Expo)      browser (React)
      │  HTTPS            │
      └──────┬────────────┘
           Caddy  ── static web build
             │  /api, /tiles, /map
            API (Fastify, :3000) ──── GraphHopper (:8989)
             │                              ▲
         PostgreSQL 17 ◄──── worker (pg-boss jobs) ─┘
             ▲                  │
             └── PMTiles file ◄─┘ (monthly map build)
```

| Component | Code | Role |
|---|---|---|
| Caddy | `infra/caddy/Caddyfile` | TLS (or plain HTTP behind a proxy), serves the web build, forwards `/api`, `/tiles`, `/map` to the API |
| API | `apps/api` | REST API, map style and vector tiles, admin CLI (`dist/cli.js`). Runs migrations on start |
| Worker | `apps/worker` | Background jobs and the OSM refresh pipeline |
| Core | `packages/core` | Services shared by API and worker: database, auth, routing, tracks, roads, places, admin, metrics |
| Shared | `packages/shared` | Zod schemas (the API contract), geo/H3 helpers, novelty scoring, trip segmentation, copy catalogue |
| Nav | `packages/nav` | Turn-by-turn engine, pure TypeScript, used by the Android app |
| GraphHopper | `infra/graphhopper` | Self-hosted routing: CH for fastest, LM plus per-request custom models for explore, `/match` for snapping trips to roads |
| PostgreSQL | `packages/core/src/db/migrations` | Everything else. Stock Postgres 17 with `pg_trgm`; no PostGIS |
| Web | `apps/web` | Planner, coverage, trips, settings, admin dashboard at `/admin` |
| Android | `apps/mobile` | The same planning features, turn-by-turn, background tracking, contacts search |

## Main flows

### Recording travel → coverage

1. The phone records fixes (`apps/mobile/src/tracking/background.ts`) into a SQLite queue and
   uploads them in batches to `POST /api/tracks/batches`. A batch id makes retries idempotent. A
   batch the server rejects as invalid is dropped, so it cannot block later ones.
2. `trackService.ingestBatch` stores `track_points` and queues `process-tracks`.
3. `processUserTracks` (`packages/core/src/services/tracks.ts`) splits points into trips (a
   10-minute gap ends a trip; under 100 m is discarded) and records visited H3 cells. A batch
   that continues a trip extends it and clears its road match.
4. `roadService.matchTrips` (`roads.ts`) sends each unmatched trip to GraphHopper `/match` with
   `osm_way_id` details and records the ways in `visited_ways`, the snapped line in
   `trips.matched_geometry`, and roads new to the person in `trips.new_roads`. Oldest trips go
   first, so a road counts as new for the trip that first travelled it. Trips that can't be
   matched (off-road) keep their raw line and count no road.
5. `GET /api/coverage` draws `visited_ways` in the map view; `GET /api/coverage/stats` counts
   kilometres of road.

Hexagons (`visited_cells`) are still recorded, but only as an internal index for steering explore
routes; nothing user-facing shows them.

### Planning routes

`routingService` (`packages/core/src/services/routing.ts`):

- **Fastest:** one GraphHopper request (CH).
- **Explore A→B:** builds the person's visited set, asks GraphHopper for alternatives that avoid
  visited areas (a custom model with `areas`) and routes via unexplored areas. Via points are
  snapped to through-roads so detours don't end in cul-de-sacs. A detour that still turns around
  at its via (a dead end, or a via on a road node, where GraphHopper's `pass_through` can't tell
  through from back) is asked for again, up to twice, with the via moved to the middle of the road
  it turned off (`viasAvoidingTurnarounds`). Candidates within the extra-time budget are scored by
  new kilometres of road (`packages/shared/src/novelty.ts`), with out-and-back retracing penalised.
  A driving detour or round trip that asks for any U-turn is never offered (they're illegal at
  lights and wherever signed); on foot, one is allowed.
- **Speed limits:** every route carries GraphHopper's `max_speed` as `speedLimits`, and Android
  turn-by-turn shows the limit of the road you're on. A short unknown stretch between two known
  roads (a junction) keeps the limit before it; longer unknown ones show none.
- **Round trip:** loops through unexplored areas around the start.
- **Discover:** an isochrone for the time budget, then places in areas the person hasn't reached.

### Place search

Built once per map refresh, then served from Postgres. The worker extracts places with osmium
(`apps/worker/src/pipeline/osm-places.ts`), works out each place's suburb, state and postcode
from OSM boundaries (`boundaries.ts`, `import-places.ts`), and swaps a staging table in.
`placeService.searchPlaces` ranks exact, prefix, fuzzy and category matches by text quality and
distance. Details in [ADR 0002](adr/0002-place-search.md).

### Map tiles

Planetiler builds one PMTiles file from the extract. The API serves tiles at
`/tiles/{z}/{x}/{y}.mvt` and the style at `/map/style.json`, with fonts from `infra/map-assets`.
URLs in the style are absolute, from `PUBLIC_ORIGIN`: the Android map cannot resolve relative
URLs.

### Map data refresh

`apps/worker/src/pipeline/refresh.ts`: download the extract → GraphHopper graph → tiles → places →
swap all three in. Live data is untouched until every step succeeds. Needs about 16 GB of RAM,
so a small server gets its data built elsewhere ([deploy-small-server.md](deploy-small-server.md)).

### Admin and monitoring

The API and worker record request, job and routing timings into `metrics_minute` (rolled up to
`metrics_daily`), errors into `error_events` (coordinates scrubbed), and every admin action into
the append-only `audit_log`. The dashboard reads these; there is no separate monitoring stack.

## Background jobs

pg-boss queues, handled in `apps/worker/src/jobs.ts`:

| Job | When | Does |
|---|---|---|
| `process-tracks` | after each upload | trips and visited cells, then road matching |
| `rebuild-coverage` | trip deleted, restored or re-moded; admin button | recompute cells, clear and re-match roads |
| `purge-deleted` | daily 03:17 | hard-delete users and trips deleted over 7 days ago |
| `system-sample` | every minute | CPU, memory, disk, queue depth, worker heartbeat |
| `metrics-maintenance` | hourly | roll up and prune metrics |
| `osm-refresh` | `OSM_REFRESH_CRON`, or the admin button | the map data refresh |

## Clients and the API contract

Both clients and the API share the Zod schemas in `packages/shared/src/schemas`, so types agree
at compile time. The Android app still ships separately from the server, so an older APK can
read fields a newer server no longer sends. `pnpm verify:mobile` checks a running server against
what the app asks for. The server address is baked into the APK at build time.

The Android app keeps its refresh token in secure storage and restores the session on launch. If
the server can't be reached then, it says so with a Try again button rather than asking someone
who is still signed in to sign in again. Cached server data (trips, coverage, planned routes) is
dropped whenever the signed-in account changes, so the next person on a phone never sees it.
