# Wayfinder

An explore-first maps app for a small group of friends. It remembers where you've travelled and suggests routes, loops and places in areas you've never been — while always showing the fastest route too. Everything (routing, map tiles, search) runs on one self-hosted server; the only outside download is the OpenStreetMap extract for Australia.

- **Web app** (React + MapLibre): plan fastest vs explore routes, round trips, discover places, coverage "fog of war", trip history and replay, settings, and an **admin dashboard** at `/admin`.
- **Android app** (Expo / React Native + MapLibre): the same planning features plus turn-by-turn navigation and optional background tracking.
- **Server** (Node): Fastify API, a job worker, PostgreSQL, self-hosted GraphHopper, PMTiles vector tiles.

The design spec is in [docs/superpowers/specs/2026-09-17-explore-maps-design.md](docs/superpowers/specs/2026-09-17-explore-maps-design.md); architectural decisions in [docs/adr](docs/adr).

## Repository layout

| Path              | What it is                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `apps/api`        | Fastify REST API, map style/tile serving, admin CLI                                         |
| `apps/worker`     | Background jobs: track processing, coverage rebuilds, purges, metrics, OSM refresh pipeline |
| `apps/web`        | Web app and admin dashboard (Vite + React)                                                  |
| `apps/mobile`     | Android app (Expo)                                                                          |
| `packages/shared` | Zod schemas, H3/geo helpers, novelty scoring, trip segmentation, copy catalogue             |
| `packages/nav`    | Turn-by-turn navigation engine (pure TypeScript)                                            |
| `packages/core`   | Server services shared by API and worker (database, auth, routing, admin, metrics)          |
| `infra`           | Docker Compose, Dockerfiles, Caddy, GraphHopper config, ops scripts                         |
| `scripts`         | Dev database, demo seed, fake routing engine, performance benchmark                         |

## How exploring works

Travel history is stored as GPS tracks and summarised as **H3 hexagons** (resolution 9, ~0.1 km²). For an explore route the API asks GraphHopper for the fastest route, then for alternatives that **penalise roads inside your visited hexagons** (a per-request custom model) and routes via the most unexplored nearby areas. Candidates that fit your extra-time budget are ranked by _kilometres you've never been_. Round trips and Discover use the same data. See [docs/adr/0001-h3-instead-of-postgis.md](docs/adr/0001-h3-instead-of-postgis.md).

## Quick Run

How to run it

The stack (database, routing engine, API, worker, website) is already up. To start or stop it later:

cd ~/Documents/Maps/infra && docker compose -f docker-compose.yml -f docker-compose.expose.yml up -d
cd ~/Documents/Maps/infra && docker compose down

1. Create your own admin account. The only admin I made is a test account whose password sits in my session's temp folder, so make your own. The command prompts for nothing; put your email and password in it:

cd ~/Documents/Maps/infra && docker compose exec api node dist/cli.js bootstrap-admin you@example.com 'your-password'

2. Open https://localhost. Your browser will warn about the certificate, because Caddy signs it locally for localhost. Accept it. Sign in, plan a trip (try Braddon to Lanyon Homestead in Canberra), look at Coverage, and open the admin dashboard from your avatar menu. Invite friends from the dashboard's Invite codes page.

3. Android. The APK is at dist/wayfinder.apk. Install it by copying it to the phone and opening it. The phone can't use https://localhost, so to try the app for real, set SITE_ADDRESS in infra/.env to a domain that points at this machine. Caddy then gets a proper certificate automatically.

How to test it
cd ~/Documents/Maps && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:mobile
cd ~/Documents/Maps && GRAPHHOPPER_LIVE_URL=http://localhost:8989 pnpm test:integration
cd ~/Documents/Maps && pnpm --filter @wayfinder/web e2e

Use pnpm verify:stack for a check of the running deployment; the exact command is in docs/verification.md.

## Local development

Requirements: Node 24+, pnpm 11. Docker is optional for day-to-day work.

```bash
pnpm install
```

### Without Docker (PGlite + fake routing engine)

Each in its own terminal (or use the Claude Code preview configs in `.claude/launch.json`):

