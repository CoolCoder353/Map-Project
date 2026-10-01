# API reference

The REST API served by `apps/api`. Request and response shapes are the Zod schemas in
[`packages/shared/src/schemas`](../packages/shared/src/schemas): they are the contract, used by the
API to validate and by both clients for types. This page lists what exists; the schema files say
exactly what each field is.

## Conventions

- **Base:** `https://<server>/api/…`. Tiles and the map style are outside `/api` (see *Map*).
- **Auth:** send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; get a new
  one from `POST /api/auth/refresh`.
  - **Web:** the refresh token is an httpOnly cookie, set by sign-in.
  - **Android:** send the header `x-client: mobile`; sign-in and refresh then return
    `refreshToken` in the body, and refresh takes it as `{ "refreshToken": "…" }`.
- **Roles:** `user`, `dev` (reads the admin API) and `admin` (also changes things).
- **Errors:** a status code and `{ "error": { "code", "message", "details"? } }`. A validation
  failure is `400 bad_request` with the failing fields in `details`.
- **Rate limits:** 600 requests a minute per IP, 10 a minute on the auth endpoints
  ([configuration.md](configuration.md#api-appsapisrcconfigts)).
- **Coordinates** are `[lon, lat]` arrays everywhere.

## Health and config (no auth)

| Method | Path | Schema / notes |
|---|---|---|
| GET | `/api/health` | `{ status, database, routing }` |
| GET | `/api/config` | `PublicConfigSchema`: app name, copy voice, feedback switch, OSM data date |

## Auth — `/api/auth`

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/register` | `{ inviteCode, email, password }` → `AuthResponse` |
| POST | `/login` | `{ email, password }` → `AuthResponse` |
| POST | `/refresh` | Rotates the refresh token (a reused one revokes its whole family) |
| POST | `/logout` | |
| POST | `/reset-password` | `{ token, password }` with a token from an admin-made reset link |

## Your account — `/api/me`

| Method | Path | Schema / notes |
|---|---|---|
| GET | `/` | `PublicUserSchema` |
| PATCH | `/settings` | `UpdateSettingsSchema` → `PublicUserSchema` (tracking, default mode, explore budget) |
| GET | `/export` | Everything stored about you, as a JSON download: account, trips with every point, `travelledRoads` (a GeoJSON FeatureCollection of the roads travelled, with OSM way id, length, first and last travelled, modes), the internal explore index (`visitedCells`), planned routes and stats |
| DELETE | `/` | Delete your account (purged after 7 days) |

## Places

| Method | Path | Schema / notes |
|---|---|---|
| GET | `/api/search` | `SearchQuerySchema` (`q`, optional `lon`/`lat` to rank by distance, `limit`) → `{ results: Place[] }` |
| GET | `/api/reverse` | `ReverseQuerySchema` → `{ place }` |
| GET | `/api/planned-routes` | Routes sent from the web to the phone → `PlannedRouteListSchema` |
| POST | `/api/planned-routes` | `PlannedRouteCreateSchema` |
| DELETE | `/api/planned-routes/:id` | |

## Routing

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/api/routes/fastest` | `FastestRouteRequestSchema` (`from`, `to`, `mode`, `via`, optional `heading`) → one `Route`. The app sends `heading` (compass degrees) with a new route asked for mid-drive, so it starts the way the car is going |
| POST | `/api/routes/explore` | `ExploreRouteRequestSchema` (`budgetMin` defaults to the person's setting) → `{ fastest, explore: Route[] }` |
| POST | `/api/routes/roundtrip` | `RoundTripRequestSchema` (`start`, `mode`, `targetMin`) → `{ routes }` |
| GET | `/api/discover` | `DiscoverQuerySchema` (`lon`, `lat`, `mode`, `maxMinutes`, `categories`) → `{ items }`. The slow one: several seconds on a small server |

`mode` is `car` or `foot`. Each `Route` carries its geometry, turn instructions, `novelty`
(new kilometres of road for this person) and `speedLimits`: `{ from, to, kmh }` runs of geometry
point indices, missing where no limit is mapped. Older servers leave `speedLimits` out. A roundabout
is always one instruction with the exit actually taken, even where a stop on a detour lies on it.

## Travel

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/api/tracks/batches` | `TrackBatchRequestSchema`: up to 5,000 points, `ts` in epoch ms. Re-sending a `batchId` returns `duplicate: true` |
| GET | `/api/trips` | `limit`, `cursor` → `TripListResponseSchema` (each trip has `newRoads`) |
| GET | `/api/trips/:id` | `TripDetailSchema`, with the recorded points |
| PATCH | `/api/trips/:id` | `{ mode }`, which re-runs coverage |
| DELETE | `/api/trips/:id` | Soft delete; an admin can restore it for 7 days |
| GET | `/api/coverage` | `CoverageQuerySchema`: `bbox`, `zoom`, `format` (`roads` or `geojson`) → travelled roads in view. A road travelled in separate stretches comes as one entry per stretch, with the same `wayId` |
| GET | `/api/coverage/stats` | `CoverageStatsSchema`: km of road, roads travelled, new this week/month, by mode, and `bounds` (`[w, s, e, n]` around nearly all of them, for framing the map; null with none, absent from older servers) |

## Feedback

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/api/feedback` | `FeedbackCreateSchema` → `201 { id }`. `404 feedback_disabled` while an admin has it switched off. 5 an hour per person; screenshot up to 2 MB |

## Map (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/map/style.json` | MapLibre style; `?theme=dark` for dark. URLs are absolute, from `PUBLIC_ORIGIN` |
| GET | `/tiles/tiles.json` | TileJSON |
| GET | `/tiles/:z/:x/:y.mvt` | Vector tiles from the PMTiles file (plain MVT; Caddy compresses) |
| GET | `/map/assets/…` | Fonts and sprites |

## Admin — `/api/admin`

`dev` and `admin` can read everything here; the rows marked **admin** need `admin`. Viewing
another person's data and every change is written to the audit log.

| Method | Path | |
|---|---|---|
| GET | `/health`, `/system`, `/metrics`, `/errors`, `/stats/usage` | Monitoring |
| GET | `/jobs` · POST `/jobs/:name/:id/retry` (**admin**) | Job queues |
| GET | `/pipeline/runs` · POST `/pipeline/refresh` (**admin**) | Map data refreshes |
| GET | `/users`, `/users/:id`, `/users/:id/trips`, `/users/:id/trips/:tripId`, `/users/:id/coverage`, `/users/:id/coverage/stats` | People and their data |
| PATCH | `/users/:id` (**admin**) | Role, disable |
| POST | `/users/:id/revoke-sessions`, `/users/:id/reset-password-link`, `/users/:id/restore`, `/users/:id/coverage/rebuild`, `/trips/:tripId/restore` (**admin**) | |
| DELETE | `/users/:id`, `/users/:id/trips/:tripId` (**admin**) | Soft deletes |
| GET | `/deleted` | Recently deleted, restorable for 7 days |
| GET | `/invites` · POST `/invites`, `/invites/:code/revoke` (**admin**) | |
| GET | `/app-settings` · PATCH `/app-settings` (**admin**) | App name, voice, feedback switch |
| GET | `/feedback`, `/feedback/summary`, `/feedback/:id`, `/feedback/:id/screenshot` · PATCH, DELETE `/feedback/:id` (**admin**) | Triage |
| GET | `/audit` | Audit log |

## Checking a server against the app

`pnpm verify:mobile` calls every endpoint the Android app uses, with the app's request shapes, and
validates the replies against these schemas. Run it after changing any of the above
([operations.md](operations.md#verifying-a-deployment)).
