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
   batch the server rejects as invalid is dropped, so it cannot block later ones. While a
   navigated trip runs, background recording leaves that time to it (it records its own fixes).
   The session (`src/lib/session.tsx`) keeps the device in line with the account's tracking
   setting, and checks again each time the app comes to the foreground, so tracking that was
   waiting on "Allow all the time" starts as soon as it is granted in the phone's settings.
2. `trackService.ingestBatch` stores `track_points` and queues `process-tracks`.
3. `processUserTracks` (`packages/core/src/services/tracks.ts`) splits points into trips (a
   10-minute gap or a 5-minute stop ends a trip; under 100 m is discarded) and records visited
   H3 cells. A batch that continues a trip extends it and clears its road match. Batches arrive
   a minute or so at a time, so a rest of a minute or more at the end of one is held back until
   the next shows whether it was a red light or the end of the trip; that way a stop spread over
   several uploads still ends the trip. Fixes the filter rejects (inaccurate, GPS jumps) are
   deleted at once, and background fixes from the time of a navigated trip are dropped in its
   favour (navigation groups are processed first).
4. `roadService.matchTrips` (`roads.ts`) sends each unmatched trip to GraphHopper `/match` with
   `osm_way_id` details and records the ways in `visited_ways` (every stretch travelled of each
   way, in `pieces`, with each metre counted once in `length_m`), the snapped line in
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
- **Round trip:** loops through unexplored areas around the start. Driving loops that need a
  U-turn aren't offered, so when the first six directions leave fewer than three loops, the other
  six are tried, then the 15° directions between them.
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

## Android Auto

