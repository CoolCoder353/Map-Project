# Testing

## The rule

**Every feature is tested, and every change passes the whole suite.**

- A new feature, endpoint, screen, job, setting or bug fix comes with tests in the same change.
  A bug fix gets a test that fails without the fix.
- A change isn't done until `pnpm check` passes: lint, types, every Vitest project with its
  coverage floors, the Android tests with theirs, and the Playwright suite. CI runs the same on
  every push to `master` and every pull request.
- A failing test is fixed, never skipped or deleted to get a change through. When a test is
  wrong, correct it, and say so in the commit.
- Coverage floors only go up. When tests are added, raise the floors in `vitest.config.ts` and
  `apps/mobile/jest.config.js` to just under the new figures. Never lower one to make a change
  pass.
- Tests must be deterministic. A test that sometimes fails is a bug in the test (usually a
  timing assumption); fix it the day it is seen.

Coverage is a floor, not the goal. What counts is that each thing a person can do has a test that
does it and checks the result. The [feature map](#what-tests-what) below lists where each one lives.
Add to it when you add a feature.

## Running the tests

```bash
pnpm check
```

The whole gate, about 5 minutes (Playwright and the Android Auto tests take most of it). The pieces:

| Command | What it runs |
|---|---|
| `pnpm lint && pnpm typecheck` | ESLint and TypeScript, every package |
| `pnpm test` | All Vitest projects: `unit`, `integration`, `web` |
| `pnpm test:unit` | Pure logic: `packages/*/test`, `apps/{api,worker}/test/unit`, `apps/mobile/test/*.test.ts` |
| `pnpm test:integration` | Services, API and worker against a real database (in-process PGlite, or Postgres with `TEST_DATABASE_URL`) |
| `pnpm test:web` | Web app components in jsdom: `apps/web/test` |
| `pnpm test:coverage` | All Vitest projects, failing below the coverage floors |
| `pnpm test:mobile` | Android screens and device code in Jest: `apps/mobile/test/*.{screen,native}.test.tsx` |
| `pnpm test:mobile:coverage` | The same, failing below the Android floors |
| `pnpm test:android` | The Android Auto module's Kotlin tests (Robolectric), in the Android build image; takes over node_modules while it runs |
| `pnpm test:e2e` | Playwright against a real stack it starts itself: `apps/web/e2e` |

Run the Kotlin tests as `CI=true pnpm test:android`: without `CI=true`, pnpm stops at a
node_modules prompt after the first run. Don't run Jest, Vitest or pnpm while it runs, because it
swaps node_modules and the other runs fail for no reason. `pnpm check` runs it last.

Run one file: `npx vitest run apps/web/test/directions.test.tsx`, or
`cd apps/mobile && npx jest test/plan.screen.test.tsx`. Filter by name with `-t "…"`.

Coverage reports land in `coverage/` (Vitest) and `apps/mobile/coverage/` (Jest). Open
`index.html` to see the uncovered lines.

On a fresh machine the Playwright suite needs a browser first:

```bash
pnpm --filter @wayfinder/web exec playwright install chromium
```

Options:

- `TEST_DATABASE_URL=postgres://…` runs integration tests on real Postgres (CI does). Each test
  file gets a throwaway database.
- `GRAPHHOPPER_LIVE_URL=http://localhost:8989` adds routing tests against a real graph (skipped
  otherwise).
- `CAPTURE=1` makes the Playwright run capture design-review screenshots instead.

## Which layer a test belongs in

| You changed | Test it in | With |
|---|---|---|
| Pure logic in `packages/shared` or `packages/nav` | `packages/<pkg>/test/*.test.ts` | Plain Vitest |
| A service in `packages/core` | `packages/core/test/integration/*.test.ts` | `createTestDb()`, `FakeQueue`, `makeUser()`, `straightPath()` from `packages/core/test/helpers` |
| An API route | `apps/api/test/integration/*.test.ts` | `createTestApp()` and `tokenFor()` from `apps/api/test/helpers/app.ts`; call with `app.inject` |
| API or worker config, CLI, job wiring | `apps/{api,worker}/test/unit` or `…/integration` | Pure functions split from the entry points (`cli-commands.ts`, `register.ts`, `stepsToSkip`) |
| A worker job or the OSM pipeline | `apps/worker/test/{unit,integration}` | Job handlers with a test database; pipeline steps with a fake `RunCommand` |
| A web screen or component | `apps/web/test/*.test.tsx` | `renderApp()` from `apps/web/test/harness.tsx` (see below) |
| The web map layer (`MapProvider`) | `apps/web/test/map-provider.test.tsx` | A fake MapLibre that records sources, layers and camera moves |
| A flow across pages, or anything the real map or browser does | `apps/web/e2e/*.spec.ts` | Playwright on PGlite, the demo seed and the fake routing engine |
| An Android screen | `apps/mobile/test/*.screen.test.tsx` | `apps/mobile/test/fakes.tsx` (see below) |
| Android Auto screens, bridge, map scenes | `apps/mobile/modules/wayfinder-car/android/src/test` | `FakeCarApi`, `Samples`, `TestKit` (`TestCarContext`) |
| The car ↔ app messages | `carProtocol.test.ts` + `ProtocolTest.kt`, over the fixtures in `modules/wayfinder-car/android/src/test/resources/fixtures` | — |
| Android device code (tracking, navigation, contacts, storage) | `apps/mobile/test/*.native.test.tsx` | Jest mocks of the Expo modules |
| Android logic with no React Native imports | `apps/mobile/test/*.test.ts` | Plain Vitest (the upload queue, the API client) |
| A migration | An integration test of the service that uses it | Every test database runs every migration |
| The Android app's use of the live API | `scripts/verify-mobile-contract.ts` | `pnpm verify:mobile` against a server |

### Web component tests

`renderApp(ui, options)` renders a screen the way the app does: query client, config, session,
toasts, planner state and a router, over a fake API and a fake map.

```tsx
const { api, map } = await renderApp(<TripsPanel />, {
  path: '/trips',
  user: user({ role: 'admin' }),          // null for signed out
  api: { 'GET /api/trips': () => ({ items: [trip()], nextCursor: null }) },
});
await userEvent.click(screen.getByRole('link', { name: /Drive/ }));
expect(where()).toBe('/trips/t-1');
expect(api.calls('GET /api/trips')[0]!.query.get('limit')).toBe('30');
```

- **Fake API** (`test/fakeApi.ts`): declare endpoints as `'METHOD /path'`, with `:param`
  segments allowed. Return a value for 200, `reply(status, body)`, `apiError(status, code,
  message)`, or a `Response`. A call to an endpoint the test didn't declare fails the test.
- **Fake map** (`test/fakeMap.ts`): every `MapApi` method is a `vi.fn()`. `map.click(p)`,
  `map.clickRoute(id)` and `map.hoverRoute(id)` simulate the user.
- **Fixtures** (`test/fixtures.ts`): `user()`, `route()`, `trip()`, `place()`, `adminUser()` and
  the rest. Each is parsed with the shared Zod schema, and one with a field the schema doesn't
  know throws. A fixture can't drift from the real API.

### Android screen tests

A test file points its module mocks at the shared fakes, then drives them:

```tsx
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
jest.mock('expo-router', () => require('./fakes').routerModule);

beforeEach(() => resetFakes());
afterEach(() => expect(fake.api.unhandled).toEqual([]));

fake.api.on({ 'GET api/trips': () => ({ items: [trip()], nextCursor: null }) });
await renderScreen(<Trips />);
```

`fake.map.props` holds what the screen last gave the map, and `fake.router` records navigation.
`jest.mock` factories can only reference variables named `mock…`, and imports load before the
file's other constants. Read a mock through a getter, or capture it after the imports, as
`tracking.native.test.tsx` does.

### Pitfalls that have bitten this suite

- **Query clients in tests use `gcTime: Infinity`** for queries and mutations. A finished
  mutation otherwise holds a 5-minute timer that keeps Jest from exiting.
- **Wait for effects, not just the element.** A list can render before the effects that update
  the map run. Assert map calls inside `waitFor`.
- **Async waits allow 5 seconds** (set in both test setups), so a busy CI machine doesn't fail
  tests.
- **React Native's `Response` isn't the web's.** Hand the mobile API client plain `{ ok, status,
  json }` objects.
- **Don't destructure a getter** (`const { handle } = await mount()` in the map-provider test)
  when you need its later value.

## What isn't automated

Checked by hand or against a live server, and recorded in [verification.md](verification.md):

- **The car map on a car surface.** `SceneLayoutTest` covers what is drawn and where the camera
  goes, and `StyleLoadsTest` that a style which failed to load is tried again; MapLibre drawing
  through the virtual display (and a surface handed over twice) is checked in the Desktop Head Unit
  ([verification.md](verification.md#android-auto-desktop-head-unit)).
- **The native Android map on a real device.** Jest covers the screens with the map faked, and
  `map-canvas.native.test.tsx` covers the component around it, but not MapLibre Native itself.
- **Routing on a real graph.** The fake engine draws curves. Set `GRAPHHOPPER_LIVE_URL` for the
  live tests, and `pnpm bench:explore` for explore's speed.
- **A deployed server.** `pnpm verify:stack` and `pnpm verify:mobile` after every deploy
  ([deploy-small-server.md](deploy-small-server.md)).
- **Infrastructure scripts** (`infra/scripts/*.sh`, Docker images, Caddy). Checked by using them;
  the APK build verifies its own output.

## What tests what

Each feature a person can use, and where its tests are. Paths are relative to the repo root.

| Feature | Unit / integration | Web components | Android | End to end |
|---|---|---|---|---|
| Sign in, register with an invite, reset a password, sign out | `packages/core/test/integration/auth.test.ts`, `apps/api/test/integration/auth-api.test.ts` | `auth-pages.test.tsx`, `app.test.tsx` (guards, deep links, sign-out) | `sign-in.screen.test.tsx`, `screens.screen.test.tsx` (Register, start-up), `device.native.test.tsx` (session) | `account.spec.ts`, `admin.spec.ts` |
| Fastest and explore routes, including no U-turns on driving detours and one exit number per roundabout | `routing.test.ts`, `novelty.test.ts`, `graphhopper.test.ts`, `app-api.test.ts`, `trips-places-api.test.ts` | `directions.test.tsx` | `plan.screen.test.tsx`, `route-card.screen.test.tsx` | `planner.spec.ts` |
| Round trips | `routing.test.ts`, `novelty.test.ts`, `app-api.test.ts` | `panels.test.tsx` | `plan.screen.test.tsx` | `planner.spec.ts` |
| Discover | `routing.test.ts`, `app-api.test.ts` | `panels.test.tsx` | `screens.screen.test.tsx` | `planner.spec.ts` |
| Place search (including postal addresses, "12 Smith St, Suburb QLD 4000") and reverse lookup | `search.test.ts`, `places-context.test.ts`, `hours.test.ts`, `osm-places.test.ts`, `boundaries.test.ts`, `trips-places-api.test.ts` | `search-field.test.tsx`, `map-shell.test.tsx` | `contacts.screen.test.tsx` | `feedback.spec.ts` (suggestions) |
| Contacts search (Android) | — | — | `contacts.screen.test.tsx`, `device.native.test.tsx`, `settings.screen.test.tsx` | — |
| Start from your location | — | `directions.test.tsx` | `plan.screen.test.tsx`, `device.native.test.tsx` | `planner.spec.ts` |
| Send a route to the phone; planned routes | `app-api.test.ts`, `trips-places-api.test.ts` | `directions.test.tsx`, `panels.test.tsx`, `settings.test.tsx` | `settings.screen.test.tsx` | `planner.spec.ts` |
| Turn-by-turn navigation (following you zoomed in; new routes start the way you're driving) | `packages/nav/test/*`, `graphhopper.test.ts`, `routing.test.ts` | — | `turn-by-turn.native.test.tsx`, `navigation-service.native.test.tsx`, `navigation-location.native.test.tsx`, `navigate.screen.test.tsx`, `map-canvas.native.test.tsx` | — |
| Android Auto: search, Discover, planned routes, route choice, directions, map | `carProtocol.test.ts`, `carNavModel.test.ts`, `carModule.test.ts`, `categories.test.ts` | — | `car-controller.native.test.tsx`, `car-handlers.native.test.tsx`, `navigation-service.native.test.tsx`, `navigation-location.native.test.tsx`, `voice.native.test.tsx`, `navigating-banner.screen.test.tsx`, Kotlin tests in `modules/wayfinder-car` | — |
| Speed limit while navigating | `geo.test.ts` (`speedLimitRuns`), `routing.test.ts`, `graphhopper.test.ts`, `packages/nav/test/engine.test.ts` | — | `navigate.screen.test.tsx` | — |
| Recording trips (background and navigation; stops across uploads; one trip per navigated drive) | `segmentation.test.ts`, `tracks.test.ts`, `queue.test.ts` (mobile), `apiClient.test.ts`, `androidManifest.test.ts` (the permissions background recording needs) | — | `tracking.native.test.tsx`, `navigation-service.native.test.tsx`, `settings.screen.test.tsx` | — |
| Coverage: roads travelled (every stretch), stats, framing the map, refreshing, the map layer | `tracks.test.ts` (road matching, new roads, stretches, bounds), `geo.test.ts` (`mergeStretches`), `app-api.test.ts`, `copy.test.ts` (no hexagon words) | `panels.test.tsx`, `map-provider.test.tsx`, `map-shell.test.tsx` | `screens.screen.test.tsx`, `map-canvas.native.test.tsx` | `planner.spec.ts` |
| Trips: list, replay (at a multiple of real time, with the speed then), correct mode, delete | `tracks.test.ts`, `trips-places-api.test.ts`, `segmentation.test.ts` (`speedAround`) | `trips.test.tsx`, `trip-detail.test.tsx` | `screens.screen.test.tsx` | `planner.spec.ts` |
| Settings, download my data, delete account | `account.test.ts`, `auth-api.test.ts` | `settings.test.tsx` | `settings.screen.test.tsx` | `account.spec.ts` |
| Feedback | `feedback-api.test.ts` | `account-feedback.test.tsx`, `admin-management.test.tsx` | `feedback.screen.test.tsx` | `feedback.spec.ts` |
| App name and voice | `copy.test.ts`, `admin-api.test.ts` | `auth-pages.test.tsx`, `admin-management.test.tsx` | `app-shell.native.test.tsx`, `screens.screen.test.tsx` | `admin.spec.ts` |
| Admin: users, roles, sessions, reset links | `admin.test.ts`, `admin-api.test.ts` | `admin-management.test.tsx` | — | `admin.spec.ts`, `account.spec.ts` |
| Admin: invites, audit log, recently deleted | `admin.test.ts`, `admin-api.test.ts`, `cli.test.ts` | `admin-management.test.tsx` | — | `admin.spec.ts`, `admin-pages.spec.ts` |
| Admin: health, performance, errors, jobs, usage | `metrics.test.ts`, `queue.test.ts` (core), `admin-api.test.ts`, `jobs.test.ts` | `admin-monitoring.test.tsx` | — | `admin-pages.spec.ts` |
| Map tiles and style | `tiles-api.test.ts`, `app-api.test.ts` | `map-provider.test.tsx` | `map-canvas.native.test.tsx` | `planner.spec.ts` |
| Background jobs and schedules | `jobs.test.ts`, `register.test.ts`, `queue.test.ts` (core) | — | — | — |
| OSM data refresh | `pipeline.test.ts`, `refresh.test.ts`, `jobs.test.ts` | `admin-monitoring.test.tsx` | — | — |
| Admin CLI | `cli.test.ts` | — | — | — |
| Configuration | `apps/{api,worker}/test/unit/config.test.ts` | — | — | — |
| The Android app's API contract | `schemas.test.ts` | — | — | `pnpm verify:mobile` (live) |
