# Verification record

What has been checked, how to repeat it, and what is still open. Update this when the checks change.

## Automated

| Check | Command | Status |
|---|---|---|
| Lint | `pnpm lint` | clean |
| Types (7 packages) | `pnpm typecheck` | clean |
| Unit tests | `pnpm test:unit` | passing, 78 tests (geo/H3/novelty/segmentation, schemas, nav engine with simulated drives, OSM tag mapping, state/suburb boundaries, category words, opening hours across time zones, GraphHopper error wording, mobile queue and API client) |
| Android screen tests | `pnpm test:mobile` | passing, 15 tests (sign-in, settings tracking toggle and permission paths, feedback entry and form, route card) |
| Integration tests, PGlite | `pnpm test:integration` | passing, 96 (+4 against the live Australia graph): search ranking over 400 same-name stores, category words, feedback API and roles, pipeline location fill |
| Integration tests, real Postgres 17 | `TEST_DATABASE_URL=… pnpm test:integration` | passing (68 tests; run against `postgres:17-bookworm`) |
| Web end-to-end | `pnpm --filter @wayfinder/web e2e` | passing (8 specs) |
| Android JS bundle | `pnpm --filter @wayfinder/mobile exec expo export --platform android` | builds (Hermes bytecode) |
| Web production build | `pnpm --filter @wayfinder/web build` | builds; smoke-tested under `vite preview` |
| Design detector | `impeccable detect --json src` (in `apps/web`) | no findings |
| Docker images | `cd infra && docker compose build` | api, worker, web, graphhopper all build |
| Deployment smoke test | `pnpm verify:stack` | 15/15 on the Australia build; 4 new search checks added since (see *Live stack*) |
| Explore performance | `pnpm bench:explore 50000 20` | explore p95 1.05 s, round trip p95 0.19 s (targets 2 s / 3 s) |

### What the end-to-end specs cover

- Sign in; plan a trip; fastest route plus explore routes with extra-time and new-kilometre comparisons; select an explore route; send it to the phone; see it under planned routes.
- Coverage stats; trip replay; delete a trip.
- Round trips and Discover return results.
- Admin: create an invite → register with it → promote to `dev` → `dev` sees the dashboard but has no mutation controls and the API rejects mutations → admin deletes and restores a trip → every step appears in the audit log.
- Changing the app name and voice in the dashboard reaches the sign-in page and the browser title.
- A plain user cannot reach the dashboard.
- Settings → Back returns to the same planned trip.
- Admin switches feedback on → a user sends a bug report with the auto-captured screenshot and map view → admin sees it, sets Planned, adds a note → views and changes are in the audit log → switched off, the menu item is gone for new sessions.
- Search suggestions show type, suburb, state, postcode, distance and opening hours.

### Notable bugs these checks caught

- The map was created in a ref callback, so React StrictMode's remount left no map (web).
- MapLibre's worker path breaks under Vite (dev and production need different fixes); without the fix no route, marker or coverage layer renders.
- Passing `padding` to `easeTo` leaves it set on the map, which silently made every later `fitBounds` a no-op.
- 60 fps replay updates starved React Router's transitions: deleting a trip mid-replay changed the URL without re-rendering.
- A rejected refresh token rolled back its own family revocation (a stolen-token path).
- Coverage cells were sent to the map without their `recent` flag, so "first reached this week" never showed.
- The worker container could not write to the data volume (ownership), which failed the first OSM refresh.
- Vector tiles were labelled gzip after pmtiles had already decompressed them, so browsers could not decode any real tile (found by `verify:stack`).
- Routes and the coverage fog were drawn over place labels; in dark mode the fog made unexplored place names unreadable (found in live screenshots).
- On the real data, search listed shops twice (point + building), let "Erin Street" beat "Main Street", missed "St" for Street, and took 3–6 s (the planner scanned all 6.1M rows nearest-first). All fixed; 80–140 ms now.
- The explore benchmark could never finish (a 40 km disc cannot hold 50k res-9 cells), and 21 integration tests were also running in the unit project.

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
- **Screens beyond sign-in, settings and the route card** (plan, discover, coverage, navigation) render a native map, so they are covered by device testing rather than Jest.
- **Restore drill.** `infra/scripts/backup.sh` and `restore.sh` are written but a full restore has not been rehearsed on this machine.
