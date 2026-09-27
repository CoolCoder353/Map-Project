# Verification record

What has been checked, how to repeat it, and what is still open. Update this when the checks change.

## Automated

| Check | Command | Status |
|---|---|---|
| Lint | `pnpm lint` | clean |
| Types (7 packages) | `pnpm typecheck` | clean |
| Whole gate | `pnpm check` | passing, 2026-09-27 |
| Unit tests | `pnpm test:unit` | passing, 124 tests: geo/H3/novelty/segmentation, schemas, copy in every voice, nav engine, OSM tag mapping, boundaries, opening hours, GraphHopper client, metrics, API and worker config, job registration, refresh steps, mobile upload queue and API client |
| Web component tests | `pnpm test:web` | passing, 164 tests: every planner panel, sign-in/register/reset, route guards, account menu, feedback, every admin page, the map layer against a fake MapLibre |
| Integration tests, PGlite | `pnpm test:integration` | passing, 125 (+4 skipped unless `GRAPHHOPPER_LIVE_URL` is set): services, every API area, the admin CLI, the job queue, data export, worker jobs and the refresh pipeline |
| Integration tests, real Postgres 17 | `TEST_DATABASE_URL=… pnpm test:coverage` | passing, 413 (+4 skipped) across all Vitest projects, against `postgres:17-bookworm`, 2026-09-27 |
| Vitest coverage | `pnpm test:coverage` | 96.6% lines, 94.2% statements, 92.4% functions, 86.0% branches; floors 95 / 92 / 90 / 84 |
| Android tests | `pnpm test:mobile` | passing, 81 tests: every screen (the native map faked), navigation, background tracking and the upload queue, contacts, session, the map component |
| Android coverage | `pnpm test:mobile:coverage` | 93.0% lines, 89.6% statements, 78.7% functions, 87.3% branches; floors 92 / 88 / 77 / 85 |
| Web end-to-end | `pnpm test:e2e` | passing, 15 specs |
| Flakiness | web and Android suites together, 8 rounds | 16/16 clean runs, 2026-09-27 |
| Android JS bundle | `pnpm --filter @wayfinder/mobile exec expo export --platform android` | builds (Hermes bytecode) |
| Web production build | `pnpm --filter @wayfinder/web build` | builds; smoke-tested under `vite preview` |
| Design detector | `impeccable detect --json src` (in `apps/web`) | no findings |
| Docker images | `cd infra && docker compose build` | api, worker, web, graphhopper all build |
| Deployment smoke test | `pnpm verify:stack` | 19/19 against `maps.paulsjones.com` (Queensland), 2026-09-23 |
| App against server | `pnpm verify:mobile` | 15/15 against `maps.paulsjones.com`, 2026-09-23: every endpoint the Android app calls, validated against the app's schemas |
| APK points at the right server | `infra/scripts/build-apk.sh` | checked on every build: the address is read back out of the finished APK |
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
- Coverage shows roads travelled, with kilometres of road in the stats.
- The start field fills itself with "Your location" when the browser already allows it, and stays empty when it doesn't.
- A wrong password is refused; a deep link (`/coverage`) survives signing in.
- Settings persist across a reload; Download my data returns the account and travelled roads; signing out ends the session.
- An admin's reset link sets a new password once; the old password stops working.
- Deleting your account signs you out and blocks sign-in; an admin restores it, and the next sign-in starts at Directions.
- Every dashboard page loads its data with no failed API call or script error, and the side menu reaches each one.

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
- Named places carrying a street address were imported as plain addresses, losing their names: 22% of named places in Queensland. Found by a user report, measured against the extract.
- Explore aimed detours at cul-de-sacs, so routes asked for U-turns; and it sent cars down tracks and service roads.
- An APK was built against the README's example address, `maps.example.com`, so nothing in it could reach the server. The build now refuses example addresses and checks the finished file.
- A trip that grew across uploads was only ever snapped to roads once, so everything after the first upload counted for nothing; and re-snapping it then reset its count of new roads.
- One GPS fix the server rejected jammed the phone's upload queue for good: the same batch was retried forever.
- Trips, admin pages and icons still counted hexagons after coverage moved to roads.
- CI only ran on pushes to `main`; the branch is `master`, so it never ran on a push.
- A loop whose turning point had no mapped street within 3 km was dropped, so round trips vanished in sparsely mapped areas (caught by the E2E suite).
- Signing in from a deep link always landed on Directions: the sign-in route's guard redirected before the page could (found by the web component tests).
- Fixing that exposed a leak: after someone signed out on a planned trip, the next person to sign in on that browser landed on it, places and all. Signing out now forgets the page.
- The Invites page's count box snapped back to 1 when cleared, so typing "2" gave "12".
- Download my data left out the roads travelled, the main coverage data, while including the internal hexagon index.
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
- **The native map itself.** Every Android screen is tested in Jest with the map faked, and the map component with MapLibre Native mocked; MapLibre Native on a device is covered only by device testing.
- **Restore drill.** `infra/scripts/backup.sh` and `restore.sh` are written but a full restore has not been rehearsed on this machine.
- **The live server has no backups yet.** Nothing is scheduled on `maps.paulsjones.com`; see [deploy-small-server.md](deploy-small-server.md#open-items).
- **"The app crashes when I start the map"** (a user report, 2026-09-22) is unconfirmed. The likely causes were closed in code, but it has not been reproduced on a device; a logcat from an affected phone would settle it:
  ```bash
  adb logcat -c && adb logcat | grep -iE "wayfinder|AndroidRuntime|maplibre"
  ```