The car app is a local Expo module, `apps/mobile/modules/wayfinder-car` (Kotlin; `android/` is
generated, so nothing native lives there). Android Auto binds `WayfinderCarAppService`; its screens
are Car App Library templates, and it draws its own map (MapLibre, the phone map's engine) onto
the car's surface through a virtual display, using the server's `/map/style.json`. A screen puts
a scene on the car map only while it is on top (`Screen.show` in `screens/ScreenKit.kt`), so a
late answer never repaints the map under the screen that took over.

The car screens hold no data of their own. They ask the JavaScript side through a small bridge
(`CarBridge` in Kotlin, `src/car/controller.ts` in JS): `status`, `search`, `discover`, `plan`,
`planned`, `routeLine`, `start`, `stop` and `mute`, and JS pushes every navigation change back
(`src/car/navModel.ts`). The car also sends its own position once a second (`location`, from the car's
GNSS via `CarLocation.kt`): the phone's navigation follows it only when the phone's own fixes have
been silent for 5 s (a locked phone with the app started from the car). Planning and Discover use the
phone's position from the last minute, else the car's, and only then wait for a new fix from the
phone, for at most 8 s (`PHONE_FIX_WAIT_MS`): a locked phone in a pocket may never give one. Each
request gives up after 45 s (`CarBridge`), longer than the phone's own 30 s wait for the server plus
that 8 s, so a weak signal shows as "No connection to the server" rather than as the phone not
answering (`carModule.test.ts` keeps the three in that order). The trip handed to the car's cluster carries the current step and the
one after it. The messages are defined in `src/car/protocol.ts` and `bridge/Protocol.kt`,
pinned by fixtures both test suites read. Another test (`carModule.test.ts`) checks that every
request `BridgeCarApi.kt` sends has a handler in `src/car/handlers.ts`.

Navigation is one session for the whole app (`src/nav/navigationService.ts`), followed by the
phone's Navigate screen and the car alike; a trip started on either shows on both. While it runs,
a location foreground service keeps directions coming with the phone locked; its starts and stops
run one at a time, and one left over from a trip the app never ended (swiped away mid-trip) is
stopped when the app starts. A request for a new route that hasn't answered within 20 s is given up
on as the next fix arrives (timers don't run with the phone locked) and asked again later. A new
route that starts by turning around (the car is in a dead end) is said once, "Route updated. Turn
around when you can", and not asked for again for a minute while the driver finds somewhere to
turn; asking sooner only gave the same answer every few seconds. Arriving is said once, and the trip
ends by itself 15 s later (on a timer, or the next fix with the phone locked); the phone's Navigate
screen then closes. The session also keeps the road driven and the speed, for the maps. A muted
voice stays muted from trip to trip and across restarts (kept in secure storage, as the contacts
switch is). The phone's Navigate screen shows the turn after the next and the speed against the
limit by the same rules as the car (`thenAfter` and `overLimit` in `src/car/navModel.ts`). Back on
the car's driving screen leaves the trip running, and Home offers "Back to directions". Spoken
directions use the module's own `NavVoice`, which plays as navigation guidance and asks other audio
to duck, so music dips and comes back; where the module isn't there, `expo-speech` speaks instead
(`src/nav/voice.ts`).

If Android Auto opens Wayfinder while the phone app is closed, Kotlin starts React, and the app
entry (`apps/mobile/index.ts`) starts the car controller without any screen.

Manoeuvre icons are Material Symbols (Apache 2.0, credited in the module's `NOTICE`); both kinds of
roundabout use the clockwise icon, `wf_roundabout_cw`. A release build only answers Google's own
Android Auto hosts (the `HostValidator` allowlist in `WayfinderCarAppService`); a debug build
answers any host.

**Navigate requests.** The car service also declares the `androidx.car.app.action.NAVIGATE` filter
(`geo:` scheme), and so does `NavigateActivity`, because Android Auto looks for it on an activity
(on the phone alone that activity just opens Wayfinder), so "navigate to ..." through Google Assistant, or a `geo:` link from another app,
opens the route preview for that place. `NavigateIntents` reads the URI (`geo:lat,lon`, or
`geo:0,0?q=name`; the lat/lon order is swapped to our `[lon, lat]` there, once) and
`NavigateRequests` handles it both when it opens the car app (`onCreateScreen`) and while it is open
(`onNewIntent`): ask the phone for the account (which starts React if needed), then show the preview
for a point, or search the name and preview the first match. Signed out or offline shows the same
sentences as Home, with "Try again".

**Navigation notification.** While a trip runs, `NavNotifications` keeps one ongoing, alert-once
notification (category navigation, extended with `CarAppExtender`) with the next instruction, which
the car shows in its notification area. It is a heads-up only when the instruction changes, updates
quietly with the distance, and is removed when the trip ends or the car session does. Tapping it
brings the car app forward on the directions: the car app is started with a `wayfinder:directions`
link, which the session answers by stepping back to Home and putting the driving screen on top, from
wherever the driver was. The phone's own "Navigating to ..." service notification is separate.

**Test drive.** The host's "auto drive" (`onAutoDriveEnabled`, switched on by Google's reviewers and
the Desktop Head Unit) sends the `simulate` request. `src/car/simulation.ts` then runs the same
navigation session with made-up fixes, one a second, along the trip already running if there is
one, otherwise a built-in two-kilometre route that starts where the phone is (central Brisbane
without a position), so it works with no route chosen and no server. It is marked `simulated` in
the navigation service, which then records nothing, uploads nothing, starts no location service and
ignores the phone's real position, so a test drive can never become a trip in someone's coverage.
It ends with the trip (Done, or the car session closing).

**The map while driving.** The car's position is a view fixed where the camera keeps the car
(`SceneLayout.followPoint`), not a dot on the map, so it stays still while the map glides under it
from fix to fix. Beside it, the speed limit as Australian signs show it (on the route only) and the
car's speed, red when over (`CarOverlays.kt`). The road driven so far is drawn too: the coordinator
keeps it (`TripTrail`), since after a reroute the route line starts where the car is. On car API
level 2 and up the map has pan, zoom and (once moved) re-centre buttons (`MapControls`,
`FollowCamera`); a drag stops it following until Re-centre. The map's styles are asked for when
the car connects (`MapStyles`), not only by Home: a trip already running puts the driving screen
straight over Home, which used to leave the map black. Roundabouts are drawn with the exit taken
(`RoundaboutIcon`, from the route's `exitAngleDeg`). Before the first fix the screen says "Finding
where you are…" rather than spinning; after 30 s without one, why.

**Using the screens.** Home's rows each carry a Material Symbols icon, tinted by the host for day
and night. A message pushed over another screen (an unreadable navigate request, a place not found)
has Back in its header, as a touch-only head unit has no other way off it. A list (Planned routes,
Discover) or a route preview that couldn't load says why with Try again, which asks again in place.
Search runs once typing pauses for half a second (or at once on submit), keeps the last results up
while the next load, and clears them when the box is emptied; an answer to older words is dropped.
Arriving shows the destination flag.

**What the car map marks.** Search results, Discover and Planned routes are numbered: each row's
image is a numbered badge (`numberIcon`), and the same badge marks it on the map (a planned route at
its middle, where routes that start together have parted), so "2" on the map is the second row.
`SceneLayout.drawing` decides the numbers, `MapPins` draws the badges and the destination pin, and
`MapFeatures` turns them into the GeoJSON the renderer's symbol layer shows; only that last step
needs MapLibre. A chosen route, on the preview and while driving, ends at a red destination pin and
has a white edge so it stands clear of the roads under it. Home marks where you are. On the driving
screen the speaker button shows whether directions are spoken (struck through when muted), and the
turn card is the route line's blue (`NavTemplates.TURN_CARD`, darker at night).

**Report.** The driving screen's Report sends a bug report from the phone with one tap
(`report` in `src/car/handlers.ts`): what the car showed, the speed limit and speed, the heading and
where, as a feedback report with the map position. Typing or speaking can't be done while driving;
the driver adds details later from the phone. It sends one a minute at most (the hour's five are
shared with the phone's own form) and says so when an admin has feedback switched off or the hour's
limit is used up.

**A new route that starts by turning round.** Only a route asked for with the car's heading says
"Turn around when you can"; the phone then waits a minute before asking again, until the driver is
50 m along the new route or back on it. A U-turn on a route asked for without a heading is just the
best way from there, so it isn't waited on. The road driven is kept to 1,500 points: past that it
is drawn more coarsely further back, rather than growing for the whole trip.

Templates are the ones every Android Auto version has (`minCarApiLevel` 1). Not yet: cars with
Android built in (Android Automotive).
