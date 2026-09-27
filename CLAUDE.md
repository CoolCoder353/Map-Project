# Wayfinder — notes for agents

Explore-first maps for a small group: a web app, an Android app, and a Node server with
self-hosted routing, tiles and search. pnpm monorepo, TypeScript throughout.

## Hard rules

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
`apps/web` (React web app + `/admin`) · `apps/mobile` (Expo Android app) · `packages/core`
(server services: `src/services/*.ts`, migrations in `src/db/migrations`) · `packages/shared`
(Zod schemas, geo, novelty scoring, copy) · `packages/nav` (turn-by-turn) · `infra` (compose,
Dockerfiles, Caddy, GraphHopper config, deploy/build scripts) · `scripts` (dev DB, seed, fake
routing engine, live checks).

## Where to look

| For | Read |
|---|---|
| How it fits together, main flows, jobs | [docs/architecture.md](docs/architecture.md) |
| Running locally, tests, recipes for common changes, gotchas | [docs/development.md](docs/development.md) |
| Endpoints | [docs/api.md](docs/api.md) — schemas in `packages/shared/src/schemas` are the contract |
| Settings and env vars | [docs/configuration.md](docs/configuration.md) |
| Operating a server, troubleshooting | [docs/operations.md](docs/operations.md) |
| The live server (`maps.paulsjones.com`, Queensland) | [docs/deploy-small-server.md](docs/deploy-small-server.md) |
| What's verified and what's open | [docs/verification.md](docs/verification.md) |
| Why things are the way they are | [docs/adr](docs/adr) |
| Web look and feel | [apps/web/PRODUCT.md](apps/web/PRODUCT.md), [apps/web/DESIGN.md](apps/web/DESIGN.md) |

## Commands

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:mobile   # before calling anything done
pnpm --filter @wayfinder/web e2e                               # anything the web app shows
```

`pnpm test` is Vitest (unit + integration, PGlite). `pnpm test:mobile` is Jest for the Android
screens (`*.screen.test.tsx`). Details and the dev servers are in docs/development.md; the preview
configs in `.claude/launch.json` start `db`, `fake-gh`, `api` and `web`. A fresh dev database is
empty — seed it once `db` is up, then sign in as `admin@demo.test` / `demo password`:

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
- **Commits are not pushed to GitHub** unless the user says so; the server has been updated from
  git bundles. Ask before pushing, force-pushing or rewriting history.
- Shared production data: the live server has real users. Clean up any test accounts, trips or
  feedback you create there.

## Conventions

- Commit messages: a short subject, then prose explaining what was wrong and why the change fixes
  it.
- User-facing words: plain, specific, no jargon. Voice-dependent copy lives in
  `packages/shared/src/copy.ts` in three voices.
- Keep docs current with the change: api.md for endpoints, configuration.md for settings,
  architecture.md for flows and jobs, verification.md for checks.
