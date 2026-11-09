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
| POST | `/refresh` | Rotates the refresh token (a reused one revokes its whole family, unless it was rotated within the last 15 s and that sign-in is still live: two tabs renewing at once) |
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
| GET | `/api/search` | `SearchQuerySchema` (`q`, optional `lon`/`lat` to rank by distance, `limit`) → `{ results: Place[] }`. Coordinates (`-27.4698, 153.0251`, either order) give one `kind: "point"` place there; a four-digit postcode gives its suburbs and towns, nearest first; everyday names are understood ("maccas", "woolies"). Branches of a chain are ranked by distance, whatever each is named. Your own saved places whose name starts with `q` come first (`kind: "saved"`, id `saved:<id>`, `typeLabel` "Saved place"): at most half of `limit`, and not repeated as the place they were saved from (a found place within 30 m of one) |
| GET | `/api/saved-places` | Your saved places → `SavedPlaceListSchema`, by name |
| POST | `/api/saved-places` | `SavedPlaceSaveSchema` (`name`, `description`, `location`) → the `SavedPlace`. A name already used (any capitals) moves that place. Up to 50 (`409 conflict` beyond) |
| DELETE | `/api/saved-places/:id` | |
| GET | `/api/reverse` | `ReverseQuerySchema` → `{ place }` |
| GET | `/api/planned-routes` | Routes sent from the web to the phone → `PlannedRouteListSchema` |
| POST | `/api/planned-routes` | `PlannedRouteCreateSchema` |
| DELETE | `/api/planned-routes/:id` | |

