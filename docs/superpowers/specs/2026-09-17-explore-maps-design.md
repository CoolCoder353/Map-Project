# Wayfinder (working name) — Design Spec: Explore-first maps for Australia

_Status: approved 2026-09-17. Next: per-phase implementation plans (starting with Phase 0)._

## Context

A Google Maps alternative for adventurous users. It records where each user has been and steers them toward **areas they have never visited**. It also always offers the **fastest route** for when there's no time for a detour. It is a new project: `/home/oscar/Documents/Maps` has no code yet. The files already there (`security-report.md`, `settings.txt`, `Notes.txt`) are unrelated. The security report contains personal data, so it must be moved out or git-ignored before `git init`.

### Decisions made with the user

| Topic | Decision |
|---|---|
| Map/road data | OpenStreetMap, **everything self-hosted on one server**. The only outside fetch is downloading the Australia OSM file from Geofabrik. No route, tile or search API calls |
| Routing | Self-hosted **GraphHopper** (Docker, called over localhost) |
| Coverage | **Australia** |
| Travel modes | **Driving**, **walking/hiking** |
| History capture | Background GPS (**user toggle**, off by default) + trips navigated in-app |
| Raw history storage | **Raw GPS tracks stored on the server** (encrypted disk, TLS, user can delete/export) |
| "New to you" | **Areas** on an **H3 hexagon grid**; coverage **shared across modes**, with mode recorded per visit |
| Explore features | Explore A→B route, Discover destinations, Round-trip adventures, Coverage ("fog of war") map + stats |
| Navigation | **Full turn-by-turn on Android**; web does planning only |
| Clients | **React Native (Expo) Android app** + **React web app**, TypeScript monorepo shared with the Node backend |
| Web scope | Route planning (fast + explore), coverage map + stats, trip history & replay, discover |
| Audience/hosting | **Personal/friends MVP**, single server |
| Auth | **Invite codes + email/password** |
| Android distribution | Direct APK / EAS internal builds (no Play Store yet) |
| Offline | **Online only** (GPS recording queues offline and syncs later) |
| Tiles & search | Self-hosted open source: Planetiler → PMTiles, PostGIS search (user had no preference) |
| Road rules | GraphHopper defaults: one-ways, access, turn restrictions (car), road-class speeds. No elevation in MVP |
| Dev/admin dashboard | `/admin` section of the web app, enforced by role on the server |
| Roles | `user` / `dev` (read-only: monitoring + inspection) / `admin` (everything, including mutations) |
| Dashboard features | Inspect any user's data, remove data, account management, promote/demote roles, generate/revoke **invite codes** |
| Admin safeguards | **Audit log** of every admin view/change; **type-to-confirm** destructive actions with **soft delete + 7-day undo** |
| Monitoring | Service health, performance & errors, jobs & data pipeline, usage stats. **Built-in metrics stored in Postgres**, with no Prometheus/Grafana |

---

## Architecture

```
                      ┌──────────────────── single server (Docker Compose) ───────────────────┐
 Android (Expo RN) ──▶│ Caddy (TLS, static web) ──▶ api (Node/Fastify) ──▶ PostgreSQL+PostGIS  │
 Web (React/Vite)  ──▶│                                  │    ▲                                 │
                      │                                  │    └── worker (Node, pg-boss jobs)   │
                      │                                  ├──▶ graphhopper (Java, localhost)     │
                      │                                  └──▶ australia.pmtiles (file, range)   │
                      │ data pipeline (cron): Geofabrik PBF → GraphHopper graph, Planetiler     │
                      │                        PMTiles, osm2pgsql POIs/places/addresses          │
                      └─────────────────────────────────────────────────────────────────────────┘
```

