# Verification record

What has been checked, how to repeat it, and what is still open. Update this when the checks change.

## Automated

| Check | Command | Status |
|---|---|---|
| Lint | `pnpm lint` | clean |
| Types (7 packages) | `pnpm typecheck` | clean |
| Unit tests | `pnpm test:unit` | passing (geo/H3/novelty/segmentation, schemas, nav engine with simulated drives, OSM tag mapping, mobile queue and API client) |
| Integration tests, PGlite | `pnpm test:integration` | passing |
| Integration tests, real Postgres 17 | `TEST_DATABASE_URL=… pnpm test:integration` | passing (68 tests; run against `postgres:17-bookworm`) |
| Web end-to-end | `pnpm --filter @wayfinder/web e2e` | passing (6 specs) |
| Android JS bundle | `pnpm --filter @wayfinder/mobile exec expo export --platform android` | builds (Hermes bytecode) |
| Web production build | `pnpm --filter @wayfinder/web build` | builds; smoke-tested under `vite preview` |
| Design detector | `impeccable detect --json src` (in `apps/web`) | no findings |
| Docker images | `cd infra && docker compose build` | api, worker, web, graphhopper all build |
| Deployment smoke test | `pnpm verify:stack` | see *Live stack* below |
| Explore performance | `pnpm bench:explore 50000 20` | see *Live stack* below |

### What the end-to-end specs cover

- Sign in; plan a trip; fastest route plus explore routes with extra-time and new-kilometre comparisons; select an explore route; send it to the phone; see it under planned routes.
- Coverage stats; trip replay; delete a trip.
- Round trips and Discover return results.
- Admin: create an invite → register with it → promote to `dev` → `dev` sees the dashboard but has no mutation controls and the API rejects mutations → admin deletes and restores a trip → every step appears in the audit log.
- Changing the app name and voice in the dashboard reaches the sign-in page and the browser title.
- A plain user cannot reach the dashboard.

### Notable bugs these checks caught

- The map was created in a ref callback, so React StrictMode's remount left no map (web).
- MapLibre's worker path breaks under Vite (dev and production need different fixes); without the fix no route, marker or coverage layer renders.
- Passing `padding` to `easeTo` leaves it set on the map, which silently made every later `fitBounds` a no-op.
- 60 fps replay updates starved React Router's transitions: deleting a trip mid-replay changed the URL without re-rendering.
- A rejected refresh token rolled back its own family revocation (a stolen-token path).
- Coverage cells were sent to the map without their `recent` flag, so "first reached this week" never showed.
- The worker container could not write to the data volume (ownership), which failed the first OSM refresh.

## Live stack (Docker, real data)

Bring it up with the local override so the API and routing engine are reachable from the host:

```bash
cd infra && docker compose -f docker-compose.yml -f docker-compose.expose.yml up -d
```

Then:

```bash
API_URL=http://localhost:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm verify:stack
GRAPHHOPPER_LIVE_URL=http://localhost:8989 pnpm test:integration   # adds real-graph routing tests
DATABASE_URL=postgres://wayfinder:…@localhost:5432/wayfinder GRAPHHOPPER_URL=http://localhost:8989 pnpm bench:explore 50000 20
```

Results are recorded in [live-stack-results.md](live-stack-results.md).

## Open / manual

- **Android on a device.** Install the APK (`infra/scripts/build-apk.sh`) and check: background tracking survives the app being killed and Doze; a real walk appears as new coverage on the web; turn-by-turn with a deliberate wrong turn triggers a reroute; the offline queue uploads when connectivity returns.
- **No Android screen tests.** The phone app's logic (queue, API client, navigation engine) is unit-tested and the bundle is built in CI, but there are no rendered-screen tests; device testing covers those.
- **Map contrast over real tiles.** The design review ran with the base map absent. Re-check the coverage fog and route callout contrast over real tiles (see live results).
- **Restore drill.** `infra/scripts/backup.sh` and `restore.sh` are written but a full restore has not been rehearsed on this machine.