## Routing

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/api/routes/fastest` | `FastestRouteRequestSchema` (`from`, `to`, `mode`, `via`, optional `heading` and `speedMps`) → one `Route`. The app sends `heading` (compass degrees) and `speedMps` with a new route asked for mid-drive, so it starts the way the car is going and doesn't begin with a turn too close to make at that speed (under about 6 s of driving). Where it can't (a dead end), the first instruction says "Turn around when you can" instead of GraphHopper's "Make a U-turn onto …". A roundabout instruction carries `exitAngleDeg`, how far round the exit is (90 left, 180 straight on, 270 right), where GraphHopper gives it (for a roundabout split by a stop, the angles of its two halves added) |
| POST | `/api/routes/explore` | `ExploreRouteRequestSchema` (`budgetMin` defaults to the person's setting) → `{ fastest, explore: Route[] }`. `fastest` is the quickest by the finished times (lights and learned speeds included): an explore route that comes out quicker takes its place |
| POST | `/api/routes/roundtrip` | `RoundTripRequestSchema` (`start`, `mode`, `targetMin`) → `{ routes }` |
| GET | `/api/roads/speed-limit` | `SpeedLimitQuerySchema` (`lon`, `lat`, optional `heading`) → `SpeedLimitResponseSchema` `{ kmh, estimated, road }`: the limit on the road where a car is, for the car's map with no trip. Worked out as a 400 m route ahead the way the car is going, finished as any route is (signs, school zones in force, electronic signs, main-road estimates), and read at its start. `kmh` null where no limit is known or the point is more than 40 m from a road; `estimated` when it's the road's legal default, not a sign |
| GET | `/api/discover` | `DiscoverQuerySchema` (`lon`, `lat`, `mode`, `maxMinutes`, `categories`) → `{ items }`. One place mapped twice ("Whites Hill", "Whites Hill Lookout") is listed once. Each item's `withinMinutes` is the smallest of three time bands (a third, two thirds and all of `maxMinutes`, rounded up to 5) it falls inside, from one isochrone per band. The slow one: several seconds on a small server |

`mode` is `car` or `foot`. Each `Route` carries its geometry, turn instructions, `novelty`
(new kilometres of road for this person) and `speedLimits`: `{ from, to, kmh }` runs of geometry
point indices, signposted limits only, with a school zone's lower limit while it is in force and no
limit on roads with electronic signs. Older servers leave `speedLimits` out. A roundabout
is always one instruction with the exit actually taken, even where a stop on a detour lies on it.

Newer servers add, each left out where empty:

- `estimatedSpeedLimits`: the same runs where no limit is mapped and GraphHopper estimated the legal
  default for the road. Kept apart so older apps never show a guess as a sign. On a main road
  (motorway, trunk, primary, secondary), which is always signposted, the estimate is the same road's
  signposted limit within 2 km either side along the route (same route number, else name), or no
  limit at all, never the built-up default of 50.
- `trafficSignals` (driving only): `{ index, kind }`, the sets of lights along the route at their
  nearest geometry point; `kind` is `signals`, `crossing` or `ramp_meter`. A turn at a set of lights
  has `atTrafficLights: true` and text starting "At the lights, …", which older apps say as it is.
  A set of lights drives have shown also has `id` (the OSM node an approach meets first) and
  `timing`: `{ stopChance, waitS, waits, cycle? }` for going this way through it at this time of
  day: how often drives stopped there (0–1), their median wait, and the 10th/25th/50th/75th/90th
  percentile waits. `cycle` (`{ cycleS, greenS, offsetS, utcOffsetS }`) is a fixed cycle where one
  was found: green from `offsetS` seconds past local midnight, every `cycleS`, for `greenS`;
  `utcOffsetS` turns the phone's clock into the lights' local time. Apps draw the lights red or
  green from these (`lightsAhead` in `packages/shared/src/light-timing.ts`), using the cycle only
  for lights under 45 s away.
- `usuallySlow`: trips on these roads at this time of day take noticeably longer than the map
  suggests. `durationS` and each instruction's `durationS` already allow for lights and for speeds
  learned from the group's drives.

## Travel

| Method | Path | Schema / notes |
|---|---|---|
| POST | `/api/tracks/batches` | `TrackBatchRequestSchema`: up to 5,000 points, `ts` in epoch ms. Re-sending a `batchId` returns `duplicate: true` |
| GET | `/api/trips` | `limit`, `cursor` (the last trip's `startedAt`; anything else is a 400) → `TripListResponseSchema` (each trip has `newRoads`, and `endedNear`, the name of the place nearest its last point, or null) |
| GET | `/api/trips/:id` | `TripDetailSchema`, with the recorded points; `matchedGeometry`, the trip snapped to the roads it took (absent where it couldn't be matched); and `newRoadLines`, the stretches of the roads this trip was the first to travel (roads whose first visit is the trip's start); and `endedNear` as in the list |
| PATCH | `/api/trips/:id` | `{ mode }`, which re-runs coverage |
| DELETE | `/api/trips/:id` | Soft delete; an admin can restore it for 7 days |
| GET | `/api/coverage` | `CoverageQuerySchema`: `bbox`, `zoom`, `format` (`roads` or `geojson`) → travelled roads in view. A road travelled in separate stretches comes as one entry per stretch, with the same `wayId`. Each has `firstAt` and `lastAt`, when it was first and last travelled |
| GET | `/api/coverage/stats` | `CoverageStatsSchema`: km of road, roads travelled, new this week/month, by mode, and `bounds` (`[w, s, e, n]` around nearly all of them, for framing the map; null with none, absent from older servers) |

## Feedback

| Method | Path | Schema / notes |
|---|---|---|
| GET | `/api/feedback/car-reports` | Your own reports from Android Auto's **Report** in the last 7 days, newest first: `{ reports: [{ id, createdAt, showing, detailsAdded }] }`, `showing` the direction the car showed (or null) |
| POST | `/api/feedback/:id/details` | `CarReportDetailsSchema` (`message`, optional `screenshot`) → `204`: adds what was wrong to one of your own reports from the car, within 7 days (anyone else's, or an older one, is `404`), under "Details from the driver"; a screenshot only if it has none. Three times per report, then `429`. `404 feedback_disabled` while feedback is off |
| POST | `/api/feedback` | `FeedbackCreateSchema` → `201 { id }`. `404 feedback_disabled` while an admin has it switched off. 5 an hour per person; screenshot up to 2 MB. Android Auto's **Report** sends one too (`screen` "Android Auto: driving"), its message saying what the car showed. `type: "speed_limit"` needs `speedLimit` (`SpeedLimitReportSchema`: `location`, `shownKmh` or null, optional `headingDeg`, `estimated`, `signedKmh`), and only that type takes one; the Android Navigate screen sends it when the limit sign is tapped |

## Map (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/map/style.json` | MapLibre style; `?theme=dark` for dark, `&driving=1` for the map under directions (no buildings, place dots or traffic-light markers). Bus stops are left off, and place dots only show from the zoom their names do. URLs are absolute, from `PUBLIC_ORIGIN` |
| GET | `/tiles/tiles.json` | TileJSON |
| GET | `/tiles/:z/:x/:y.mvt` | Vector tiles from the PMTiles file (plain MVT; Caddy compresses) |
| GET | `/tiles/signals/:z/:x/:y.mvt` | Traffic lights from the database as one MVT layer, `traffic_signals`, each point with its `kind`. Zoom 14 to 16; `204` below 14 or where a tile has none |
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
| PATCH | `/users/:id` (**admin**) | Role, disable, test account (its drives don't count towards learned speeds or light timings) |
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
