# Wayfinder

An explore-first maps app for a small group of friends. It remembers where you've travelled and
suggests routes, loops and places you've never been, always alongside the fastest route.
Everything (routing, map tiles, search) runs on one self-hosted server; the only outside download
is the OpenStreetMap extract.

- **Web app** (React + MapLibre): fastest vs explore routes, round trips, Discover, coverage of
  the roads you've travelled, trip history and replay, settings, and an admin dashboard at
  `/admin`.
- **Android app** (Expo + MapLibre): the same planning, plus turn-by-turn navigation, optional
  background tracking, and optional search of your contacts' addresses.
- **Server** (Node): Fastify API, a job worker, PostgreSQL, self-hosted GraphHopper, PMTiles
  vector tiles.

Live at **https://maps.paulsjones.com** (Queensland only, invite-only).

## Documentation

| If you want to… | Read |
|---|---|
| Understand how it fits together | [docs/architecture.md](docs/architecture.md) |
| Run it locally, make a change | [docs/development.md](docs/development.md) |
| Test a change, and find what tests what | [docs/testing.md](docs/testing.md) |
| Look up an endpoint | [docs/api.md](docs/api.md) |
| Look up a setting | [docs/configuration.md](docs/configuration.md) |
| Deploy on a full-size server, refresh map data, back up, troubleshoot | [docs/operations.md](docs/operations.md) |
| Deploy on a small server (the live one) | [docs/deploy-small-server.md](docs/deploy-small-server.md) |
| Install the Android app | [docs/install-android.md](docs/install-android.md) |
| See what's been verified, and what hasn't | [docs/verification.md](docs/verification.md), [docs/live-stack-results.md](docs/live-stack-results.md) |
| Know why a decision was made | [docs/adr](docs/adr) |
| Work on the web app's look and feel | [apps/web/PRODUCT.md](apps/web/PRODUCT.md), [apps/web/DESIGN.md](apps/web/DESIGN.md) |

Agents: start with [CLAUDE.md](CLAUDE.md).

## Quick start (local, no Docker)

Node 24+ and pnpm 11. Each command in its own terminal:

```bash
pnpm install
```

```bash
pnpm dev:db
```

```bash
pnpm dev:fake-gh
```

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm seed:demo
```

```bash
cd apps/api && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres JWT_SECRET=dev-secret-dev-secret-dev-secret-0000 TRUST_PROXY=true pnpm dev
```

```bash
pnpm dev:web
```

Open http://localhost:5173 and sign in as `admin@demo.test` / `demo password`. The fake routing
engine draws curves rather than roads, and the base map is blank until tiles are built. The
Docker stack with real data, and everything else, is in
[docs/development.md](docs/development.md).

## Checks

Every feature is tested, and every change must pass the whole suite:

```bash
pnpm check
```

That runs lint, types, the Vitest suites (unit, integration, web components) and the Android
tests, each with coverage floors, then the Playwright end-to-end suite. CI runs the same on every
push to `master` and every pull request. Details in [docs/testing.md](docs/testing.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | Fastify REST API, map style and tile serving, admin CLI |
| `apps/worker` | Background jobs: trip processing, road matching, purges, metrics, the OSM refresh pipeline |
| `apps/web` | Web app and admin dashboard (Vite + React) |
| `apps/mobile` | Android app (Expo) |
| `packages/shared` | Zod schemas (the API contract), geo/H3 helpers, novelty scoring, trip segmentation, copy |
| `packages/nav` | Turn-by-turn navigation engine (pure TypeScript) |
| `packages/core` | Server services shared by API and worker: database, auth, routing, tracks, roads, places, admin |
| `infra` | Docker Compose files, Dockerfiles, Caddy, GraphHopper config, deploy and build scripts |
| `scripts` | Dev database, demo seed, fake routing engine, benchmark, live checks |
| `docs` | Everything above |

## How exploring works

Trips are snapped to the road network, and coverage is the set of roads you've driven or walked.
An explore route asks GraphHopper for alternatives that avoid areas you know, routes via
unexplored ones, and ranks candidates within your extra-time budget by **kilometres of road
you've never travelled**, preferring loops to U-turns. Round trips and Discover use the same
history. Details in [docs/architecture.md](docs/architecture.md) and
[ADR 0003](docs/adr/0003-coverage-by-roads.md).

## Privacy

- Raw GPS tracks are stored on the server; encrypt the host's disk. People can delete trips,
  download everything (**Settings → Download my data**) and delete their account; deletions are
  purged after 7 days.
- Contacts searched on Android stay on the phone; only the address of a contact you pick is sent,
  to be located.
- Logs and metrics never include coordinates, tokens or emails. Every admin view of someone
  else's data, and every admin change, is in an append-only audit log.