**Monorepo (pnpm workspaces)**
```
apps/api        Fastify + TypeScript REST API
apps/worker     Background jobs (track processing, coverage recompute, data imports)
apps/web        React + Vite + maplibre-gl (includes /admin dashboard, lazy-loaded, role-gated)
apps/mobile     Expo (dev client) + @maplibre/maplibre-react-native
packages/shared zod schemas + API types, H3 helpers, route-novelty scoring, API client
packages/nav    Pure-TS turn-by-turn engine (no RN deps → unit-testable)
infra/          docker-compose.yml, Caddyfile, graphhopper config.yml, map style/fonts/sprites,
                data-pipeline scripts
docs/           spec + ADRs
```

### Key technology choices
- **Backend:** Node LTS, Fastify, zod (shared request/response schemas), Kysely or Drizzle, SQL migrations, argon2id, JWT access token (15 min) + rotating hashed refresh tokens, pg-boss (a Postgres-backed job queue, so no Redis).
- **DB:** PostgreSQL + PostGIS + pg_trgm. H3 math runs in Node with `h3-js`, with cells stored as `bigint`.
- **Routing:** GraphHopper (pin the latest stable at Phase 0, currently v11). Profiles `car` (turn costs on) and `foot`. **CH** serves fastest routes. **LM** plus per-request `custom_model` serves explore routes.
- **Tiles:** Planetiler builds OpenMapTiles-schema vector tiles for Australia into one PMTiles file. Node serves `/tiles/{z}/{x}/{y}.pbf` from it using the `pmtiles` library, which works the same for web and React Native. Style JSON, glyph fonts and sprites are self-hosted, so the map makes no external requests.
- **Search:** osm2pgsql (flex output) imports places, POIs, streets and addresses into PostGIS. Search uses trigram + full-text matching, ranked by distance to the map centre. Reverse geocoding picks the nearest address or street. OSM address coverage in Australia is incomplete, which is a known limitation.
- **Mobile:** Expo with a custom dev client, which native modules require. Background tracking uses `expo-location` + `expo-task-manager` with an Android foreground service. The offline queue uses `expo-sqlite`, tokens live in `expo-secure-store`, voice prompts use `expo-speech`, and `expo-keep-awake` holds the screen on.
- **Web:** React + Vite + maplibre-gl + TanStack Query, with an httpOnly refresh cookie.

---

## Data model (PostgreSQL)

- `users` — id, email, password_hash, **role** (`user`|`dev`|`admin`), created_at, last_seen_at, **disabled_at**, **deleted_at** (soft delete), settings jsonb (tracking_enabled, default_mode, explore_budget_min)
- `invite_codes` — code, created_by, used_by, used_at, expires_at, revoked_at, note (e.g. "for Sam"), **role_on_signup** (default `user`)
- `refresh_tokens` — user_id, token_hash, expires_at, revoked_at
- `trips` — id, user_id, mode (`car`|`foot`), source (`background`|`navigation`), started_at, ended_at, distance_m, geom `LineString` (simplified, for display)
- `track_points` — trip_id, ts, geom `Point`, accuracy_m, speed, heading. Indexed on (trip_id, ts). Raw data kept for replay and reprocessing
- `track_batches` — client_batch_id (idempotency key), user_id, received_at
- `visited_cells` — (user_id, cell bigint **H3 res 9**) PK, first_visited_at, last_visited_at, visit_count, modes smallint bitmask. **Derived data** that can always be rebuilt from `track_points`
- `planned_routes` — id, user_id, name, request jsonb, response jsonb, created_at ("send to phone")
- `places` / `pois` — osm_id, name, category, geom, h3_r9, search tsvector (imported from OSM)
- `trips.deleted_at` — trips are soft-deleted too. Soft-deleted trips are excluded from coverage immediately, and restoring one triggers a recompute
- `audit_log` — id, actor_user_id, action (`user.view_trips`, `trip.delete`, `user.role_change`, `invite.create`…), target_type, target_id, details jsonb, ip, created_at. Append-only: the app's DB role has INSERT/SELECT only
- `metrics_minute` — bucket_start, metric (`http.request`, `route.explore`, `job.track_process`…), labels jsonb (route, status class), count, error_count, p50_ms, p95_ms, max_ms. Pruned after 30 days, with a daily rollup table kept for 1 year
- `error_events` — id, created_at, service (api/worker), route/job, message, stack, request_id, user_id (nullable). Pruned after 30 days
- `pipeline_runs` — id, kind (`osm_refresh`), started_at, finished_at, status, osm_data_date, log_tail
- `system_samples` — ts, cpu_pct, mem_used, disk_used, graphhopper_up, db_up, queue_depth (sampled every minute by the worker)

