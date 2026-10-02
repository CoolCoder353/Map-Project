# Wayfinder — notes for agents

Explore-first maps for a small group: a web app, an Android app, and a Node server with
self-hosted routing, tiles and search. pnpm monorepo, TypeScript throughout. This is all in beta and as such you are not reading production data, or pushing to production, you should be able to complete those actions.

## Hard rules

- **Every feature is tested, and every change passes the whole suite.** New behaviour and bug
  fixes come with tests in the same change (a fix gets a test that fails without it), and
  `pnpm check` must pass before anything is called done. Never skip, delete or weaken a test,
  or lower a coverage floor, to get a change through. See [docs/testing.md](docs/testing.md).
- **No outside services for routing, tiles or search.** Everything runs on the one server; the
  only outside download is the OpenStreetMap extract. Ask before adding anything that calls out
  (live traffic was declined for this reason).
- **Coverage is roads travelled.** Hexagons (H3) are an internal index for explore only; never
  show or name them to users.
- **Coordinates are `[lon, lat]`.**
- **Migrations are append-only:** add `packages/core/src/db/migrations/00N_*.sql`, never edit one
  that has run.
- **An APK's server address is baked in at build time.** Build with the real address; the build
  script refuses example ones.

## Layout

`apps/api` (Fastify API, tiles, admin CLI) · `apps/worker` (jobs, OSM refresh pipeline) ·
`apps/web` (React web app + `/admin`) · `apps/mobile` (Expo Android app; `modules/wayfinder-car`
is the Android Auto car app) · `packages/core` (server services: `src/services/*.ts`, migrations
in `src/db/migrations`) · `packages/shared` (Zod schemas, geo, novelty scoring, copy) ·
`packages/nav` (turn-by-turn) · `infra` (compose,
Dockerfiles, Caddy, GraphHopper config, deploy/build scripts) · `scripts` (dev DB, seed, fake
routing engine, live checks).

## Where to look

| For                                                      | Read                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| How it fits together, main flows, jobs                   | [docs/architecture.md](docs/architecture.md)                                           |
| Running locally, recipes for common changes, gotchas     | [docs/development.md](docs/development.md)                                             |
| Where each kind of test goes, harnesses, what tests what | [docs/testing.md](docs/testing.md)                                                     |
| Endpoints                                                | [docs/api.md](docs/api.md) — schemas in `packages/shared/src/schemas` are the contract |
| Settings and env vars                                    | [docs/configuration.md](docs/configuration.md)                                         |
| Operating a server, troubleshooting                      | [docs/operations.md](docs/operations.md)                                               |
| Building, checking and sharing the Android APK           | [docs/build-android.md](docs/build-android.md)                                         |
| What falls short of Google's Android quality guidelines  | [docs/quality-gaps.md](docs/quality-gaps.md)                                           |
| The live server (`maps.paulsjones.com`, Queensland)      | [docs/deploy-small-server.md](docs/deploy-small-server.md)                             |
| What's verified and what's open                          | [docs/verification.md](docs/verification.md)                                           |
| Why things are the way they are                          | [docs/adr](docs/adr)                                                                   |
| Web look and feel                                        | [apps/web/PRODUCT.md](apps/web/PRODUCT.md), [apps/web/DESIGN.md](apps/web/DESIGN.md)   |

## Commands

```bash
pnpm check    # lint, types, every suite with coverage floors, Playwright: before calling anything done
```

While working: `pnpm test` (all Vitest: unit, integration on PGlite, web components),
`pnpm test:mobile` (Jest: Android screens and device code), `CI=true pnpm test:android` (Kotlin
tests for the Android Auto module, in Docker, and part of `pnpm check`; it takes over
`node_modules` while it runs), `pnpm test:e2e` (Playwright, starts
its own stack). Run one file with `npx vitest run <path>` or, in `apps/mobile`, `npx jest <path>`.
Tests go where [docs/testing.md](docs/testing.md#which-layer-a-test-belongs-in) says; web tests
use `renderApp()` from `apps/web/test/harness.tsx`, Android ones the fakes in
`apps/mobile/test/fakes.tsx`. The preview configs in `.claude/launch.json` start `db`, `fake-gh`,
`api` and `web`. A fresh dev database is empty — seed it once `db` is up, then sign in as
`admin@demo.test` / `demo password`:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm seed:demo
```

## Environment quirks

- **Non-interactive shells:** `CI=true pnpm install`, or pnpm stops to ask about `node_modules`.
- **The live server:** `ssh root@maps` (bare `ssh maps` is an interactive-only alias and fails).
  Compose there needs both files: `docker compose -f docker-compose.yml -f docker-compose.small.yml`,
  from `/opt/wayfinder/infra`.
- **Deploying to it** means building images here and streaming them over
  (`infra/scripts/deploy-small.sh images`), then updating the server checkout and running
  `up -d`. Follow docs/deploy-small-server.md exactly; then `verify:stack` and `verify:mobile`
  with `VERIFY_REGION=qld`.
- **The APK build** (`infra/scripts/build-apk.sh`, about 10 minutes) takes over `node_modules`
  while it runs; don't run pnpm until it finishes. It restores them at the end.

## Conventions

- Commit messages: a short subject, then prose explaining what was wrong and why the change fixes
  it.
- User-facing words: plain, specific, no jargon. Voice-dependent copy lives in
  `packages/shared/src/copy.ts` in three voices.
- Keep docs current with the change: api.md for endpoints, configuration.md for settings,
  architecture.md for flows and jobs, testing.md's feature map for new features, verification.md
  for checks.
- Push these changes to the main branch, do not create sub branches.