```bash
pnpm dev:db
```

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm seed:demo
```

```bash
pnpm dev:fake-gh
```

```bash
cd apps/api && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres JWT_SECRET=dev-secret-dev-secret-dev-secret-0000 TRUST_PROXY=true pnpm dev
```

```bash
pnpm dev:web
```

Open http://localhost:5173 and sign in as `admin@demo.test` / `demo password` (demo data is clearly synthetic). The fake routing engine draws smooth curves instead of real roads, and the base map stays blank until tiles are built.

### With Docker (real Postgres and GraphHopper)

```bash
docker compose -f infra/docker-compose.dev.yml up -d db
```

GraphHopper needs a built graph under `./data/graphhopper/graph-current` (see _Map data_ below).

## Tests

```bash
pnpm test:unit
```

```bash
pnpm test:integration
```

Integration tests run against an in-process PGlite database by default. Set `TEST_DATABASE_URL` to a real Postgres (a throwaway database is created per test file) — CI does this.

```bash
pnpm --filter @wayfinder/web e2e
```

Playwright boots an isolated stack (PGlite, demo seed, fake routing engine, API, Vite) and runs the planner and admin flows. `CAPTURE=1` captures design-review screenshots instead.

```bash
pnpm lint && pnpm typecheck
```

Android JS bundle check (no SDK needed):

```bash
pnpm --filter @wayfinder/mobile exec expo export --platform android --output-dir dist-check
```

## Deploying (one server)

Sizing for Australia: 8 vCPU, 32 GB RAM, 250 GB SSD.

1. Copy `infra/.env.example` to `infra/.env` and fill it in (domain, passwords, a random `JWT_SECRET`).
2. Run the bootstrap (downloads map fonts, builds images, starts everything):
   ```bash
   infra/scripts/bootstrap.sh
   ```
3. Create the first admin:
   ```bash
   cd infra && docker compose exec api node dist/cli.js bootstrap-admin you@example.com
   ```
4. Sign in, open **Admin → Jobs & data → Refresh map data**. The first build downloads the Australia extract (~1 GB) and builds the routing graph, tiles and search index (1–2 hours). It then refreshes monthly.
5. Create invite codes in **Admin → Invite codes** and send the sign-up links to friends.

Caddy obtains TLS certificates automatically. Day-to-day running, refreshes, backups and troubleshooting are in [docs/operations.md](docs/operations.md). Nightly backups:

```bash
RESTIC_REPOSITORY=/mnt/backup/wayfinder RESTIC_PASSWORD_FILE=/root/restic-pass infra/scripts/backup.sh
```

Restore with `infra/scripts/restore.sh [snapshot]`.

### Admin CLI

Run inside the `api` container: `node dist/cli.js migrate | bootstrap-admin <email> [password] | create-invite [count] [role] | reset-link <email>`.

## Android app

Build a sideloadable APK inside Docker (no local Android SDK):

```bash
EXPO_PUBLIC_API_URL=https://maps.example.com infra/scripts/build-apk.sh
```

The APK lands in `dist/wayfinder.apk`. For a signed build, place a keystore at `infra/android/release.keystore` and set `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Friends can change the server address on the sign-in screen.

Background tracking is **off by default**. When a user turns it on, Android asks for location "while using" and then "Allow all the time"; a notification shows while recording. Points are queued on the phone (SQLite) and uploaded in batches, so recording works offline.

## Admin dashboard

`/admin` in the web app, for `dev` (read-only) and `admin` roles:

- **Monitoring:** service health, request/error/latency charts, error groups with stack traces, job queues with retry, map data refresh history, usage stats. Metrics are collected by the API and worker into Postgres (no extra monitoring stack).
- **Management:** users (roles, disable, sign out everywhere, reset links, delete/restore), each user's trips and coverage, invite codes, the audit log, recently deleted items (7-day undo), and **app settings** — the app's name and copy voice (plain, playful or minimal) for everyone on web and Android.

Every admin view of another user's data and every change is written to an append-only audit log.

## Performance check

After the Australia graph is built, verify explore routing for a heavy user (50,000 visited hexagons):

```bash
DATABASE_URL=... GRAPHHOPPER_URL=http://localhost:8989 pnpm bench:explore 50000 20
```

Targets: explore p95 < 2 s, round trip p95 < 3 s.

## Privacy

- Raw GPS tracks are stored on the server (use disk encryption on the host). Users can delete trips, download everything (`Settings → Download my data`) and delete their account; deletions are purged after 7 days.
- Logs and metrics never include coordinates, tokens or emails.