**H3 resolutions:** res 9 (~0.1 km², ~175 m edge) is the unit of "visited". Res 7 (~5 km²) is the unit of an "area" in suggestions and zoomed-out coverage. Zoomed-out views aggregate by parent cell, showing the fraction explored.

---

## Core algorithms

### 1. Track → visited cells (worker job)
1. The phone uploads point batches, each with a client UUID so re-sending is harmless.
2. Drop points with accuracy worse than 50 m, plus implausible speed jumps.
3. Split into trips: a gap over 10 min, or being stationary over 5 min, ends a trip. Mode comes from the navigation session if there was one; otherwise a speed heuristic applies (sustained > 25 km/h means `car`). The user can edit the mode.
4. Convert consecutive points to cells: `latLngToCell` for each point, with `gridPathCells` between neighbours so driving at speed leaves no gaps. Upsert into `visited_cells`.
5. **Deleting a trip or changing its mode** queues a job that rebuilds `visited_cells` for that user from the remaining points.

### 2. Fastest route
`POST /routes/fastest` → GraphHopper `/route` with profile `car`/`foot` and CH enabled. The response is normalised into a shared `Route` type: geometry, duration, distance, instructions. It also carries a `novelty` score (see 3e) so the UI can show "X km new" on the fastest route too.

### 3. Explore A→B (the core feature)
Inputs: from, to, mode, time budget (default +15 min for car, +10 min for foot; adjustable).
- a. Get the fastest route to establish baseline duration **T0**.
- b. Load the user's visited res-9 cells inside the reachable **ellipse** with foci A and B, where distance ≤ (T0 + budget) × typical speed.
- c. Build a visited-area polygon: `compactCells` (merge full sets of child cells into their parents) → `cellsToMultiPolygon` → simplify → cap the vertex count. The cap keeps GraphHopper requests fast.
- d. Generate candidates, all with a `custom_model` containing `areas: {visited}` and `priority: [{if: "in_visited", multiply_by: λ}]`, with CH disabled so LM is used:
  - Direct A→B routes at λ ∈ {0.5, 0.25}.
  - Via-point variants: A → centroid of the most-unexplored res-7 cell(s) in the ellipse → B, for 1–2 via points and up to ~4 variants.
- e. **Novelty score:** sample the route every ~50 m, convert samples to res-9 cells, and measure `newKm` (length inside unvisited cells) and `novelty% = newKm / totalKm`.
- f. Discard candidates slower than T0 + budget, and near-duplicates (>80% cell overlap). Rank by `newKm`, with a small penalty for extra time. Return the **top 3 explore routes plus the fastest**, labelled like "+9 min · 4.2 km new".

### 4. Round-trip adventure
Inputs: start, mode, target duration (e.g. 60 min walk).
- Radius r ≈ (target × speed) / 2π × 0.8.
- Make ~6 candidates by rotating 2–3 via points around the circle. Bias the angles toward directions with the most unvisited res-7 cells.
- Route start → v1 → v2 (→ v3) → start with the same visited-area custom model.
- Keep candidates within ±15% of the target duration. Score by novelty, penalise retracing the same edges, and return the top 3.

### 5. Discover destinations
Inputs: location, mode, max minutes, categories. The default categories are viewpoints, peaks, waterfalls, parks, beaches, attractions, lookouts, cafés, historic sites and trailheads.
- The reachable area comes from a GraphHopper `/isochrone` polygon (open-source GraphHopper has no matrix API).
- Candidate POIs lie in that polygon **and in unvisited res-9 cells**.
- Score = category weight × unexplored fraction of the surrounding res-7 area × distance decay. Return the top N, each with a "Go (fastest)" and "Go (explore)" action.

### 6. Turn-by-turn (packages/nav, Android)
- A state machine consumes GPS fixes and the normalised `Route`.
- It snaps each fix to the nearest route segment, tracks progress, finds the current and next instruction, and computes remaining time and distance.
- Voice prompts fire at distance thresholds: car 800 m / 200 m / now; foot 50 m / now.
- Off-route: > 40 m (car) or > 25 m (foot) for 3 consecutive fixes triggers a reroute. The reroute is a fastest route to the next remaining via point or the destination, so an explore route keeps its unexplored via points.
- While navigating: a foreground service, keep-awake, and trip recording with `source=navigation`.

---

## API surface (REST, zod-validated, types shared)

- **Auth:** `POST /auth/register` {inviteCode,email,password} · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout`
- **Me:** `GET /me` · `PATCH /me/settings` · `GET /me/export` (GeoJSON/GPX zip) · `DELETE /me`
- **Search:** `GET /search?q&lat&lon` · `GET /reverse?lat&lon`
- **Routing:** `POST /routes/fastest` · `POST /routes/explore` · `POST /routes/roundtrip` · `GET /discover`
- **Tracking:** `POST /tracks/batches` · `GET /trips` · `GET /trips/:id` · `PATCH /trips/:id` · `DELETE /trips/:id`
- **Coverage:** `GET /coverage?bbox&zoom` (res chosen by zoom) · `GET /coverage/stats`
- **Planned routes:** `POST|GET|DELETE /planned-routes`
- **Map assets:** `GET /tiles/{z}/{x}/{y}.pbf` · `/styles/*` · `/fonts/*` · `/sprites/*`
- **Admin** (`/admin/*`, every handler wrapped in `requireRole('dev'|'admin')` plus audit logging):
  - Monitoring (dev+): `GET /admin/health` · `GET /admin/metrics?metric&from&to` · `GET /admin/errors` · `GET /admin/jobs?state` · `GET /admin/pipeline/runs` · `GET /admin/stats/usage`
  - Inspection (dev+, **audited**): `GET /admin/users?q` · `GET /admin/users/:id` · `GET /admin/users/:id/trips` · `GET /admin/users/:id/trips/:tripId` · `GET /admin/users/:id/coverage` · `GET /admin/audit?actor&target`
  - Invite codes (dev can list; admin mutates): `GET /admin/invites` · `POST /admin/invites` {count, expiresInDays, note, roleOnSignup} · `POST /admin/invites/:code/revoke`
  - Accounts (admin): `PATCH /admin/users/:id` {role, disabled} · `POST /admin/users/:id/reset-password-link` · `POST /admin/users/:id/revoke-sessions` · `DELETE /admin/users/:id` (soft) · `POST /admin/users/:id/restore`
  - Data removal (admin): `DELETE /admin/users/:id/trips/:tripId` (soft) · `POST /admin/trips/:tripId/restore` · `POST /admin/users/:id/coverage/rebuild`
  - Ops (admin): `POST /admin/jobs/:id/retry` · `POST /admin/pipeline/refresh`
- **Admin CLI** (not HTTP): `bootstrap-admin` creates the first admin account or promotes one to admin, since no invite exists yet; also an emergency password-reset link, because there is no email service in the MVP

---

## Client features

**Web (React)**
- Map with search.
- Route planner with a mode toggle, showing the fastest route and explore routes side by side (time delta + new km), plus a budget slider.
- Round-trip generator.
- Discover list plus map pins.
- "Send to phone", which saves a planned route.
- Coverage map as a fog layer: an inverted mask over visited cells, plus a stats panel (km² explored, new cells this week/month, split by mode).
- Trip history list, replay with a timeline scrubber, edit mode, delete trip.
- Settings, data export, account deletion.

**Android (Expo RN)**
- Everything on the web except trip replay.
- Turn-by-turn navigation.
- Background tracking toggle, with clear permission explanations. Android 10+ asks for "Allow all the time" as a separate step, and Android 14 requires a location-type foreground service.
- Offline point queue with sync status.
- Planned routes received from the web.
- Battery-conscious settings: balanced accuracy and ~25 m distance interval when not navigating; high accuracy while navigating.

---

## Dev / admin dashboard (`/admin` in the web app)

### Access control
- The role lives in `users.role` and is carried in the access JWT. It is **re-checked against the DB on every `/admin` request**, so demoting someone or disabling their account takes effect immediately.
- The `/admin` routes are lazy-loaded and hidden for normal users, but the server is the real enforcement. Normal users get 404 on `/admin/*` rather than 403, so the API doesn't reveal the dashboard exists.
- Permission matrix:

| Capability | dev | admin |
|---|---|---|
| Monitoring: health, metrics, errors, jobs, pipeline, usage | view | view + retry jobs + trigger refresh |
| Users: list, profile, trips, replay, coverage | view (audited) | view (audited) |
| Invite codes | list | generate / revoke / set note, expiry, role_on_signup |
| Accounts | — | disable/enable, revoke sessions, reset-password link, soft delete/restore |
| Roles | — | promote/demote user ↔ dev ↔ admin |
| Data removal | — | soft delete/restore trips, rebuild coverage |
| Audit log | view | view |

- **Guardrails:**
  - The last remaining admin can't be demoted, disabled or deleted.
  - Admins can't delete or demote themselves from the dashboard.
  - Every role change and deletion requires **type-to-confirm** (the user's email, or `DELETE`).

### Soft delete & purge
- Deleting a user or trip sets `deleted_at`.
  - A deleted user can't log in, and their sessions are revoked.
  - A deleted trip disappears from coverage straight away.
- The dashboard's "Recently deleted" tab allows **Restore within 7 days**.
- A daily worker job **hard-deletes** anything past 7 days: points, trips, cells, planned routes, then the user row. Audit rows are kept but refer only to the target id.
- A user deleting their own account (`DELETE /me`) follows the same soft-delete path.

### Audit log
- One helper, `audit(actor, action, target, details)`, is called from every admin handler, including **read-only inspection** of another user's trips or coverage.
- It is written in the same transaction as the mutation.
- The dashboard's audit view filters by actor, target and action.

### Dashboard screens
1. **Overview:**
   - Health tiles for API, DB, GraphHopper, worker and data freshness (OSM data date).
   - CPU/RAM/disk sparklines.
   - Errors in the last 24 h, active users today, explore-route p95.
2. **Performance:**
   - Per-endpoint request rate, error rate and p50/p95 charts over selectable ranges.
   - Routing breakdown for fastest / explore / roundtrip / discover, including candidates tried and GraphHopper time.
3. **Errors:**
   - Recent error events, grouped by message, with stack trace and request id, filterable by service and endpoint.
4. **Jobs & pipeline:**
   - Queue depth per job type; failed jobs with error and **Retry** (admin).
   - Pipeline run history with log tail and **Trigger OSM refresh** (admin, type-to-confirm).
5. **Usage:**
   - Sign-ups, DAU/WAU, trips/day by mode, routes requested by type, tracking opt-in rate, total and weekly explored km².
6. **Users:**
   - Searchable table: email, role, created, last seen, trips, cells, tracking on/off, status.
   - The detail page shows the profile, sessions, trip list with **map replay** (reusing the web trip-replay component), and the user's **coverage map** (reusing the coverage layer). Each is audited.
   - Actions (admin): change role, disable, revoke sessions, reset-password link, delete trip, rebuild coverage, delete account.
7. **Invite codes:**
   - Generate N codes with expiry, note and role_on_signup. Copy codes or a link (`/register?code=…`).
   - Filter by unused / used (showing who and when) / expired / revoked, with Revoke.
8. **Audit log:** filterable table.
9. **Recently deleted:** users and trips pending purge, with Restore.

### Metrics collection (built-in, Postgres)
- A Fastify `onResponse` hook records duration and status per route template (e.g. `/trips/:id`, never raw ids or coordinates) into an in-memory aggregator.
- The aggregator flushes to `metrics_minute` every 60 s. Worker jobs and routing sub-steps use the same aggregator (`timer('route.explore.graphhopper')`).
- Percentiles use a small in-process histogram per bucket (fixed log-scale bins).
- An error handler writes `error_events` (with PII-free messages), and every response carries a request id.
- The worker samples `system_samples` each minute: `os` stats, `statfs` disk, DB ping, GraphHopper `/health`, pg-boss queue counts.
- Retention jobs prune minute data after 30 days and roll it up into daily aggregates.
- Usage stats are computed with SQL on demand and cached for 5 minutes.
- The dashboard draws charts with a lightweight chart library (e.g. uPlot or Recharts), polling every 30 s. No websockets.

---

## Server & data pipeline

- **Sizing estimate for Australia (verify in Phase 0):** 8 vCPU, **32 GB RAM**, 250 GB NVMe. The GraphHopper import for car+foot with CH+LM is the RAM peak; plan ~12–16 GB heap for the import.
- **`infra/pipeline/refresh.sh`** runs monthly via cron and can be run manually:
  1. Download `australia-latest.osm.pbf`.
  2. Build the GraphHopper graph into a new directory, then swap it in and restart.
  3. Rebuild Planetiler PMTiles and swap the file atomically.
  4. Run osm2pgsql into staging tables, then swap them in.
- **Ops:**
  - Caddy provides automatic TLS. Server disk encryption (LUKS) protects raw tracks at rest.
  - Nightly `pg_dump` with restic to a second location.
  - Docker healthchecks and a `/health` endpoint that checks the DB and GraphHopper.
  - Structured logs (pino). No precise coordinates in logs.

---

## Phased delivery

**Phase 0: Foundations and risk spikes**
- `git init` (move or ignore the unrelated files first), pnpm monorepo, TS/ESLint/Prettier, Vitest, CI (GitHub Actions if hosted there).
- `docker-compose` with Postgres/PostGIS, GraphHopper, api and Caddy.
- **Spike 1 (biggest risk):** GraphHopper `custom_model` with a large `areas` polygon under LM on the Australia graph. Benchmark with a synthetic heavy user (~50k visited cells). Target p95 < 2 s for explore A→B and < 3 s for round trips. If it misses, tune the polygon cap and compaction, or fall back to via-point-only candidates.
- **Spike 2:** Planetiler Australia PMTiles served by Node and rendered in both maplibre-gl and MapLibre React Native.
- **Spike 3:** Expo dev-client background location with the app killed or dozing on a real Android device.

**Phase 1: Backend core**
- Migrations and schema including roles and soft-delete columns, auth with invites, `bootstrap-admin` CLI.
- `requireRole` middleware + `audit()` helper.
- **Metrics/error instrumentation from day one** (aggregator, `metrics_minute`, `error_events`, request ids).
- osm2pgsql import plus search and reverse geocoding.
- `/routes/fastest`, tile, style and font serving.

**Phase 2: Web MVP + admin basics**
- Map, search, fastest route for car and foot, auth screens.
- `/admin` shell with role gating: **Invite codes**, **Users** (list, role change, disable, revoke sessions, reset link), **Audit log**, **Overview** health tiles. Friends can then be invited through the UI from this phase on.

**Phase 3: Tracking and history**
- Mobile app shell: auth, map, search, fastest route.
- Background tracking toggle, offline queue, batch upload.
- Worker trip segmentation and cell processing.
- Web trip list/replay/delete, coverage map and stats on both clients.
- Admin: user detail with audited trip replay and coverage, soft delete/restore of trips and users, "Recently deleted" tab, 7-day purge job, coverage rebuild.
- Admin: **Jobs** screen (queue depth, failed jobs, retry).

**Phase 4: Exploration engine**
- `/routes/explore`, `/routes/roundtrip`, `/discover`, with shared novelty scoring.
- Side-by-side fastest vs explore UI on both clients, planned routes / send to phone.

**Phase 5: Turn-by-turn (Android)**
- `packages/nav` engine, voice prompts, rerouting, navigation trip recording.

**Phase 6: Hardening and friends release**
- Export and delete-account (soft delete path), backups.
- Monthly data refresh cron with `pipeline_runs` tracking, rate limiting.
- Admin: **Performance**, **Errors**, **Usage** and **Pipeline** screens (history + trigger refresh); `system_samples`; metric rollups and retention.
- Signed APK / EAS internal distribution, onboarding and permission copy.

Implementation proceeds by producing a detailed task-level implementation plan per phase with the writing-plans skill.

---

## Verification

- **Unit (Vitest):**
  - H3 path densification and trip segmentation, tested against recorded GPS fixtures.
  - Novelty scoring and candidate filtering/ranking.
  - `packages/nav` replaying recorded drives and walks: correct instruction timing, off-route and reroute triggers.
  - Auth token rotation.
- **Integration:**
  - Testcontainers Postgres/PostGIS, plus a GraphHopper container loaded with a **small extract (Canberra/ACT, cut with `osmium extract`)** for fast CI.
  - Explore routes must be ≤ T0 + budget and have higher `newKm` than fastest for a seeded user.
  - Deleting a trip rebuilds `visited_cells`.
  - Re-uploading a batch is idempotent.
- **Performance:** a benchmark script against the full Australia graph with a synthetic 50k-cell user, checking the Phase 0 targets.
- **Web E2E (Playwright):** log in → search → plan fastest + explore → send to phone → view coverage → replay and delete a trip.
- **Android:**
  - Jest + React Native Testing Library for screens.
  - Manual device test: tracking toggle survives app kill and doze; a real walk shows up as new coverage on the web; turn-by-turn drive with a deliberate wrong turn triggers a reroute.
  - Optional Maestro flows.
- **Privacy checks:** tracking is off by default, and toggling it off stops the foreground service. Export contains all trips, and account deletion removes all rows after the purge window. No coordinates appear in logs or metrics labels.
- **Admin authorization (integration tests, table-driven over every `/admin` route):**
  - `user` gets 404, `dev` gets 200 on reads and 403 on mutations, `admin` gets 200.
  - A demoted admin loses access on the next request, even with an unexpired JWT.
  - The last admin can't be demoted or deleted, and admins can't self-delete.
- **Audit:** every admin inspection and mutation creates exactly one `audit_log` row with the correct actor and target. The app's DB role can't UPDATE or DELETE audit rows.
- **Soft delete:**
  - A deleted user can't log in, and a restore within 7 days fully recovers trips and coverage.
  - The purge job (with its clock faked forward) hard-deletes all user data.
  - Deleting a trip removes its unique cells from coverage.
- **Invites:** codes can't be reused, and expired or revoked codes are rejected. `role_on_signup` is applied, and only admins can create `dev`/`admin` invites.
- **Metrics:** a load script hitting endpoints produces matching `metrics_minute` counts and plausible p95s. A forced exception appears in the Errors screen, and a killed GraphHopper container shows as down on the Overview within 2 minutes.
- **Dashboard E2E (Playwright):** admin generates an invite → new user registers with it → admin promotes them to dev → dev can view but mutation buttons are absent (and the API rejects mutations) → admin soft-deletes a trip, restores it, and the audit log shows all steps.

## Open items to confirm later (not blocking)
- App name.
- Adding Australia's official G-NAF address dataset to improve address search.
- Elevation-aware hiking times.
- Privacy zones (hide home/work from recorded tracks).
- Moving to the Play Store, which needs a background-location policy declaration.
