# Android Auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wayfinder runs on an Android Auto car screen: search, planned routes, Discover and the fastest-vs-explore choice from the car, then turn-by-turn directions with the map, spoken prompts that duck music, and navigation that keeps going with the phone locked.

**Architecture:** Navigation moves out of the phone's Navigate screen into one app-level JavaScript service that both screens follow. A local Expo module (`apps/mobile/modules/wayfinder-car`) adds the Kotlin car app: a `CarAppService` whose screens are native Car App Library templates. The screens get all their data from the JavaScript side over a small request/response bridge. JavaScript already owns the account, the server, routing and the navigation engine, so none of that is ported to Kotlin. The car's map is MapLibre Native drawn onto the car's surface through a virtual display, using the server's own style.

**Tech Stack:** Expo SDK 57 / React Native 0.86 (new architecture), Expo Modules API (Kotlin), `androidx.car.app` 1.7, MapLibre Native Android 13.2 (the version maplibre-react-native already ships), Jest + React Native Testing Library, Vitest, JUnit 4 + Robolectric + `androidx.car.app:app-testing`.

**Spec:** No separate spec. The design decisions are below, and they follow the size estimate given in the session that produced this plan (scope B: the full car app).

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Where navigation logic runs | JavaScript (`packages/nav` engine, unchanged), pushed to Kotlin as a view model | One engine, already tested; no Kotlin port to keep in step |
| Who owns car screens | Kotlin (templates, screen stack); JavaScript answers data requests | Templates are Kotlin-only; keeps the bridge small (8 requests + 1 push) |
| Bridge format | JSON strings, Zod schemas in TS, hand parsers in Kotlin, shared fixture files both sides test | Two languages, one contract that a test breaks if either side drifts |
| App closed when the car opens Wayfinder | Kotlin starts the React host; a custom entry (`apps/mobile/index.ts`) starts the car controller without any screen | The car must work with the phone in a pocket |
| Navigation with the phone locked | expo-location foreground location service (`foregroundService` option) during navigation | Works with only "while using" permission (checked in expo-location's `LocationModule.kt`: a user-started foreground service doesn't need background permission) |
| Car map | MapLibre `MapView` in a `Presentation` on a `VirtualDisplay` backed by the car's `Surface` | The standard way to draw a normal Android view on a car surface; reuses the phone's map engine and the server's style |
| Templates | `PlaceListNavigationTemplate`, `SearchTemplate`, `RoutePreviewNavigationTemplate`, `NavigationTemplate`, `MessageTemplate`; `minCarApiLevel` 1 | Work on every Android Auto version. They're deprecated in 1.7 in favour of `MapWithContentTemplate` (car API 7); migrating is a follow-up, not needed to ship |
| Spoken prompts | Native `TextToSpeech` with `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` and transient-duck audio focus | Music dips under directions in the car (and on the phone) |
| Distribution | Sideloaded APK as today; each driver turns on Android Auto's **Unknown sources** once | No new outside service. A Play internal testing track is the alternative (see Open decisions) |

**Out of scope (follow-ups):** panning and zooming the car map, a speed-limit sign on the car map, Android Automotive OS (cars with Android built in), migrating to `MapWithContentTemplate`, starting round trips from the car, voice search.

## Open decisions (confirm before Task 3)

1. **Distribution.** The plan assumes sideloading plus Android Auto developer mode (Task 15 documents it). If you'd rather use a Play Console internal testing track ($25 one-off, needs a Google account, builds must be AABs), add a task to build an AAB and drop the "Unknown sources" instructions.
2. **`pnpm check` needs Docker.** The Kotlin tests need the Android SDK, which on this machine only exists in the `wayfinder-android-build` image. Task 3 adds `pnpm test:android` (Docker, ~5 min warm, longer the first time) to `pnpm check`, and a matching CI job. If that's too slow for every check, the alternative is to run it only in CI and before APK builds. That would bend the "every suite in `pnpm check`" rule, so it's your call.

## Global Constraints

- Coordinates are `[lon, lat]` everywhere, including the bridge; convert to MapLibre `LatLng(lat, lon)` only at the MapLibre call.
- No outside services for routing, tiles or search: the car map loads `${server}/map/style.json?theme=light|dark` from the user's own server; no Google Maps, Places or Directions.
- Never show or name hexagons. Unexplored wording matches the phone ("62% unexplored area").
- User-facing words are plain. Voice-dependent copy comes from `@wayfinder/shared/copy` (`copyFor(config.voice)`). Use `’` in copy as the rest of the app does.
- The car always plans and navigates in mode `car`.
- `androidx.car.app:app` and `androidx.car.app:app-testing` share one version: `1.7.0`. At Task 3, check Google's Maven for a newer stable 1.7.x and use that for both if there is one.
- MapLibre Native in the module must equal `org.maplibre.reactnative.nativeVersion` in `@maplibre/maplibre-react-native/android/gradle.properties` (currently `13.2.0`, variant `opengl`). Task 3 adds a test that enforces this.
- `minSdkVersion` stays 26; `minCarApiLevel` is 1.
- `apps/mobile/android/` is generated (`expo prebuild --clean`) and ignored by git: every native change lives in `apps/mobile/modules/wayfinder-car/`.
- Every task ends with its tests passing and `pnpm check` passing (from Task 3 on that includes `pnpm test:android`). Never skip, delete or weaken a test; coverage floors only go up. When a task adds tests, raise the floors in `apps/mobile/jest.config.js` / `vitest.config.ts` to just under the new figures.
- Commit to `master` after each task (no branches). Subject line, blank line, prose saying what was wrong or missing and why this fixes it.
- Existing tests in `apps/mobile/test/turn-by-turn.native.test.tsx` and `navigate.screen.test.tsx` must keep passing. Tasks 2 and 5 only *add* `jest.mock` lines to them.

## File map

```
apps/mobile/
  index.ts                                  NEW  app entry: starts the car controller, then expo-router
  package.json                              MOD  "main": "index.ts", version 0.3.0
  app.config.ts                             MOD  version 0.3.0, versionCode 3
  tsconfig.json                             MOD  include "modules", "index.ts"
  jest.config.js                            MOD  coverage paths, floors
  app/navigate.tsx                          MOD  ?resume=1 follows navigation started elsewhere
  app/(tabs)/_layout.tsx                    MOD  "Back to directions" banner
  app/(tabs)/discover.tsx                   MOD  category labels from src/lib/categories.ts
  src/lib/categories.ts                     NEW  Discover category names (fixes "Beache")
  src/nav/navigationService.ts              NEW  the one navigation session (GPS, engine, voice, reroute, recording)
  src/nav/navigationLocation.ts             NEW  foreground location service while navigating
  src/nav/voice.ts                          NEW  speak via the native ducking voice, Expo's as fallback
  src/nav/useTurnByTurn.ts                  MOD  thin hook over navigationService (+ keep-awake)
  src/car/protocol.ts                       NEW  Zod schemas for everything crossing the bridge
  src/car/controller.ts                     NEW  answers car requests; feeds navigation to the car
  src/car/handlers.ts                       NEW  status, search, discover, plan, planned, routeLine, start, stop, mute
  src/car/navModel.ts                       NEW  NavSnapshot → CarNav (pure)
  src/ui/NavigatingBanner.tsx               NEW
  modules/wayfinder-car/
    expo-module.config.json                 NEW
    index.ts                                NEW  typed native binding (null where not built in)
    android/build.gradle                    NEW
    android/src/main/AndroidManifest.xml    NEW  car service, permissions, car metadata
    android/src/main/res/xml/automotive_app_desc.xml  NEW
    android/src/main/res/drawable/wf_*.xml  NEW  manoeuvre icons (Material Symbols, Apache 2.0)
    android/src/main/java/app/wayfinder/car/
      WayfinderCarModule.kt                 NEW  Expo module: bridge + voice functions
      WayfinderCarAppService.kt             NEW
      WayfinderSession.kt                   NEW
      bridge/{CarBridge,Protocol,CarApi,BridgeCarApi,ReactBoot}.kt  NEW
      screens/{ScreenKit,MessageScreen,HomeScreen,SearchScreen,PickScreen,RoutePreviewScreen,NavigationScreen}.kt  NEW
      nav/{Distances,Maneuvers,ManeuverIcons,NavTemplates,NavigationCoordinator}.kt  NEW
      map/{MapScene,SceneLayout,CarMapRenderer}.kt  NEW
      voice/NavVoice.kt                     NEW
    android/src/test/java/app/wayfinder/car/...    NEW  Robolectric tests
    android/src/test/resources/fixtures/*.json     NEW  bridge contract fixtures
  test/navigation-service.native.test.tsx   NEW
  test/car-controller.native.test.tsx       NEW
  test/car-handlers.native.test.tsx         NEW
  test/navigating-banner.screen.test.tsx    NEW
  test/voice.native.test.tsx                NEW
  test/carModule.test.ts                    NEW  (Vitest) manifest + MapLibre version
  test/carProtocol.test.ts                  NEW  (Vitest) fixtures match schemas
  test/carNavModel.test.ts                  NEW  (Vitest)
  test/categories.test.ts                   NEW  (Vitest)
  test/setup.ts                             MOD  native car module is null by default
  test/fakes.tsx                            MOD  api.refresh / hasAccessToken / hasSavedSession, fakeCarNative()
infra/scripts/test-android-native.sh        NEW  Kotlin tests in the Android build image
package.json                                MOD  test:android, check
vitest.config.ts                            MOD  coverage include for the pure car files
.github/workflows/ci.yml                    MOD  android-native job
docs/*.md, CLAUDE.md                        MOD  Task 15
```

---

### Task 1: One navigation session for the whole app

Navigation state currently lives inside `useTurnByTurn`, a hook owned by the Navigate screen, so it only exists while that screen is mounted. The car needs to start, follow and end the same session without a phone screen, so this task moves the state into a module-level service and turns the hook into a subscriber. Behaviour on the phone is unchanged.

**Files:**
- Create: `apps/mobile/src/nav/navigationService.ts`
- Modify: `apps/mobile/src/nav/useTurnByTurn.ts` (whole file)
- Test: `apps/mobile/test/navigation-service.native.test.tsx`; `apps/mobile/test/turn-by-turn.native.test.tsx` must pass **unchanged**

**Interfaces:**
- Produces:
  ```ts
  export interface NavSnapshot { active: boolean; route: Route | null; destinationName: string | null; state: NavState | null; rerouting: boolean; error: string | null; muted: boolean; position: LngLat | null; headingDeg: number | null }
  export interface NavigationService {
    start(route: Route, opts?: { destinationName?: string }): void;
    stop(): void;
    setMuted(muted: boolean): void;
    handleFix(loc: Location.LocationObject, source?: 'watch' | 'service'): void;
    getSnapshot(): NavSnapshot;
    subscribe(listener: () => void): () => void;
  }
  export const navigation: NavigationService;
  export const REROUTE_RETRY_MS = 15_000;
  ```
  `useTurnByTurn(initial: Route | null): TurnByTurn` keeps its current return type and still re-exports `REROUTE_RETRY_MS`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/navigation-service.native.test.tsx`:

```tsx
/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { navigation } from '../src/nav/navigationService';
import { resetFakes, route } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `session-${++mockUuid}` }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
const mockRemove = jest.fn();
let mockOnFix: ((loc: unknown) => void) | null = null;
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  watchPositionAsync: jest.fn(async (_opts: unknown, cb: (loc: unknown) => void) => {
    mockOnFix = cb;
    return { remove: mockRemove };
  }),
}));
const mockAppend = jest.fn(async (_points: unknown[]) => undefined);
jest.mock('../src/tracking/sqliteStore', () => ({ sqliteQueueStore: { append: (p: unknown[]) => mockAppend(p) } }));
const mockSync = jest.fn(async () => null);
jest.mock('../src/tracking/sync', () => ({ syncQueue: () => mockSync() }));
const mockResults: Array<{ state: object; events: object[] }> = [];
jest.mock('@wayfinder/nav', () => ({
  NavigationSession: class {
    mode: string;
    constructor(r: { mode: string }) {
      this.mode = r.mode;
    }
    update() {
      return mockResults.shift() ?? { state: { status: 'navigating' }, events: [] };
    }
    replaceRoute() {}
  },
}));

const fix = (lon: number, lat: number, ts = 1000) => ({ timestamp: ts, coords: { longitude: lon, latitude: lat, accuracy: 5, speed: 10, heading: 90 } });

beforeEach(() => {
  resetFakes();
  mockResults.length = 0;
  mockOnFix = null;
});
afterEach(() => navigation.stop());

it('navigates with no screen open, as the car starts it', async () => {
  let changes = 0;
  const off = navigation.subscribe(() => changes++);
  navigation.start(route({ id: 'r1' }), { destinationName: 'Mt Coot-tha Lookout' });
  expect(navigation.getSnapshot()).toMatchObject({ active: true, route: { id: 'r1' }, destinationName: 'Mt Coot-tha Lookout', state: null });
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'navigating', remainingDistanceM: 500 }, events: [{ type: 'announce', text: 'Turn left' }] });
  mockOnFix!(fix(153, -27.4));
  expect(navigation.getSnapshot()).toMatchObject({ position: [153, -27.4], headingDeg: 90, state: { remainingDistanceM: 500 } });
  expect(Speech.speak).toHaveBeenCalledWith('Turn left', expect.anything());
  expect(changes).toBeGreaterThanOrEqual(2);
  off();
});

it('starting another trip ends the first and records the new one separately', async () => {
  navigation.start(route({ id: 'r1' }));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153, -27.4));
  const first = (mockAppend.mock.calls[0]![0] as Array<{ sessionId: string }>)[0]!.sessionId;
  mockOnFix = null;
  navigation.start(route({ id: 'r2' }));
  expect(mockRemove).toHaveBeenCalled();
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153.1, -27.4));
  const second = (mockAppend.mock.calls[1]![0] as Array<{ sessionId: string }>)[0]!.sessionId;
  expect(second).not.toBe(first);
  expect(navigation.getSnapshot().route?.id).toBe('r2');
});

it('stop() clears everything, uploads what was recorded, and is safe to repeat', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  navigation.stop();
  navigation.stop();
  expect(navigation.getSnapshot()).toMatchObject({ active: false, route: null, state: null });
  expect(mockSync).toHaveBeenCalledTimes(1);
});

it('ignores fixes once navigation has ended', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  const late = mockOnFix!;
  navigation.stop();
  late(fix(153, -27.4));
  expect(navigation.getSnapshot().position).toBeNull();
  expect(mockAppend).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/mobile && npx jest test/navigation-service.native.test.tsx`
Expected: FAIL, `Cannot find module '../src/nav/navigationService'`.

- [ ] **Step 3: Write the service**

`apps/mobile/src/nav/navigationService.ts`: the logic is moved from `useTurnByTurn.ts`, not rewritten. Keep its comments.

```ts
import { type NavEvent, NavigationSession, type NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import { type Route, RouteSchema } from '@wayfinder/shared/schemas';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { api } from '../lib/api';
import { sqliteQueueStore } from '../tracking/sqliteStore';
import { syncQueue } from '../tracking/sync';

/** How long to wait before asking again for a new route after one couldn't be fetched. */
export const REROUTE_RETRY_MS = 15_000;

export interface NavSnapshot {
  /** A trip is being followed (the phone's Navigate screen, the car, or both). */
  active: boolean;
  route: Route | null;
  /** What the car shows as the destination; the phone doesn't need it. */
  destinationName: string | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  position: LngLat | null;
  headingDeg: number | null;
}

export interface NavigationService {
  start(route: Route, opts?: { destinationName?: string }): void;
  stop(): void;
  setMuted(muted: boolean): void;
  handleFix(loc: Location.LocationObject, source?: 'watch' | 'service'): void;
  getSnapshot(): NavSnapshot;
  subscribe(listener: () => void): () => void;
}

const IDLE: NavSnapshot = { active: false, route: null, destinationName: null, state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null };

/** Run a phone service call whose failure shouldn't stop navigation (it may throw or reject). */
function quietly(run: () => unknown) {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // ignored: see above
  }
}

/**
 * The one navigation session: snaps GPS to the route, speaks manoeuvres, reroutes after repeated
 * off-route fixes, and records the trip (source "navigation"). The phone's Navigate screen and the
 * car screen both follow it, so a trip started on either shows on both.
 */
export function createNavigationService(): NavigationService {
  let snap = IDLE;
  const listeners = new Set<() => void>();
  let session: NavigationSession | null = null;
  let sessionId = '';
  let watch: Location.LocationSubscription | null = null;
  let uploader: ReturnType<typeof setInterval> | null = null;
  let reroutingNow = false;
  /** Set while off route without a new route yet, so a failed attempt is retried. */
  let pendingReroute: { to: LngLat; via: LngLat[]; at: number } | null = null;
  /** Bumped by every start and stop, so work from an earlier trip that finishes late is dropped. */
  let generation = 0;

  const set = (patch: Partial<NavSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  };

  const speak = (text: string) => {
    if (snap.muted) return;
    quietly(() => Speech.stop());
    quietly(() => Speech.speak(text, { language: 'en-AU', rate: 1.0 }));
  };

  async function reroute(from: LngLat, to: LngLat, via: LngLat[]) {
    const current = session;
    if (!current || reroutingNow) return;
    reroutingNow = true;
    pendingReroute = { to, via, at: Date.now() };
    set({ rerouting: true });
    try {
      const next = await api.request('api/routes/fastest', { method: 'POST', body: { from, to, via, mode: current.mode }, schema: RouteSchema });
      if (session !== current) return; // navigation ended while waiting
      current.replaceRoute(next);
      pendingReroute = null;
      set({ route: next, error: null });
      speak('Route updated');
    } catch {
      if (session === current) set({ error: 'Couldn’t get a new route. Keep heading to the destination; trying again shortly.' });
    } finally {
      reroutingNow = false;
      if (session === current) set({ rerouting: false });
    }
  }

  function handleEvents(events: NavEvent[]) {
    for (const e of events) {
      if (e.type === 'announce') speak(e.text);
      if (e.type === 'arrived') {
        speak('You have arrived');
        void syncQueue().catch(() => undefined);
      }
      if (e.type === 'backOnRoute') {
        pendingReroute = null;
        set({ error: null });
      }
      if (e.type === 'offRoute') void reroute(e.from, e.to, e.remainingVia);
    }
  }

  function handleFix(loc: Location.LocationObject, _source: 'watch' | 'service' = 'watch') {
    const nav = session;
    if (!nav) return;
    const { longitude: lon, latitude: lat } = loc.coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const fix = { ts: loc.timestamp, lon, lat, accuracyM: loc.coords.accuracy, speedMps: loc.coords.speed, headingDeg: loc.coords.heading };
    let result: ReturnType<NavigationSession['update']>;
    try {
      result = nav.update(fix);
    } catch {
      set({ position: [lon, lat] });
      return; // one odd fix; the next one carries on
    }
    set({ position: [lon, lat], headingDeg: fix.headingDeg ?? snap.headingDeg, state: result.state });
    handleEvents(result.events);
    // Still off route after a failed attempt: ask again from here, now and then.
    const pending = pendingReroute;
    if (result.state.status === 'offRoute' && pending && !reroutingNow && Date.now() - pending.at >= REROUTE_RETRY_MS) {
      void reroute([lon, lat], pending.to, pending.via);
    }
    void sqliteQueueStore
      .append([
        {
          ...fix,
          accuracyM: fix.accuracyM ?? null,
          speedMps: fix.speedMps ?? null,
          headingDeg: fix.headingDeg ?? null,
          source: 'navigation',
          mode: nav.mode,
          sessionId,
        },
      ])
      .catch(() => undefined);
  }

  function stop() {
    const wasActive = session !== null;
    generation++;
    watch?.remove();
    watch = null;
    if (uploader) clearInterval(uploader);
    uploader = null;
    session = null;
    pendingReroute = null;
    quietly(() => Speech.stop());
    if (wasActive) void syncQueue().catch(() => undefined);
    if (snap !== IDLE) set(IDLE);
  }

  function start(route: Route, opts: { destinationName?: string } = {}) {
    stop();
    let next: NavigationSession;
    try {
      next = new NavigationSession(route);
    } catch {
      // A route too short to follow (from and to the same place, say) must not take the app down.
      set({ ...IDLE, route, error: 'This route can’t be followed. Plan it again, then start the new one.' });
      return;
    }
    session = next;
    sessionId = Crypto.randomUUID();
    const gen = generation;
    set({ ...IDLE, active: true, route, destinationName: opts.destinationName ?? null });
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (gen !== generation) return;
        if (!perm.granted) {
          set({ error: 'Navigation needs location permission.' });
          return;
        }
        const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 1000 }, (loc) => handleFix(loc));
        // Ended while the phone was asking or starting GPS: stop it straight away.
        if (gen !== generation) sub.remove();
        else watch = sub;
      } catch {
        if (gen === generation) set({ error: 'Can’t get your location. Check that location is switched on, then start again.' });
      }
    })();
    uploader = setInterval(() => void syncQueue().catch(() => undefined), 60_000);
  }

  return {
    start,
    stop,
    handleFix,
    setMuted: (muted) => set({ muted }),
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const navigation = createNavigationService();
```

- [ ] **Step 4: Make the hook a subscriber**

Replace `apps/mobile/src/nav/useTurnByTurn.ts` entirely:

```ts
import type { NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useSyncExternalStore } from 'react';
import { navigation } from './navigationService';

export { REROUTE_RETRY_MS } from './navigationService';

export interface TurnByTurn {
  route: Route | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  setMuted(m: boolean): void;
  position: LngLat | null;
  stop(): void;
}

const KEEP_AWAKE_TAG = 'wayfinder-navigation';

function quietly(run: () => unknown) {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // ignored: keep-awake failing mustn't stop navigation
  }
}

/**
 * The Navigate screen's view of the app's navigation session. Given a route, it starts following
 * it and ends the trip when the screen closes. Given none, it shows whatever trip is running
 * (one started from the car, say). Keeps the phone screen on while shown.
 */
export function useTurnByTurn(initial: Route | null): TurnByTurn {
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  useEffect(() => {
    if (initial) navigation.start(initial);
    quietly(() => activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    return () => {
      if (initial) navigation.stop();
      quietly(() => deactivateKeepAwake(KEEP_AWAKE_TAG));
    };
  }, [initial]);
  return {
    route: snap.route,
    state: snap.state,
    rerouting: snap.rerouting,
    error: snap.error,
    muted: snap.muted,
    setMuted: navigation.setMuted,
    position: snap.position,
    stop: navigation.stop,
  };
}
```

- [ ] **Step 5: Run the new and the existing tests**

Run: `cd apps/mobile && npx jest test/navigation-service.native.test.tsx test/turn-by-turn.native.test.tsx test/navigate.screen.test.tsx`
Expected: all PASS. If a `turn-by-turn` test fails, fix the service, not the test: those tests define the phone behaviour this task must keep.

- [ ] **Step 6: Whole gate, then commit**

Run: `pnpm check` (Expected: PASS; raise the Jest floors if coverage went up.)

```bash
git add apps/mobile/src/nav apps/mobile/test/navigation-service.native.test.tsx apps/mobile/jest.config.js
git commit -m "Move navigation out of the Navigate screen into one app-wide session

Navigation lived inside useTurnByTurn, so it only existed while the phone's Navigate screen was
mounted. Android Auto needs to start, follow and end a trip with no phone screen open. The session
is now a module-level service the hook subscribes to; the phone behaves exactly as before (its
tests are unchanged)."
```

---

### Task 2: Keep navigating with the phone locked

GPS comes from `watchPositionAsync`, which Android stops delivering to a backgrounded app. That happens when the phone locks or sits in a pocket while the car shows directions. A location foreground service keeps the app in the foreground for Android while a trip runs. expo-location allows one without "all the time" permission when it's started by the user from the app. Fixes from the service feed the same session; duplicates of fixes the watch already delivered are dropped.

**Files:**
- Create: `apps/mobile/src/nav/navigationLocation.ts`
- Modify: `apps/mobile/src/nav/navigationService.ts` (`start`, `stop`, `handleFix`, module tail)
- Modify: `apps/mobile/test/turn-by-turn.native.test.tsx` and `apps/mobile/test/navigation-service.native.test.tsx` (**add one `jest.mock` line each**, nothing else)
- Test: add cases to `apps/mobile/test/navigation-service.native.test.tsx`

**Interfaces:**
- Consumes: `navigation.handleFix(loc, 'service')` from Task 1.
- Produces: `NAVIGATION_TASK = 'wayfinder-navigation-location'`, `startNavigationLocation(destinationName: string | null): Promise<void>`, `stopNavigationLocation(): Promise<void>`, `setNavigationFixHandler(fn: ((locs: Location.LocationObject[]) => void) | null): void`.

- [ ] **Step 1: Write the failing tests**

Add near the other mocks in `navigation-service.native.test.tsx`:

```tsx
jest.mock('../src/nav/navigationLocation', () => ({
  startNavigationLocation: jest.fn(async () => undefined),
  stopNavigationLocation: jest.fn(async () => undefined),
  setNavigationFixHandler: jest.fn(),
}));
import * as NavLocation from '../src/nav/navigationLocation';

// Registered once when navigationService loads, before resetFakes() clears mock records.
const mockFeed = jest.mocked(NavLocation.setNavigationFixHandler).mock.calls[0]![0]!;
```

and these cases:

```tsx
it('keeps a location service running for the trip, named after the destination', async () => {
  navigation.start(route(), { destinationName: 'Mt Coot-tha Lookout' });
  await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalledWith('Mt Coot-tha Lookout'));
  navigation.stop();
  expect(NavLocation.stopNavigationLocation).toHaveBeenCalled();
});

it('still navigates when the location service cannot start', async () => {
  jest.mocked(NavLocation.startNavigationLocation).mockRejectedValueOnce(new Error('no'));
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  expect(navigation.getSnapshot().error).toBeNull();
});

it('follows fixes from the location service, skipping ones the GPS watch already gave', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153, -27.4, 5000));
  mockFeed([fix(153, -27.4, 5000) as never, fix(153.01, -27.4, 6000) as never]);
  expect(mockAppend).toHaveBeenCalledTimes(2);
  expect(navigation.getSnapshot().position).toEqual([153.01, -27.4]);
});
```

Add the same `jest.mock('../src/nav/navigationLocation', …)` block, verbatim, to `turn-by-turn.native.test.tsx` below its other mocks.

Create `apps/mobile/test/navigation-location.native.test.tsx` for the module itself:

```tsx
/// <reference types="jest" />
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { NAVIGATION_TASK, setNavigationFixHandler, startNavigationLocation, stopNavigationLocation } from '../src/nav/navigationLocation';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

type Task = (body: { data?: { locations?: unknown[] }; error?: unknown }) => Promise<void>;
const [name, task] = jest.mocked(TaskManager.defineTask).mock.calls[0] as unknown as [string, Task];

it('runs every second with a notification that says where you are going', async () => {
  await startNavigationLocation('Mt Coot-tha Lookout');
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
    NAVIGATION_TASK,
    expect.objectContaining({ timeInterval: 1000, distanceInterval: 5, deferredUpdatesInterval: 0, foregroundService: expect.objectContaining({ notificationTitle: 'Navigating to Mt Coot-tha Lookout', killServiceOnDestroy: true }) }),
  );
});

it('hands each batch of locations to navigation', async () => {
  expect(name).toBe(NAVIGATION_TASK);
  const got: unknown[][] = [];
  setNavigationFixHandler((locs) => got.push(locs));
  await task({ data: { locations: [{ a: 1 }] } });
  await task({ error: new Error('x') });
  expect(got).toEqual([[{ a: 1 }]]);
  setNavigationFixHandler(null);
});

it('stops only a service that is running', async () => {
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValueOnce(false);
  await stopNavigationLocation();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  await stopNavigationLocation();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/mobile && npx jest test/navigation-location.native.test.tsx test/navigation-service.native.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the location service**

`apps/mobile/src/nav/navigationLocation.ts`:

```ts
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const NAVIGATION_TASK = 'wayfinder-navigation-location';

let onFixes: ((locs: Location.LocationObject[]) => void) | null = null;

// Must be defined at module scope so Android can hand it locations (see tracking/background.ts).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(NAVIGATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  onFixes?.(data.locations);
});

/** Where the navigation session takes these fixes. */
export function setNavigationFixHandler(fn: ((locs: Location.LocationObject[]) => void) | null) {
  onFixes = fn;
}

/**
 * A foreground service for the length of a trip, so directions keep coming with the phone locked
 * or in a pocket while the car shows them. Started by the person from the app, so Android allows
 * it with "while using the app" location permission alone.
 */
export async function startNavigationLocation(destinationName: string | null) {
  await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: destinationName ? `Navigating to ${destinationName}` : 'Navigating',
      notificationBody: 'Directions keep going with the screen off.',
      notificationColor: '#1765cc',
      killServiceOnDestroy: true,
    },
  });
}

export async function stopNavigationLocation() {
  if (await Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(NAVIGATION_TASK);
}
```

- [ ] **Step 4: Wire it into the service**

In `navigationService.ts`:

1. Import: `import { setNavigationFixHandler, startNavigationLocation, stopNavigationLocation } from './navigationLocation';`
2. Add a variable next to `generation`: `let lastFixTs = -Infinity;`
3. At the top of `handleFix`, after the `Number.isFinite` check, replace the `_source` parameter name with `source` and add:
   ```ts
   // The location service repeats fixes the GPS watch already delivered.
   if (source === 'service' && loc.timestamp <= lastFixTs) return;
   lastFixTs = Math.max(lastFixTs, loc.timestamp);
   ```
4. In `start`, after `sessionId = Crypto.randomUUID();` add `lastFixTs = -Infinity;`. Inside the async block, after the permission check passes and before `watchPositionAsync`, add:
   ```ts
   // Failing to start it only matters with the phone locked; the watch below still navigates.
   void startNavigationLocation(opts.destinationName ?? null).catch(() => undefined);
   ```
5. In `stop`, after `watch = null;` add: `if (wasActive) void stopNavigationLocation().catch(() => undefined);`
6. After `export const navigation = createNavigationService();` add:
   ```ts
   setNavigationFixHandler((locs) => locs.forEach((l) => navigation.handleFix(l, 'service')));
   ```

- [ ] **Step 5: Run the tests**

Run: `cd apps/mobile && npx jest test/navigation-location.native.test.tsx test/navigation-service.native.test.tsx test/turn-by-turn.native.test.tsx test/navigate.screen.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gate and commit**

Run `pnpm check`, then:

```bash
git add apps/mobile/src/nav apps/mobile/test apps/mobile/jest.config.js
git commit -m "Keep navigating with the phone locked

Directions came from a GPS watch that Android stops feeding once the app is in the background,
which is where it is when the phone is locked or pocketed and the car shows the way. A location
foreground service now runs for each trip (allowed with while-in-use permission because the
person starts it) and its fixes feed the same session; repeats of watch fixes are skipped."
```

---

### Task 3: The Android Auto module and a place to test Kotlin

Adds the local Expo module with the car service and its manifest entries. Opening Wayfinder in a car shows "Getting ready…" for now. This task also adds the Gradle test pipeline that every later Kotlin task relies on. Confirm the two open decisions at the top before starting.

**Files:**
- Create: `apps/mobile/modules/wayfinder-car/expo-module.config.json`
- Create: `apps/mobile/modules/wayfinder-car/android/build.gradle`
- Create: `apps/mobile/modules/wayfinder-car/android/src/main/AndroidManifest.xml`
- Create: `apps/mobile/modules/wayfinder-car/android/src/main/res/xml/automotive_app_desc.xml`
- Create: `apps/mobile/modules/wayfinder-car/android/src/main/java/app/wayfinder/car/WayfinderCarModule.kt`
- Create: `.../app/wayfinder/car/WayfinderCarAppService.kt`, `.../WayfinderSession.kt`, `.../screens/MessageScreen.kt`, `.../screens/ScreenKit.kt`
- Create: `apps/mobile/modules/wayfinder-car/android/src/test/java/app/wayfinder/car/screens/MessageScreenTest.kt`, `.../TestKit.kt`
- Create: `infra/scripts/test-android-native.sh`
- Modify: `package.json` (scripts), `.github/workflows/ci.yml`, `apps/mobile/tsconfig.json`
- Test: `apps/mobile/test/carModule.test.ts` (Vitest)

**Interfaces:**
- Produces: `MessageScreen(carContext, message: String, retry: (() -> Unit)? = null)`; `Screen.whenCreated(block)`, `Screen.whenStarted(block)`, `appName(carContext)`, `MAX_ROWS = 6`, `row(title, detail, onClick)` in `ScreenKit.kt`; test helpers `CarText?.text()`, `Row.click()`, `newCarContext()` in `TestKit.kt`; root script `pnpm test:android`.

- [ ] **Step 1: Write the failing Vitest check**

`apps/mobile/test/carModule.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const moduleDir = join(__dirname, '../modules/wayfinder-car/android');

describe('Android Auto module', () => {
  it('declares a navigation app Android Auto will list', () => {
    const manifest = readFileSync(join(moduleDir, 'src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('<action android:name="androidx.car.app.CarAppService" />');
    expect(manifest).toContain('<category android:name="androidx.car.app.category.NAVIGATION" />');
    expect(manifest).toContain('android:name="androidx.car.app.NAVIGATION_TEMPLATES"');
    expect(manifest).toContain('android:name="androidx.car.app.ACCESS_SURFACE"');
    expect(manifest).toContain('android:name="com.google.android.gms.car.application"');
    expect(manifest).toContain('android:name="androidx.car.app.minCarApiLevel"');
  });

  it('draws the car map with the same MapLibre Native as the phone map', () => {
    const gradle = readFileSync(join(moduleDir, 'build.gradle'), 'utf8');
    const props = readFileSync(join(__dirname, '../node_modules/@maplibre/maplibre-react-native/android/gradle.properties'), 'utf8');
    const phone = /org\.maplibre\.reactnative\.nativeVersion=(\S+)/.exec(props)![1];
    const variant = /org\.maplibre\.reactnative\.nativeVariant=(\S+)/.exec(props)![1];
    expect(gradle).toContain(`def maplibreVersion = '${phone}'`);
    expect(gradle).toContain(`org.maplibre.gl:android-sdk-${variant}:`);
  });
});
```

Run: `npx vitest run apps/mobile/test/carModule.test.ts`, Expected: FAIL (file not found).

- [ ] **Step 2: Module files**

`apps/mobile/modules/wayfinder-car/expo-module.config.json`:

```json
{
  "platforms": ["android"],
  "android": { "modules": ["app.wayfinder.car.WayfinderCarModule"] }
}
```

`apps/mobile/modules/wayfinder-car/android/build.gradle`:

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'app.wayfinder.car'
version = '0.1.0'

// The car library and its test harness must be the same version.
def carAppVersion = '1.7.0'
// Must equal org.maplibre.reactnative.nativeVersion in @maplibre/maplibre-react-native
// (apps/mobile/test/carModule.test.ts checks), so the phone and car maps share one engine.
def maplibreVersion = '13.2.0'

android {
  namespace 'app.wayfinder.car'
  defaultConfig {
    versionCode 1
    versionName '0.1.0'
  }
  testOptions {
    unitTests {
      includeAndroidResources = true
    }
  }
}

dependencies {
  implementation 'com.facebook.react:react-android'
  implementation "androidx.car.app:app:$carAppVersion"
  implementation "org.maplibre.gl:android-sdk-opengl:$maplibreVersion"

  testImplementation "androidx.car.app:app-testing:$carAppVersion"
  testImplementation 'junit:junit:4.13.2'
  testImplementation 'org.robolectric:robolectric:4.14.1'
  testImplementation 'androidx.test:core:1.6.1'
}
```

If Gradle reports that it can't find `expo-module-gradle-plugin`, generate a throwaway module with `npx create-expo-module@latest --local` in a scratch copy and match its `build.gradle` header for this SDK. Keep the dependencies above.

`apps/mobile/modules/wayfinder-car/android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- Navigation templates and drawing our own map on the car screen. -->
  <uses-permission android:name="androidx.car.app.NAVIGATION_TEMPLATES" />
  <uses-permission android:name="androidx.car.app.ACCESS_SURFACE" />

  <application>
    <meta-data
      android:name="com.google.android.gms.car.application"
      android:resource="@xml/automotive_app_desc" />
    <!-- Only templates every Android Auto version has; see docs/architecture.md. -->
    <meta-data
      android:name="androidx.car.app.minCarApiLevel"
      android:value="1" />

    <service
      android:name="app.wayfinder.car.WayfinderCarAppService"
      android:exported="true">
      <intent-filter>
        <action android:name="androidx.car.app.CarAppService" />
        <category android:name="androidx.car.app.category.NAVIGATION" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

`apps/mobile/modules/wayfinder-car/android/src/main/res/xml/automotive_app_desc.xml`:

```xml
<automotiveApp>
  <uses name="template" />
</automotiveApp>
```

`.../java/app/wayfinder/car/WayfinderCarModule.kt` (bridge functions arrive in Task 5):

```kotlin
package app.wayfinder.car

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side's handle on the car app. */
class WayfinderCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WayfinderCar")
  }
}
```

`.../WayfinderCarAppService.kt`:

```kotlin
package app.wayfinder.car

import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/** Android Auto's way in: the car binds this when someone opens Wayfinder on the car screen. */
class WayfinderCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      // Release builds only answer Google's own Android Auto apps.
      HostValidator.Builder(applicationContext)
        .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
        .build()
    }

  override fun onCreateSession(): Session = WayfinderSession()
}
```

`.../WayfinderSession.kt` (replaced in Task 8):

```kotlin
package app.wayfinder.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import app.wayfinder.car.screens.MessageScreen

class WayfinderSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = MessageScreen(carContext, "Getting ready…")
}
```

`.../screens/ScreenKit.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Row
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/** Android Auto shows at most about six rows while driving; lists never offer more. */
const val MAX_ROWS = 6

fun appName(carContext: CarContext): String =
  carContext.applicationInfo.loadLabel(carContext.packageManager).toString()

fun row(title: String, detail: String?, onClick: () -> Unit): Row =
  Row.Builder().setTitle(title).apply { if (!detail.isNullOrEmpty()) addText(detail) }.setOnClickListener(onClick).build()

fun Screen.whenCreated(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onCreate(owner: LifecycleOwner) = block()
  })

/** Runs each time the screen comes back to the top, e.g. after Back from the screen above. */
fun Screen.whenStarted(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) = block()
  })
```

`.../screens/MessageScreen.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/** A sentence for the driver, with "Try again" when there is something to retry. */
class MessageScreen(
  carContext: CarContext,
  private val message: String,
  private val retry: (() -> Unit)? = null,
) : Screen(carContext) {
  override fun onGetTemplate(): Template =
    MessageTemplate.Builder(message)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.APP_ICON)
      .apply { retry?.let { r -> addAction(Action.Builder().setTitle("Try again").setOnClickListener { r() }.build()) } }
      .build()
}
```

- [ ] **Step 3: Kotlin test and helpers**

`.../src/test/java/app/wayfinder/car/TestKit.kt`:

```kotlin
package app.wayfinder.car

import android.os.Looper
import androidx.car.app.OnDoneCallback
import androidx.car.app.model.CarText
import androidx.car.app.model.Row
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import org.robolectric.Shadows.shadowOf

fun newCarContext(): TestCarContext = TestCarContext.createCarContext(ApplicationProvider.getApplicationContext())

fun CarText?.text(): String? = this?.toCharSequence()?.toString()

/** Taps a row the way the car does, then lets the main thread run what it posted. */
fun Row.click() {
  onClickDelegate!!.sendClick(object : OnDoneCallback {})
  shadowOf(Looper.getMainLooper()).idle()
}
```

`.../src/test/java/app/wayfinder/car/screens/MessageScreenTest.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import app.wayfinder.car.newCarContext
import app.wayfinder.car.text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MessageScreenTest {
  @Test fun showsTheMessage() {
    val t = MessageScreen(newCarContext(), "Open Wayfinder on your phone and sign in.").onGetTemplate() as MessageTemplate
    assertEquals("Open Wayfinder on your phone and sign in.", t.message.text())
    assertTrue(t.actions.isEmpty())
  }

  @Test fun offersTryAgainWhenThereIsSomethingToRetry() {
    var tried = 0
    val t = MessageScreen(newCarContext(), "Can’t reach your server.") { tried++ }.onGetTemplate() as MessageTemplate
    assertEquals("Try again", t.actions.single().title.text())
  }
}
```

- [ ] **Step 4: The test pipeline**

`infra/scripts/test-android-native.sh` (then `chmod +x`):

```sh
#!/bin/sh
# Run the Android Auto module's Kotlin tests (apps/mobile/modules/wayfinder-car) in the Android
# build image; no local Android SDK needed. Like build-apk.sh it prebuilds the native project, so
# it takes over node_modules while it runs and puts them back at the end.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-wayfinder-android-build}"

if [ -z "${ANDROID_BUILD_IMAGE:-}" ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE (one-off, downloads the Android SDK and NDK)..."
  docker build -t "$IMAGE" -f "$ROOT/infra/docker/android.Dockerfile" "$ROOT/infra"
fi

docker run --rm -t \
  -v "$ROOT":/workspace -w /workspace \
  -v wayfinder-apk-pnpm-store:/pnpm-store \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e CI=1 \
  -e GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g" \
  "$IMAGE" sh -c '
    set -eu
    trap "chown -hR \"\$HOST_UID:\$HOST_GID\" /workspace/node_modules /workspace/apps /workspace/packages /workspace/.gradle-docker 2>/dev/null || true" EXIT
    command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@11.26.0
    pnpm install --frozen-lockfile --store-dir /pnpm-store
    cd apps/mobile
    npx expo prebuild --platform android --clean
    cd android
    ./gradlew :wayfinder-car:testDebugUnitTest
  '

# The container installed node_modules against its own store; put this machine's back.
if command -v pnpm >/dev/null 2>&1 && grep -q '"storeDir": "/pnpm-store' "$ROOT/node_modules/.modules.yaml" 2>/dev/null; then
  (cd "$ROOT" && CI=true pnpm install --frozen-lockfile >/dev/null)
fi
```

The Gradle project name for a local module is normally its directory name. Confirm it the first time by running `./gradlew projects | grep -i wayfinder` inside the container, and adjust `:wayfinder-car:` if it differs.

Root `package.json` scripts:

```json
"test:android": "sh infra/scripts/test-android-native.sh",
"check": "pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:mobile:coverage && pnpm test:e2e && pnpm test:android",
```

`test:android` runs last because it takes over `node_modules` while it runs.

`.github/workflows/ci.yml`: add a job:

```yaml
  android-native:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 11.26.0
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
      - run: pnpm install --frozen-lockfile
      - name: Generate the Android project
        run: pnpm --filter @wayfinder/mobile exec expo prebuild --platform android --clean
        env:
          CI: '1'
      - name: Android Auto module tests (Robolectric)
        working-directory: apps/mobile/android
        run: ./gradlew :wayfinder-car:testDebugUnitTest
```

`apps/mobile/tsconfig.json`: `"include": ["app", "src", "test", "modules", "index.ts", "app.config.ts"]`.

- [ ] **Step 5: Run everything**

Run: `npx vitest run apps/mobile/test/carModule.test.ts` → PASS
Run: `pnpm test:android` → `MessageScreenTest` 2 tests PASS.

- [ ] **Step 6: See it in a car (manual, once)**

Build a debug APK or run `pnpm --filter @wayfinder/mobile android` against a phone. Start the Desktop Head Unit (setup in Task 15, "Trying it in a car"). Expected: Wayfinder is listed in Android Auto's launcher, and opening it shows "Getting ready…". If it isn't listed, check that Android Auto's developer settings have **Unknown sources** on.

- [ ] **Step 7: Gate and commit**

```bash
git add apps/mobile/modules apps/mobile/test/carModule.test.ts apps/mobile/tsconfig.json infra/scripts/test-android-native.sh package.json .github/workflows/ci.yml
git commit -m "Add the Android Auto module and a way to test Kotlin

Wayfinder had no native code of its own, and android/ is regenerated on every build, so the car
app lives in a local Expo module whose manifest merges into the app. Opening Wayfinder in a car
now shows a placeholder. Kotlin tests run with Robolectric through pnpm test:android (in the
Android build image) and a CI job."
```

---

### Task 4: The bridge contract

Everything the car and JavaScript say to each other, defined once in Zod, read in Kotlin, and pinned by JSON fixtures that both test suites parse.

**Files:**
- Create: `apps/mobile/src/car/protocol.ts`
- Create: `apps/mobile/modules/wayfinder-car/android/src/main/java/app/wayfinder/car/bridge/Protocol.kt`
- Create: fixtures in `apps/mobile/modules/wayfinder-car/android/src/test/resources/fixtures/`: `status.json`, `places.json`, `plan.json`, `planned.json`, `route-line.json`, `nav-navigating.json`, `nav-arrived.json`
- Test: `apps/mobile/test/carProtocol.test.ts` (Vitest), `.../src/test/java/app/wayfinder/car/bridge/ProtocolTest.kt`
- Modify: `vitest.config.ts` (coverage include), `apps/mobile/jest.config.js` (exclude)

**Interfaces:**
- Produces (TS): schemas `CarStatusSchema`, `CarPlacesSchema`, `CarPlanSchema`, `CarPlannedSchema`, `CarRouteLineSchema`, `CarNavSchema`, `ManeuverTypeSchema`, and `CarParams.{search,plan,routeLine,start,mute}`; types `CarStatus`, `CarPlace`, `CarRouteOption`, `CarManeuver`, `ManeuverType`, `CarNav`.
- Produces (Kotlin, package `app.wayfinder.car.bridge`): `LngLat`, `Account`, `CarStatus`, `CarPlace`, `RouteOption`, `PlanResult`, `PlannedItem`, `CarManeuver`, `NextStep`, `NavStatus`, `CarNav`; `object Protocol { status, places, plan, planned, line, nav }`.

- [ ] **Step 1: Fixtures**

`status.json`:
```json
{
  "account": "signedIn",
  "styleUrl": { "light": "https://maps.example.test/map/style.json?theme=light", "dark": "https://maps.example.test/map/style.json?theme=dark" },
  "searchHint": "Search places and addresses",
  "here": [153.0251, -27.4698]
}
```

`places.json`:
```json
{
  "places": [
    { "id": "p1", "name": "Mt Coot-tha Lookout", "detail": "Lookout · 6.2 km away · 62% unexplored area", "location": [152.957, -27.4846], "distanceM": 6200 },
    { "id": "p2", "name": "Queen Street Mall", "detail": "Brisbane City QLD 4000", "location": [153.0251, -27.4698], "distanceM": null }
  ]
}
```

`plan.json`:
```json
{
  "options": [
    { "routeId": "r-fast", "title": "Fastest", "detail": "25 min · 1.2 km you’ve never been", "durationS": 1500, "distanceM": 18400, "extraDurationS": 0, "geometry": [[153.0251, -27.4698], [152.957, -27.4846]] },
    { "routeId": "r-exp", "title": "Explore 1", "detail": "32 min (7 min longer) · 9.4 km you’ve never been", "durationS": 1920, "distanceM": 22100, "extraDurationS": 420, "geometry": [[153.0251, -27.4698], [153.0, -27.5], [152.957, -27.4846]] }
  ],
  "note": null
}
```

`planned.json`:
```json
{
  "items": [
    { "id": "pl1", "name": "Sunday drive", "option": { "routeId": "r-sun", "title": "Sunday drive", "detail": "1 h 10 min · 40 km you’ve never been", "durationS": 4200, "distanceM": 81000, "extraDurationS": 0, "geometry": [[153.0, -27.4], [152.9, -27.3]] } }
  ]
}
```

`route-line.json`:
```json
{ "geometry": [[153.0251, -27.4698], [153.0, -27.5], [152.957, -27.4846]] }
```

`nav-navigating.json`:
```json
{
  "routeId": "r-fast", "destinationName": "Mt Coot-tha Lookout", "status": "navigating",
  "rerouting": false, "muted": false, "error": null,
  "maneuver": { "type": "roundabout", "exit": 2 }, "cue": "At the roundabout, take the 2nd exit onto Sir Samuel Griffith Drive", "road": "Sir Samuel Griffith Drive",
  "distanceToManeuverM": 350,
  "next": { "maneuver": { "type": "left", "exit": null }, "cue": "Turn left" },
  "remainingDistanceM": 4200, "remainingDurationS": 540, "arrivalEpochMs": 1790000000000,
  "position": [152.99, -27.48], "headingDeg": 270
}
```

`nav-arrived.json`:
```json
{
  "routeId": "r-fast", "destinationName": null, "status": "arrived",
  "rerouting": false, "muted": true, "error": null,
  "maneuver": { "type": "destination", "exit": null }, "cue": "Arrive at destination", "road": "",
  "distanceToManeuverM": null, "next": null,
  "remainingDistanceM": 0, "remainingDurationS": 0, "arrivalEpochMs": 1790000000000,
  "position": null, "headingDeg": null
}
```

- [ ] **Step 2: Failing TS test**

`apps/mobile/test/carProtocol.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { CarNavSchema, CarPlacesSchema, CarPlannedSchema, CarPlanSchema, CarRouteLineSchema, CarStatusSchema } from '../src/car/protocol';

const dir = join(__dirname, '../modules/wayfinder-car/android/src/test/resources/fixtures');
const schemaFor: Record<string, ZodType> = {
  'status.json': CarStatusSchema,
  'places.json': CarPlacesSchema,
  'plan.json': CarPlanSchema,
  'planned.json': CarPlannedSchema,
  'route-line.json': CarRouteLineSchema,
  'nav-navigating.json': CarNavSchema,
  'nav-arrived.json': CarNavSchema,
};

it.each(Object.entries(schemaFor))('%s is what the JavaScript side sends', (file, schema) => {
  const parsed = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  expect(parsed.error?.issues ?? []).toEqual([]);
});

it('checks every fixture the Kotlin tests read', () => {
  expect(readdirSync(dir).sort()).toEqual(Object.keys(schemaFor).sort());
});
```

Run: `npx vitest run apps/mobile/test/carProtocol.test.ts`, Expected: FAIL (module not found).

- [ ] **Step 3: `protocol.ts`**

```ts
/**
 * What the Android Auto screens and the JavaScript side say to each other. The Kotlin half is
 * modules/wayfinder-car/android/src/main/java/app/wayfinder/car/bridge/Protocol.kt. Both test
 * suites parse the fixtures in modules/wayfinder-car/android/src/test/resources/fixtures, so a
 * change here that Kotlin doesn't know about fails a test. Coordinates are [lon, lat].
 */
import { LngLatSchema } from '@wayfinder/shared/schemas';
import { z } from 'zod';

export const CarStatusSchema = z.object({
  /** "offline": signed in on the phone, but the server couldn't be reached to confirm it. */
  account: z.enum(['signedIn', 'signedOut', 'offline']),
  styleUrl: z.object({ light: z.string(), dark: z.string() }).nullable(),
  searchHint: z.string(),
  /** The phone's last known position, for the first view of the map. */
  here: LngLatSchema.nullable(),
});

export const CarPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line under the name, ready to show. */
  detail: z.string(),
  location: LngLatSchema,
  distanceM: z.number().nullable(),
});
export const CarPlacesSchema = z.object({ places: z.array(CarPlaceSchema) });

export const CarRouteOptionSchema = z.object({
  routeId: z.string(),
  title: z.string(),
  detail: z.string(),
  durationS: z.number(),
  distanceM: z.number(),
  extraDurationS: z.number(),
  geometry: z.array(LngLatSchema),
});
export const CarPlanSchema = z.object({ options: z.array(CarRouteOptionSchema), note: z.string().nullable() });
export const CarPlannedSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), option: CarRouteOptionSchema })) });
export const CarRouteLineSchema = z.object({ geometry: z.array(LngLatSchema) });

export const ManeuverTypeSchema = z.enum([
  'straight', 'slightLeft', 'left', 'sharpLeft', 'slightRight', 'right', 'sharpRight',
  'keepLeft', 'keepRight', 'uTurnLeft', 'uTurnRight', 'roundabout', 'roundaboutExit', 'waypoint', 'destination',
]);
export const CarManeuverSchema = z.object({ type: ManeuverTypeSchema, exit: z.number().int().positive().nullable() });

export const CarNavSchema = z.object({
  routeId: z.string(),
  destinationName: z.string().nullable(),
  status: z.enum(['starting', 'navigating', 'offRoute', 'arrived']),
  rerouting: z.boolean(),
  muted: z.boolean(),
  error: z.string().nullable(),
  maneuver: CarManeuverSchema.nullable(),
  cue: z.string(),
  road: z.string(),
  distanceToManeuverM: z.number().nullable(),
  /** A manoeuvre close after the next one, shown as "then …". */
  next: z.object({ maneuver: CarManeuverSchema, cue: z.string() }).nullable(),
  remainingDistanceM: z.number(),
  remainingDurationS: z.number(),
  arrivalEpochMs: z.number().int(),
  position: LngLatSchema.nullable(),
  headingDeg: z.number().nullable(),
});

/** What the car sends with each request. */
export const CarParams = {
  search: z.object({ q: z.string().trim().min(1).max(200) }),
  plan: z.object({ to: LngLatSchema }),
  routeLine: z.object({ routeId: z.string() }),
  start: z.object({ routeId: z.string(), destinationName: z.string().max(200) }),
  mute: z.object({ muted: z.boolean() }),
};

export type CarStatus = z.infer<typeof CarStatusSchema>;
export type CarPlace = z.infer<typeof CarPlaceSchema>;
export type CarRouteOption = z.infer<typeof CarRouteOptionSchema>;
export type ManeuverType = z.infer<typeof ManeuverTypeSchema>;
export type CarManeuver = z.infer<typeof CarManeuverSchema>;
export type CarNav = z.infer<typeof CarNavSchema>;
```

Run the Vitest test → PASS.

- [ ] **Step 4: Failing Kotlin test**

`.../src/test/java/app/wayfinder/car/bridge/ProtocolTest.kt`:

```kotlin
package app.wayfinder.car.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

fun fixture(name: String): JSONObject =
  JSONObject(ProtocolTest::class.java.classLoader!!.getResource("fixtures/$name")!!.readText())

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProtocolTest {
  @Test fun status() {
    val s = Protocol.status(fixture("status.json"))
    assertEquals(Account.SIGNED_IN, s.account)
    assertEquals("https://maps.example.test/map/style.json?theme=dark", s.styleDark)
    assertEquals(LngLat(153.0251, -27.4698), s.here)
  }

  @Test fun places() {
    val p = Protocol.places(fixture("places.json"))
    assertEquals(listOf("Mt Coot-tha Lookout", "Queen Street Mall"), p.map { it.name })
    assertEquals(6200.0, p[0].distanceM!!, 0.0)
    assertNull(p[1].distanceM)
  }

  @Test fun plan() {
    val p = Protocol.plan(fixture("plan.json"))
    assertEquals(listOf("r-fast", "r-exp"), p.options.map { it.routeId })
    assertEquals(3, p.options[1].geometry.size)
    assertNull(p.note)
  }

  @Test fun planned() = assertEquals("r-sun", Protocol.planned(fixture("planned.json")).single().option.routeId)

  @Test fun routeLine() = assertEquals(LngLat(152.957, -27.4846), Protocol.line(fixture("route-line.json").getJSONArray("geometry")).last())

  @Test fun navigating() {
    val n = Protocol.nav(fixture("nav-navigating.json"))
    assertEquals(NavStatus.NAVIGATING, n.status)
    assertEquals(CarManeuver("roundabout", 2), n.maneuver)
    assertEquals(NextStep(CarManeuver("left", null), "Turn left"), n.next)
    assertEquals(1790000000000L, n.arrivalEpochMs)
  }

  @Test fun arrived() {
    val n = Protocol.nav(fixture("nav-arrived.json"))
    assertEquals(NavStatus.ARRIVED, n.status)
    assertNull(n.destinationName)
    assertNull(n.position)
    assertNull(n.distanceToManeuverM)
  }
}
```

Run `pnpm test:android` → FAIL (unresolved references).

- [ ] **Step 5: `Protocol.kt`**

```kotlin
package app.wayfinder.car.bridge

import org.json.JSONArray
import org.json.JSONObject

/** [lon, lat], as everywhere in Wayfinder; turned into LatLng only at the map. */
data class LngLat(val lon: Double, val lat: Double)

enum class Account { SIGNED_IN, SIGNED_OUT, OFFLINE }
data class CarStatus(val account: Account, val styleLight: String?, val styleDark: String?, val searchHint: String, val here: LngLat?)
data class CarPlace(val id: String, val name: String, val detail: String, val location: LngLat, val distanceM: Double?)
data class RouteOption(
  val routeId: String, val title: String, val detail: String,
  val durationS: Double, val distanceM: Double, val extraDurationS: Double, val geometry: List<LngLat>,
)
data class PlanResult(val options: List<RouteOption>, val note: String?)
data class PlannedItem(val id: String, val name: String, val option: RouteOption)
data class CarManeuver(val type: String, val exit: Int?)
data class NextStep(val maneuver: CarManeuver, val cue: String)
enum class NavStatus { STARTING, NAVIGATING, OFF_ROUTE, ARRIVED }
data class CarNav(
  val routeId: String, val destinationName: String?, val status: NavStatus,
  val rerouting: Boolean, val muted: Boolean, val error: String?,
  val maneuver: CarManeuver?, val cue: String, val road: String, val distanceToManeuverM: Double?, val next: NextStep?,
  val remainingDistanceM: Double, val remainingDurationS: Double, val arrivalEpochMs: Long,
  val position: LngLat?, val headingDeg: Double?,
)

/**
 * Reads what the JavaScript side sends. apps/mobile/src/car/protocol.ts is the other half; the
 * fixtures under src/test/resources keep the two in step.
 */
object Protocol {
  fun status(o: JSONObject): CarStatus {
    val style = if (o.isNull("styleUrl")) null else o.getJSONObject("styleUrl")
    return CarStatus(
      account = when (o.getString("account")) {
        "signedIn" -> Account.SIGNED_IN
        "offline" -> Account.OFFLINE
        else -> Account.SIGNED_OUT
      },
      styleLight = style?.getString("light"),
      styleDark = style?.getString("dark"),
      searchHint = o.getString("searchHint"),
      here = if (o.isNull("here")) null else lngLat(o.getJSONArray("here")),
    )
  }

  fun places(o: JSONObject): List<CarPlace> = o.getJSONArray("places").objects().map(::place)

  fun place(o: JSONObject) = CarPlace(o.getString("id"), o.getString("name"), o.getString("detail"), lngLat(o.getJSONArray("location")), o.doubleOrNull("distanceM"))

  fun plan(o: JSONObject) = PlanResult(o.getJSONArray("options").objects().map(::option), o.stringOrNull("note"))

  fun planned(o: JSONObject): List<PlannedItem> =
    o.getJSONArray("items").objects().map { PlannedItem(it.getString("id"), it.getString("name"), option(it.getJSONObject("option"))) }

  fun option(o: JSONObject) = RouteOption(
    o.getString("routeId"), o.getString("title"), o.getString("detail"),
    o.getDouble("durationS"), o.getDouble("distanceM"), o.getDouble("extraDurationS"), line(o.getJSONArray("geometry")),
  )

  fun line(a: JSONArray): List<LngLat> = (0 until a.length()).map { lngLat(a.getJSONArray(it)) }

  fun nav(o: JSONObject) = CarNav(
    routeId = o.getString("routeId"),
    destinationName = o.stringOrNull("destinationName"),
    status = when (o.getString("status")) {
      "navigating" -> NavStatus.NAVIGATING
      "offRoute" -> NavStatus.OFF_ROUTE
      "arrived" -> NavStatus.ARRIVED
      else -> NavStatus.STARTING
    },
    rerouting = o.getBoolean("rerouting"),
    muted = o.getBoolean("muted"),
    error = o.stringOrNull("error"),
    maneuver = if (o.isNull("maneuver")) null else maneuver(o.getJSONObject("maneuver")),
    cue = o.getString("cue"),
    road = o.getString("road"),
    distanceToManeuverM = o.doubleOrNull("distanceToManeuverM"),
    next = if (o.isNull("next")) null else o.getJSONObject("next").let { NextStep(maneuver(it.getJSONObject("maneuver")), it.getString("cue")) },
    remainingDistanceM = o.getDouble("remainingDistanceM"),
    remainingDurationS = o.getDouble("remainingDurationS"),
    arrivalEpochMs = o.getLong("arrivalEpochMs"),
    position = if (o.isNull("position")) null else lngLat(o.getJSONArray("position")),
    headingDeg = o.doubleOrNull("headingDeg"),
  )

  private fun maneuver(o: JSONObject) = CarManeuver(o.getString("type"), if (o.isNull("exit")) null else o.getInt("exit"))
  private fun lngLat(a: JSONArray) = LngLat(a.getDouble(0), a.getDouble(1))
  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
  private fun JSONObject.doubleOrNull(k: String): Double? = if (isNull(k)) null else getDouble(k)
  private fun JSONObject.stringOrNull(k: String): String? = if (isNull(k)) null else getString(k)
}
```

- [ ] **Step 6: Coverage bookkeeping**

`vitest.config.ts` coverage `include`: add `'apps/mobile/src/car/protocol.ts'`. `apps/mobile/jest.config.js` `collectCoverageFrom`: add `'!src/car/protocol.ts'`. It's measured by Vitest, like `apiClient.ts`.

- [ ] **Step 7: Run and commit**

Run: `npx vitest run apps/mobile/test/carProtocol.test.ts`, then `pnpm test:android`, then `pnpm check`. All PASS.

```bash
git add apps/mobile/src/car/protocol.ts apps/mobile/modules/wayfinder-car apps/mobile/test/carProtocol.test.ts vitest.config.ts apps/mobile/jest.config.js
git commit -m "Define what the car and the app say to each other

The car screens are Kotlin and the data lives in JavaScript. The messages between them are now
Zod schemas on one side and parsers on the other, pinned by JSON fixtures both test suites read,
so either side changing alone fails a test."
```

---

### Task 5: The bridge, and starting the app from the car

The car screens ask questions through a Kotlin `CarBridge`. The Expo module delivers each one to JavaScript as an `onCall` event, and JavaScript answers with `resolve` or `reject`. If the phone app wasn't running, Kotlin starts React, and the new entry file starts the car controller before any screen. This task implements the first request, `status`.

**Files:**
- Create: `.../bridge/CarBridge.kt`, `.../bridge/CarApi.kt`, `.../bridge/BridgeCarApi.kt`, `.../bridge/ReactBoot.kt`
- Modify: `.../WayfinderCarModule.kt`
- Create: `apps/mobile/modules/wayfinder-car/index.ts`
- Create: `apps/mobile/src/car/controller.ts`, `apps/mobile/src/car/handlers.ts`
- Create: `apps/mobile/index.ts`; Modify: `apps/mobile/package.json` (`"main": "index.ts"`)
- Modify: `apps/mobile/test/setup.ts`, `apps/mobile/test/fakes.tsx`
- Test: `.../src/test/java/app/wayfinder/car/bridge/CarBridgeTest.kt`, `apps/mobile/test/car-controller.native.test.tsx`, `apps/mobile/test/car-handlers.native.test.tsx`

**Interfaces:**
- Consumes: Task 4's schemas and Kotlin models.
- Produces (Kotlin):
  ```kotlin
  class CarBridge(post: (Runnable) -> Unit, postDelayed: (Runnable, Long) -> Unit, timeoutMs: Long = 30_000) {
    fun connect(emit: (id: String, method: String, params: String) -> Unit); fun disconnect()
    fun call(method: String, params: JSONObject, done: (Result<JSONObject>) -> Unit)
    fun resolve(id: String, json: String); fun reject(id: String, message: String)
    fun setNavigation(json: String?); val navigation: JSONObject?; fun onNavigation(l: (JSONObject?) -> Unit): () -> Unit
    companion object { val shared: CarBridge }
  }
  class CarBridgeError(message: String) : Exception(message); class CarBridgeTimeout : Exception(...)
  interface CarApi { status; search; discover; plan; planned; routeLine; start; stop(); setMuted(); val navigation: CarNav?; onNavigation }  // exact signatures in Step 3
  class BridgeCarApi(bridge: CarBridge) : CarApi
  object ReactBoot { fun ensureStarted(context: Context) }
  ```
- Produces (TS): `native: CarNative | null` from `modules/wayfinder-car`; `type CarHandlers = Record<string, (params: unknown) => Promise<unknown>>`; `startCarController(handlers: CarHandlers, n?: CarNative | null): () => void`; `carHandlers: CarHandlers` (with `status`); `resetCarHandlers(): void` (tests); in `fakes.tsx`: `fakeCarNative()`, and `fake.api.signedIn`, `fake.api.savedSession`.

- [ ] **Step 1: Failing Kotlin test**

`CarBridgeTest.kt`:

```kotlin
package app.wayfinder.car.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarBridgeTest {
  private val later = mutableListOf<Runnable>()
  private val bridge = CarBridge(post = { it.run() }, postDelayed = { r, _ -> later += r })
  private val sent = mutableListOf<String>()

  @Test fun holdsRequestsUntilJavaScriptIsListening() {
    var answer: Result<JSONObject>? = null
    bridge.call("status", JSONObject()) { answer = it }
    bridge.connect { id, method, params -> sent += "$id $method $params" }
    assertEquals(listOf("c0 status {}"), sent)
    bridge.resolve("c0", """{"account":"signedIn"}""")
    assertEquals("signedIn", answer!!.getOrThrow().getString("account"))
  }

  @Test fun passesOnWhatJavaScriptCouldNotDo() {
    bridge.connect { _, _, _ -> }
    var answer: Result<JSONObject>? = null
    bridge.call("search", JSONObject().put("q", "coot")) { answer = it }
    bridge.reject("c0", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", answer!!.exceptionOrNull()!!.message)
  }

  @Test fun givesUpWhenNoAnswerComesAndIgnoresALateOne() {
    var answers = 0
    var last: Result<JSONObject>? = null
    bridge.call("status", JSONObject()) { answers++; last = it }
    later.single().run()
    bridge.connect { id, _, _ -> sent += id }
    bridge.resolve("c0", "{}")
    assertEquals(1, answers)
    assertTrue(last!!.exceptionOrNull() is CarBridgeTimeout)
    assertTrue("a timed-out request isn't sent later", sent.isEmpty())
  }

  @Test fun tellsScreensAboutNavigation() {
    val seen = mutableListOf<String?>()
    val off = bridge.onNavigation { seen += it?.getString("routeId") }
    bridge.setNavigation("""{"routeId":"r1"}""")
    bridge.setNavigation(null)
    off()
    bridge.setNavigation("""{"routeId":"r2"}""")
    assertEquals(listOf("r1", null), seen)
    assertEquals("r2", bridge.navigation!!.getString("routeId"))
  }

  @Test fun treatsUnreadableNavigationAsNone() {
    bridge.setNavigation("not json")
    assertNull(bridge.navigation)
  }
}
```

- [ ] **Step 2: Kotlin bridge**

`CarBridge.kt`:

```kotlin
package app.wayfinder.car.bridge

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

class CarBridgeError(message: String) : Exception(message)
class CarBridgeTimeout : Exception("Wayfinder on your phone isn’t answering. Open it on your phone, then try again.")

/**
 * The car screens' line to the JavaScript side, which has the account, the server and navigation.
 * Requests made before JavaScript is listening wait for it; each gives up after [timeoutMs].
 * Answers and navigation updates are delivered through [post] (the main thread).
 */
class CarBridge(
  private val post: (Runnable) -> Unit,
  private val postDelayed: (Runnable, Long) -> Unit,
  private val timeoutMs: Long = 30_000,
) {
  private var emit: ((String, String, String) -> Unit)? = null
  private val waiting = ArrayDeque<Triple<String, String, String>>()
  private val pending = HashMap<String, (Result<JSONObject>) -> Unit>()
  private val navListeners = LinkedHashSet<(JSONObject?) -> Unit>()
  private var next = 0

  var navigation: JSONObject? = null
    private set

  @Synchronized
  fun connect(emit: (id: String, method: String, params: String) -> Unit) {
    this.emit = emit
    while (waiting.isNotEmpty()) waiting.removeFirst().let { (id, method, params) -> emit(id, method, params) }
  }

  @Synchronized
  fun disconnect() {
    emit = null
  }

  fun call(method: String, params: JSONObject, done: (Result<JSONObject>) -> Unit) {
    val id: String
    synchronized(this) {
      id = "c${next++}"
      pending[id] = done
      val e = emit
      if (e != null) e(id, method, params.toString()) else waiting.addLast(Triple(id, method, params.toString()))
    }
    postDelayed({ finish(id, Result.failure(CarBridgeTimeout())) }, timeoutMs)
  }

  fun resolve(id: String, json: String) = finish(id, runCatching { JSONObject(json) })

  fun reject(id: String, message: String) = finish(id, Result.failure(CarBridgeError(message)))

  private fun finish(id: String, result: Result<JSONObject>) {
    val done = synchronized(this) {
      waiting.removeAll { it.first == id }
      pending.remove(id)
    } ?: return
    post { done(result) }
  }

  fun setNavigation(json: String?) {
    val parsed = json?.let { runCatching { JSONObject(it) }.getOrNull() }
    post {
      navigation = parsed
      navListeners.toList().forEach { it(parsed) }
    }
  }

  fun onNavigation(listener: (JSONObject?) -> Unit): () -> Unit {
    navListeners += listener
    return { navListeners -= listener }
  }

  companion object {
    /** The one bridge the Expo module and every car session share. */
    val shared: CarBridge by lazy {
      val main = Handler(Looper.getMainLooper())
      CarBridge({ main.post(it) }, { r, ms -> main.postDelayed(r, ms) })
    }
  }
}
```

`CarApi.kt`:

```kotlin
package app.wayfinder.car.bridge

/** Everything the car screens need from the rest of the app. */
interface CarApi {
  fun status(done: (Result<CarStatus>) -> Unit)
  fun search(query: String, done: (Result<List<CarPlace>>) -> Unit)
  fun discover(done: (Result<List<CarPlace>>) -> Unit)
  fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit)
  fun planned(done: (Result<List<PlannedItem>>) -> Unit)
  fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit)
  fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit)
  fun stop()
  fun setMuted(muted: Boolean)
  val navigation: CarNav?
  fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit
}
```

`BridgeCarApi.kt`:

```kotlin
package app.wayfinder.car.bridge

import org.json.JSONArray
import org.json.JSONObject

class BridgeCarApi(private val bridge: CarBridge) : CarApi {
  override fun status(done: (Result<CarStatus>) -> Unit) = ask("status", JSONObject(), Protocol::status, done)
  override fun search(query: String, done: (Result<List<CarPlace>>) -> Unit) = ask("search", JSONObject().put("q", query), Protocol::places, done)
  override fun discover(done: (Result<List<CarPlace>>) -> Unit) = ask("discover", JSONObject(), Protocol::places, done)
  override fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit) =
    ask("plan", JSONObject().put("to", JSONArray().put(to.location.lon).put(to.location.lat)), Protocol::plan, done)
  override fun planned(done: (Result<List<PlannedItem>>) -> Unit) = ask("planned", JSONObject(), Protocol::planned, done)
  override fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit) =
    ask("routeLine", JSONObject().put("routeId", routeId), { Protocol.line(it.getJSONArray("geometry")) }, done)
  override fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit) =
    ask("start", JSONObject().put("routeId", routeId).put("destinationName", destinationName), { }, done)
  override fun stop() = bridge.call("stop", JSONObject()) { }
  override fun setMuted(muted: Boolean) = bridge.call("mute", JSONObject().put("muted", muted)) { }
  override val navigation: CarNav? get() = bridge.navigation?.let(::readNav)
  override fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit = bridge.onNavigation { json -> listener(json?.let(::readNav)) }

  private fun readNav(json: JSONObject): CarNav? = runCatching { Protocol.nav(json) }.getOrNull()

  private fun <T> ask(method: String, params: JSONObject, read: (JSONObject) -> T, done: (Result<T>) -> Unit) =
    bridge.call(method, params) { r -> done(r.mapCatching(read)) }
}
```

`ReactBoot.kt`:

```kotlin
package app.wayfinder.car.bridge

import android.content.Context
import com.facebook.react.ReactApplication

object ReactBoot {
  /**
   * The car can open Wayfinder while the phone app is closed. Starting React loads the app's
   * JavaScript (apps/mobile/index.ts), which starts answering the car without any phone screen.
   */
  fun ensureStarted(context: Context) {
    (context.applicationContext as? ReactApplication)?.reactHost?.start()
  }
}
```

`WayfinderCarModule.kt`:

```kotlin
package app.wayfinder.car

import app.wayfinder.car.bridge.CarBridge
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side's handle on the car app. */
class WayfinderCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WayfinderCar")
    Events("onCall")

    // JavaScript calls this once it is listening; anything the car asked meanwhile goes out now.
    Function("ready") {
      CarBridge.shared.connect { id, method, params ->
        sendEvent("onCall", mapOf("id" to id, "method" to method, "params" to params))
      }
    }
    Function("resolve") { id: String, json: String -> CarBridge.shared.resolve(id, json) }
    Function("reject") { id: String, message: String -> CarBridge.shared.reject(id, message) }
    Function("setNavigation") { json: String? -> CarBridge.shared.setNavigation(json) }

    OnDestroy { CarBridge.shared.disconnect() }
  }
}
```

In `WayfinderSession.onCreateScreen`, call `ReactBoot.ensureStarted(carContext)` before returning the screen.

Run `pnpm test:android` → `CarBridgeTest` PASS.

- [ ] **Step 3: JS binding, test setup and fakes**

`apps/mobile/modules/wayfinder-car/index.ts`:

```ts
import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface CarCall {
  id: string;
  method: string;
  /** JSON */
  params: string;
}

type Events = { onCall: (call: CarCall) => void };

declare class WayfinderCarModule extends NativeModule<Events> {
  ready(): void;
  resolve(id: string, json: string): void;
  reject(id: string, message: string): void;
  setNavigation(json: string | null): void;
}

export type CarNative = Pick<WayfinderCarModule, 'ready' | 'resolve' | 'reject' | 'setNavigation' | 'addListener'>;

/** The car app's native side, or null where it isn't built in (Expo Go, Jest). */
export const native: CarNative | null = requireOptionalNativeModule<WayfinderCarModule>('WayfinderCar');
```

`apps/mobile/test/setup.ts`: append

```ts
// No car app in tests unless a test brings its own fake (fakeCarNative in fakes.tsx).
jest.mock('../modules/wayfinder-car', () => ({ native: null }));
```

`apps/mobile/test/fakes.tsx`:
1. In `fake.api` add `signedIn: true, savedSession: true,`.
2. In `resetFakes()` add `fake.api.signedIn = true; fake.api.savedSession = true;`.
3. Replace `apiModule` with:
   ```ts
   export const apiModule = {
     api: {
       request: (path: string, init?: Init) => request(path, init),
       refresh: jest.fn(async () => (fake.api.signedIn ? { accessToken: 'a', user: fake.user } : null)),
       get hasAccessToken() {
         return fake.api.signedIn;
       },
     },
     hasSavedSession: jest.fn(async () => fake.api.savedSession),
     errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
   };
   ```
4. Append:
   ```ts
   /** A stand-in for the car app's native side: records what JavaScript tells it, and plays the car. */
   export function fakeCarNative() {
     const listeners = new Set<(call: { id: string; method: string; params: string }) => void>();
     let n = 0;
     return {
       ready: jest.fn(),
       resolve: jest.fn(),
       reject: jest.fn(),
       setNavigation: jest.fn(),
       addListener: jest.fn((_event: 'onCall', fn: (call: { id: string; method: string; params: string }) => void) => {
         listeners.add(fn);
         return { remove: () => listeners.delete(fn) };
       }),
       /** The car asks something; returns the request id. */
       ask(method: string, params: object = {}) {
         const id = `c${n++}`;
         listeners.forEach((l) => l({ id, method, params: JSON.stringify(params) }));
         return id;
       },
       /** What JavaScript answered to request `id`, parsed. */
       answerTo(id: string): unknown {
         const call = this.resolve.mock.calls.find((c: unknown[]) => c[0] === id);
         return call ? JSON.parse(call[1] as string) : undefined;
       },
     };
   }
   ```

- [ ] **Step 4: Failing JS tests**

`apps/mobile/test/car-controller.native.test.tsx`:

```tsx
/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import { startCarController } from '../src/car/controller';
import { fakeCarNative } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);

it('tells the car it is listening, then answers', async () => {
  const car = fakeCarNative();
  const stop = startCarController({ echo: async (p) => p }, car as never);
  expect(car.ready).toHaveBeenCalled();
  const id = car.ask('echo', { a: 1 });
  await waitFor(() => expect(car.answerTo(id)).toEqual({ a: 1 }));
  stop();
  car.ask('echo');
  expect(car.resolve).toHaveBeenCalledTimes(1);
});

it('turns a failure into words the car can show', async () => {
  const car = fakeCarNative();
  startCarController({ search: async () => { throw new Error('Can’t reach your server.'); } }, car as never);
  const id = car.ask('search', { q: 'x' });
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, 'Can’t reach your server.'));
});

it('says so when the car asks for something this build doesn’t do', async () => {
  const car = fakeCarNative();
  startCarController({}, car as never);
  const id = car.ask('teleport');
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, expect.stringMatching(/update Wayfinder/)));
});

it('does nothing where there is no car app (Expo Go, tests)', () => {
  expect(startCarController({ echo: async () => 1 }, null)()).toBeUndefined();
});
```

`apps/mobile/test/car-handlers.native.test.tsx`:

```tsx
/// <reference types="jest" />
import * as Location from 'expo-location';
import { carHandlers, resetCarHandlers } from '../src/car/handlers';
import { fake, resetFakes } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.test' }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.02, latitude: -27.47 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.03, latitude: -27.48 } })),
}));
const mockNavigation = { start: jest.fn(), stop: jest.fn(), setMuted: jest.fn(), getSnapshot: jest.fn(() => ({ route: null })) };
jest.mock('../src/nav/navigationService', () => ({ navigation: mockNavigation }));

beforeEach(() => {
  resetFakes();
  resetCarHandlers();
  fake.api.on({ 'GET api/config': () => ({ ...fake.config, voice: 'plain' }) });
});

describe('status', () => {
  it('is signed in, with the server’s map styles and where the phone is', async () => {
    expect(await carHandlers.status!({})).toEqual({
      account: 'signedIn',
      styleUrl: { light: 'https://maps.example.test/map/style.json?theme=light', dark: 'https://maps.example.test/map/style.json?theme=dark' },
      searchHint: 'Search places and addresses',
      here: [153.02, -27.47],
    });
  });

  it('is offline when a sign-in is saved but the server can’t be reached', async () => {
    fake.api.signedIn = false;
    expect(await carHandlers.status!({})).toMatchObject({ account: 'offline' });
  });

  it('is signed out when nobody has signed in on this phone', async () => {
    fake.api.signedIn = false;
    fake.api.savedSession = false;
    expect(await carHandlers.status!({})).toMatchObject({ account: 'signedOut' });
  });

  it('has no position without location permission, and plain words when the server is unreachable', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    fake.api.on({ 'GET api/config': () => { throw new Error('offline'); } });
    expect(await carHandlers.status!({})).toMatchObject({ here: null, searchHint: 'Search places and addresses' });
  });
});
```

Run: `cd apps/mobile && npx jest test/car-controller.native.test.tsx test/car-handlers.native.test.tsx`, Expected: FAIL (modules missing).

- [ ] **Step 5: Controller, status handler, entry**

`apps/mobile/src/car/controller.ts`:

```ts
import { type CarCall, type CarNative, native } from '../../modules/wayfinder-car';
import { errorMessage } from '../lib/api';

export type CarHandlers = Record<string, (params: unknown) => Promise<unknown>>;

/**
 * Answers the car screens' requests. Started from the app entry, so it runs even when Android
 * Auto opened Wayfinder with no phone screen showing. Returns a function that stops it.
 */
export function startCarController(handlers: CarHandlers, n: CarNative | null = native): () => void {
  if (!n) return () => undefined;
  const sub = n.addListener('onCall', (call) => void answer(n, handlers, call));
  n.ready();
  return () => sub.remove();
}

async function answer(n: CarNative, handlers: CarHandlers, call: CarCall) {
  const handler = handlers[call.method];
  if (!handler) {
    n.reject(call.id, 'The car asked for something this version can’t do. Update Wayfinder on your phone.');
    return;
  }
  try {
    n.resolve(call.id, JSON.stringify(await handler(JSON.parse(call.params))));
  } catch (e) {
    n.reject(call.id, errorMessage(e));
  }
}
```

`apps/mobile/src/car/handlers.ts`:

```ts
import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import type { LngLat } from '@wayfinder/shared/geo';
import { PublicConfigSchema } from '@wayfinder/shared/schemas';
import * as Location from 'expo-location';
import { api, hasSavedSession } from '../lib/api';
import { isServerUrl } from '../lib/apiClient';
import { getServerUrl } from '../lib/server';
import type { CarHandlers } from './controller';
import type { CarStatus } from './protocol';

let copyCache: CopyCatalog | null = null;

/** The server's chosen voice for words shown in the car; plain until the server says. */
async function copy(): Promise<CopyCatalog> {
  if (copyCache) return copyCache;
  try {
    copyCache = copyFor((await api.request('api/config', { schema: PublicConfigSchema })).voice);
    return copyCache;
  } catch {
    return copyFor('plain');
  }
}

/** Where the phone is, or null without permission or any fix. Never prompts: the car can't. */
async function here(fresh = false): Promise<LngLat | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: fresh ? 60_000 : 10 * 60_000 });
    const loc = last ?? (fresh ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }) : null);
    return loc ? [loc.coords.longitude, loc.coords.latitude] : null;
  } catch {
    return null;
  }
}

/** Forget cached words between tests. */
export function resetCarHandlers() {
  copyCache = null;
}

export const carHandlers: CarHandlers = {
  async status(): Promise<CarStatus> {
    const signedIn = api.hasAccessToken || !!(await api.refresh());
    const account = signedIn ? 'signedIn' : (await hasSavedSession()) ? 'offline' : 'signedOut';
    const base = await getServerUrl();
    return {
      account,
      styleUrl: isServerUrl(base) ? { light: `${base}/map/style.json?theme=light`, dark: `${base}/map/style.json?theme=dark` } : null,
      searchHint: (await copy()).searchPlaceholder,
      here: await here(),
    };
  },
};
```

`apps/mobile/index.ts`:

```ts
// The app's entry. Android Auto can start Wayfinder with no phone screen open, so the part that
// answers the car starts here rather than in a screen.
import { startCarController } from './src/car/controller';
import { carHandlers } from './src/car/handlers';
import './src/tracking/background';
import 'expo-router/entry';

startCarController(carHandlers);
```

`apps/mobile/package.json`: `"main": "index.ts"`.

- [ ] **Step 6: Run everything**

Run: `cd apps/mobile && npx jest` (all pass, including the untouched screen tests), `pnpm --filter @wayfinder/mobile exec expo export --platform android --output-dir dist-check` (the bundle builds from the new entry), `pnpm test:android`, then `pnpm check`.

- [ ] **Step 7: Manual check in the head unit**

Temporarily change `WayfinderSession.onCreateScreen` to call `BridgeCarApi(CarBridge.shared).status { … }` and show the result's account in a `MessageScreen`; don't commit this. Force-stop Wayfinder on the phone, then open it in the DHU. Expected: "SIGNED_IN" (or your real state) within a few seconds, which proves Kotlin started React headless. Revert the temporary change.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/index.ts apps/mobile/package.json apps/mobile/modules apps/mobile/src/car apps/mobile/test
git commit -m "Connect the car screens to the app, even with the phone app closed

Car screens are Kotlin but the account, server and navigation live in JavaScript. A small
request/answer bridge now carries the car's questions across; requests made before JavaScript is
up wait for it, and Kotlin starts React when Android Auto opens Wayfinder cold. The app gets its
own entry file so the car side starts without any phone screen. First request: account status."
```

---

### Task 6: What the car can ask for

Search, Discover, planning (fastest plus ways you haven't been), planned routes, route lines, and start/stop/mute. Moving Discover's category labels into a shared file also fixes "Beache" on the phone: `'Beaches'.replace(/s$/, '')`.

**Files:**
- Create: `apps/mobile/src/lib/categories.ts`
- Modify: `apps/mobile/app/(tabs)/discover.tsx` (use it; delete its `LABEL` and `kindOf`)
- Modify: `apps/mobile/src/car/handlers.ts`
- Test: `apps/mobile/test/categories.test.ts` (Vitest), more cases in `apps/mobile/test/car-handlers.native.test.tsx`
- Modify: `vitest.config.ts`, `apps/mobile/jest.config.js` (categories measured by Vitest)

**Interfaces:**
- Consumes: `navigation.start/stop/setMuted/getSnapshot` (Task 1), `CarParams` (Task 4).
- Produces: `CATEGORY_LABEL: Record<PoiCategory, string>`, `kindOf(category: string): string`; handlers `search`, `discover`, `plan`, `planned`, `routeLine`, `start`, `stop`, `mute`; `MAX_ROWS = 6`.

- [ ] **Step 1: Failing tests**

`apps/mobile/test/categories.test.ts`:

```ts
import { POI_CATEGORIES } from '@wayfinder/shared/schemas';
import { expect, it } from 'vitest';
import { CATEGORY_LABEL, kindOf } from '../src/lib/categories';

it('names one of each kind properly', () => {
  expect(kindOf('beach')).toBe('Beach');
  expect(kindOf('viewpoint')).toBe('Lookout');
  expect(kindOf('cafe')).toBe('Café');
  expect(kindOf('picnic')).toBe('Picnic spot');
  expect(kindOf('historic')).toBe('Historic site');
});

it('has a name for every category, and copes with one from a newer server', () => {
  for (const c of POI_CATEGORIES) expect(CATEGORY_LABEL[c]).toBeTruthy();
  expect(kindOf('spaceport')).toBe('Place');
});
```

Append to `car-handlers.native.test.tsx`:

```tsx
import { place, route } from './fakes';

describe('search', () => {
  it('searches near the phone and gives one line per place', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place({ id: 'p1', name: 'Mt Coot-tha Lookout', context: 'Mount Coot-tha QLD', distanceM: 6200 })] }) });
    const res = await carHandlers.search!({ q: 'coot' });
    expect(fake.api.callsTo('GET api/search')[0]!.query).toMatchObject({ q: 'coot', lon: 153.02, lat: -27.47, limit: 6 });
    expect(res).toEqual({ places: [{ id: 'p1', name: 'Mt Coot-tha Lookout', detail: 'Mount Coot-tha QLD · 6.2 km away', location: expect.any(Array), distanceM: 6200 }] });
  });

  it('refuses an empty search', async () => {
    await expect(carHandlers.search!({ q: '  ' })).rejects.toThrow();
  });
});

describe('discover', () => {
  it('finds places a drive away, saying how unexplored the area is', async () => {
    fake.api.on({ 'GET api/discover': () => ({ items: [{ id: 'd1', name: 'Mt Coot-tha Lookout', category: 'viewpoint', location: [152.957, -27.4846], distanceM: 6200, areaUnexploredPct: 62, score: 1 }] }) });
    const res = (await carHandlers.discover!({})) as { places: Array<{ detail: string }> };
    expect(fake.api.callsTo('GET api/discover')[0]!.query).toMatchObject({ mode: 'car', maxMinutes: 30, limit: 6 });
    expect(res.places[0]!.detail).toBe('Lookout · 6.2 km away · 62% unexplored area');
  });

  it('explains when it can’t tell where you are', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(carHandlers.discover!({})).rejects.toThrow(/Can’t tell where you are/);
  });
});

describe('plan and start', () => {
  const fastest = route({ id: 'r-fast', kind: 'fastest', durationS: 1500, extraDurationS: 0, novelty: { totalKm: 18, newKm: 1.2, noveltyPct: 7 } });
  const explore = route({ id: 'r-exp', kind: 'explore', durationS: 1920, extraDurationS: 420, novelty: { totalKm: 22, newKm: 9.4, noveltyPct: 43 } });

  it('offers the fastest route and ways you haven’t been, by car from where you are', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest, explore: [explore] }) });
    const res = (await carHandlers.plan!({ to: [152.957, -27.4846] })) as { options: Array<{ routeId: string; title: string; detail: string }>; note: string | null };
    expect(fake.api.callsTo('POST api/routes/explore')[0]!.body).toEqual({ from: [153.03, -27.48], to: [152.957, -27.4846], mode: 'car' });
    expect(res.options.map((o) => [o.routeId, o.title])).toEqual([['r-fast', 'Fastest'], ['r-exp', 'Explore 1']]);
    expect(res.options[1]!.detail).toMatch(/^32 min \(7 min longer\) · /);
    expect(res.note).toBeNull();
  });

  it('says why there are no other ways', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest: { ...fastest, novelty: { totalKm: 18, newKm: 17, noveltyPct: 95 } }, explore: [] }) });
    const res = (await carHandlers.plan!({ to: [152.957, -27.4846] })) as { note: string };
    expect(res.note).toMatch(/already explores somewhere new/);
  });

  it('starts navigating a route it offered, named for the car', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest, explore: [explore] }) });
    await carHandlers.plan!({ to: [152.957, -27.4846] });
    await carHandlers.start!({ routeId: 'r-exp', destinationName: 'Mt Coot-tha Lookout' });
    expect(mockNavigation.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-exp' }), { destinationName: 'Mt Coot-tha Lookout' });
  });

  it('won’t start a route it doesn’t have', async () => {
    await expect(carHandlers.start!({ routeId: 'nope', destinationName: 'x' })).rejects.toThrow(/Plan it again/);
  });
});

describe('planned routes', () => {
  it('lists driving routes sent from the web, ready to start', async () => {
    fake.api.on({
      'GET api/planned-routes': () => ({
        items: [
          { id: 'pl1', name: 'Sunday drive', createdAt: '2026-09-01T00:00:00Z', route: route({ id: 'r-sun', mode: 'car' }) },
          { id: 'pl2', name: 'Bushwalk', createdAt: '2026-09-01T00:00:00Z', route: route({ id: 'r-walk', mode: 'foot' }) },
        ],
      }),
    });
    const res = (await carHandlers.planned!({})) as { items: Array<{ name: string; option: { routeId: string } }> };
    expect(res.items.map((i) => [i.name, i.option.routeId])).toEqual([['Sunday drive', 'r-sun']]);
    await carHandlers.start!({ routeId: 'r-sun', destinationName: 'Sunday drive' });
    expect(mockNavigation.start).toHaveBeenCalled();
  });
});

describe('during a trip', () => {
  it('gives the line of the route being followed, even after a reroute', async () => {
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: route({ id: 'r-new', geometry: [[1, 2], [3, 4]] }) } as never);
    expect(await carHandlers.routeLine!({ routeId: 'r-new' })).toEqual({ geometry: [[1, 2], [3, 4]] });
  });

  it('ends and mutes', async () => {
    await carHandlers.stop!({});
    await carHandlers.mute!({ muted: true });
    expect(mockNavigation.stop).toHaveBeenCalled();
    expect(mockNavigation.setMuted).toHaveBeenCalledWith(true);
  });
});
```

Run both files; expected FAIL.

- [ ] **Step 2: `categories.ts` and Discover**

`apps/mobile/src/lib/categories.ts`:

```ts
import type { PoiCategory } from '@wayfinder/shared/schemas';

/** Discover's category chips. */
export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  viewpoint: 'Lookouts', peak: 'Peaks', waterfall: 'Waterfalls', park: 'Parks', beach: 'Beaches', attraction: 'Attractions',
  cafe: 'Cafés', historic: 'Historic', trailhead: 'Trailheads', museum: 'Museums', picnic: 'Picnic spots',
};

const ONE: Record<PoiCategory, string> = {
  viewpoint: 'Lookout', peak: 'Peak', waterfall: 'Waterfall', park: 'Park', beach: 'Beach', attraction: 'Attraction',
  cafe: 'Café', historic: 'Historic site', trailhead: 'Trailhead', museum: 'Museum', picnic: 'Picnic spot',
};

/** One of a kind, e.g. "Lookout". A newer server may send a category this build doesn't know. */
export const kindOf = (c: string) => ONE[c as PoiCategory] ?? 'Place';
```

In `discover.tsx`, delete `LABEL` and `kindOf`, import `{ CATEGORY_LABEL, kindOf } from '../../src/lib/categories'`, and replace `LABEL[c]` with `CATEGORY_LABEL[c]`. Then run `npx jest test/screens.screen.test.tsx`: any Discover test that asserted "Beache" was asserting the bug. Correct it and say so in the commit.

`vitest.config.ts` coverage include: add `'apps/mobile/src/lib/categories.ts'`. `jest.config.js`: add `'!src/lib/categories.ts'`.

- [ ] **Step 3: The handlers**

In `handlers.ts` add imports:

```ts
import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { DiscoverResponseSchema, ExploreRouteResponseSchema, type Place, PlannedRouteListSchema, type Route, SearchResponseSchema } from '@wayfinder/shared/schemas';
import { kindOf } from '../lib/categories';
import { navigation } from '../nav/navigationService';
import { type CarPlace, type CarRouteOption, CarParams } from './protocol';
```

Add below `here()`:

```ts
/** Android Auto shows about six rows while driving; never send more. */
export const MAX_ROWS = 6;
const NO_LOCATION = 'Can’t tell where you are. Check that location is on for Wayfinder on your phone.';

/** Routes the car has been offered, so "Go" can start one by id. The newest 30 are kept. */
const offered = new Map<string, Route>();
function remember(r: Route) {
  offered.delete(r.id);
  offered.set(r.id, r);
  while (offered.size > 30) offered.delete(offered.keys().next().value!);
}

const toPlace = (p: Place): CarPlace => ({
  id: p.id,
  name: p.name,
  detail: [p.context ?? p.typeLabel ?? p.description, p.distanceM != null ? `${formatDistanceShort(p.distanceM)} away` : null].filter(Boolean).join(' · '),
  location: p.location,
  distanceM: p.distanceM ?? null,
});

function toOption(r: Route, title: string, c: CopyCatalog): CarRouteOption {
  remember(r);
  const time = r.extraDurationS >= 60 ? `${formatDuration(r.durationS)} (${formatDuration(r.extraDurationS)} longer)` : formatDuration(r.durationS);
  const what = r.novelty.newKm >= 0.1 ? c.newKm(r.novelty.newKm) : formatDistanceShort(r.distanceM);
  return { routeId: r.id, title, detail: `${time} · ${what}`, durationS: r.durationS, distanceM: r.distanceM, extraDurationS: r.extraDurationS, geometry: r.geometry };
}
```

Change `resetCarHandlers` to also `offered.clear();`. Add these entries to `carHandlers`:

```ts
  async search(params) {
    const { q } = CarParams.search.parse(params);
    const near = await here();
    const res = await api.request('api/search', { query: { q, lon: near?.[0], lat: near?.[1], limit: MAX_ROWS }, schema: SearchResponseSchema });
    return { places: res.results.slice(0, MAX_ROWS).map(toPlace) };
  },

  async discover() {
    const from = await here(true);
    if (!from) throw new Error(NO_LOCATION);
    const res = await api.request('api/discover', { query: { lon: from[0], lat: from[1], mode: 'car', maxMinutes: 30, limit: MAX_ROWS }, schema: DiscoverResponseSchema });
    return {
      places: res.items.slice(0, MAX_ROWS).map<CarPlace>((i) => ({
        id: i.id,
        name: i.name,
        detail: [kindOf(i.category), `${formatDistanceShort(i.distanceM)} away`, i.areaUnexploredPct >= 50 ? `${i.areaUnexploredPct}% unexplored area` : null].filter(Boolean).join(' · '),
        location: i.location,
        distanceM: i.distanceM,
      })),
    };
  },

  async plan(params) {
    const { to } = CarParams.plan.parse(params);
    const from = await here(true);
    if (!from) throw new Error(NO_LOCATION);
    // The extra time allowed for ways you haven't been is the person's own setting (server default).
    const [res, c] = await Promise.all([api.request('api/routes/explore', { method: 'POST', body: { from, to, mode: 'car' }, schema: ExploreRouteResponseSchema }), copy()]);
    const options = [toOption(res.fastest, 'Fastest', c), ...res.explore.map((r, i) => toOption(r, `Explore ${i + 1}`, c))].slice(0, MAX_ROWS);
    const note = res.explore.length ? null : res.fastest.novelty.noveltyPct >= 90 ? c.allNewAlready : 'No other ways fit within your extra time.';
    return { options, note };
  },

  async planned() {
    const [res, c] = await Promise.all([api.request('api/planned-routes', { schema: PlannedRouteListSchema }), copy()]);
    // Walking routes sent from the web stay on the phone.
    return { items: res.items.filter((p) => p.route.mode === 'car').slice(0, MAX_ROWS).map((p) => ({ id: p.id, name: p.name, option: toOption(p.route, p.name, c) })) };
  },

  async routeLine(params) {
    const { routeId } = CarParams.routeLine.parse(params);
    const current = navigation.getSnapshot().route;
    const r = offered.get(routeId) ?? (current?.id === routeId ? current : null);
    if (!r) throw new Error('That route is no longer available.');
    return { geometry: r.geometry };
  },

  async start(params) {
    const { routeId, destinationName } = CarParams.start.parse(params);
    const r = offered.get(routeId);
    if (!r) throw new Error('That route has expired. Plan it again.');
    navigation.start(r, { destinationName });
    return {};
  },

  async stop() {
    navigation.stop();
    return {};
  },

  async mute(params) {
    navigation.setMuted(CarParams.mute.parse(params).muted);
    return {};
  },
```

`routeLine` checks the current navigation route because a reroute replaces the route with one the car was never offered. The `'offered'` map covers routes still on screen in the preview.

- [ ] **Step 4: Run, gate, commit**

Run: `npx vitest run apps/mobile/test/categories.test.ts`, `cd apps/mobile && npx jest`, `pnpm check`.

```bash
git add apps/mobile/src apps/mobile/app apps/mobile/test vitest.config.ts apps/mobile/jest.config.js
git commit -m "Answer the car's searches, plans and trip controls

The car can now search, discover places in unexplored areas, compare the fastest route with ways
you haven't been, pick a planned route, and start, mute or end a trip, all through the app's own
server calls. Moving Discover's category names into one file also fixes 'Beache' on the phone,
which came from trimming an s off 'Beaches'."
```

---

### Task 7: Feed navigation to the car

Turns the navigation snapshot into the car's view of it and pushes it on every change.

**Files:**
- Create: `apps/mobile/src/car/navModel.ts`
- Modify: `apps/mobile/src/car/controller.ts` (add `startCarNavigationFeed`), `apps/mobile/index.ts`
- Test: `apps/mobile/test/carNavModel.test.ts` (Vitest), more cases in `car-controller.native.test.tsx`
- Modify: `vitest.config.ts`, `jest.config.js` (navModel measured by Vitest)

**Interfaces:**
- Consumes: `NavSnapshot`, `navigation.subscribe/getSnapshot` (Task 1); `CarNav`, `CarManeuver`, `ManeuverType` (Task 4).
- Produces: `maneuverOf(ins: Pick<Instruction, 'sign' | 'exitNumber'>): CarManeuver`, `toCarNav(s: NavSnapshot, now: number): CarNav | null`, `THEN_WITHIN_M = 150`, `startCarNavigationFeed(n?: CarNative | null, nav?: Pick<NavigationService, 'subscribe' | 'getSnapshot'>, now?: () => number): () => void`.

- [ ] **Step 1: Failing tests**

`apps/mobile/test/carNavModel.test.ts`:

```ts
import type { Instruction, Route } from '@wayfinder/shared/schemas';
import { describe, expect, it } from 'vitest';
import { CarNavSchema } from '../src/car/protocol';
import { maneuverOf, THEN_WITHIN_M, toCarNav } from '../src/car/navModel';
import type { NavSnapshot } from '../src/nav/navigationService';

const ins = (sign: number, text: string, distanceM: number, extra: Partial<Instruction> = {}): Instruction => ({ sign, text, streetName: '', distanceM, durationS: 10, interval: [0, 1], ...extra });
const route = (instructions: Instruction[]): Route => ({
  id: 'r1', kind: 'fastest', mode: 'car', distanceM: 5000, durationS: 600, extraDurationS: 0,
  geometry: [[153, -27.4], [153.1, -27.5]], instructions, viaPoints: [], novelty: { totalKm: 5, newKm: 1, noveltyPct: 20 },
});
const snap = (over: Partial<NavSnapshot>): NavSnapshot => ({ active: true, route: null, destinationName: 'Lookout', state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null, ...over });

describe('maneuverOf', () => {
  it.each([
    [-3, 'sharpLeft'], [-2, 'left'], [-1, 'slightLeft'], [0, 'straight'], [1, 'slightRight'], [2, 'right'], [3, 'sharpRight'],
    [4, 'destination'], [5, 'waypoint'], [-7, 'keepLeft'], [7, 'keepRight'], [-8, 'uTurnLeft'], [8, 'uTurnRight'], [-6, 'roundaboutExit'],
  ])('GraphHopper sign %i is %s', (sign, type) => expect(maneuverOf({ sign }).type).toBe(type));

  it('turns an unknown U-turn right, as Queensland drives on the left', () => expect(maneuverOf({ sign: -98 }).type).toBe('uTurnRight'));
  it('keeps the exit for a roundabout', () => expect(maneuverOf({ sign: 6, exitNumber: 2 })).toEqual({ type: 'roundabout', exit: 2 }));
  it('treats a sign it doesn’t know as straight on', () => expect(maneuverOf({ sign: 42 })).toEqual({ type: 'straight', exit: null }));
});

describe('toCarNav', () => {
  const instructions = [ins(0, 'Continue', 300), ins(-2, 'Turn left onto Main St', 100, { streetName: 'Main St' }), ins(2, 'Turn right', 800), ins(4, 'Arrive', 0)];
  const r = route(instructions);

  it('is nothing when no trip is running', () => expect(toCarNav(snap({ active: false }), 0)).toBeNull());

  it('is "starting" before the first fix, with the route’s own totals', () => {
    const n = toCarNav(snap({ route: r }), 1_000)!;
    expect(n).toMatchObject({ status: 'starting', maneuver: null, remainingDistanceM: 5000, remainingDurationS: 600, arrivalEpochMs: 601_000 });
    expect(CarNavSchema.safeParse(n).success).toBe(true);
  });

  it('shows the next manoeuvre, and the one after when it comes close behind', () => {
    const n = toCarNav(snap({
      route: r, position: [153, -27.4], headingDeg: 90,
      state: { status: 'navigating', snapped: null, distanceFromRouteM: 0, progressM: 0, remainingDistanceM: 4000, remainingDurationS: 500, currentInstruction: instructions[0]!, nextInstruction: instructions[1]!, nextInstructionIndex: 1, distanceToNextManeuverM: 250, speedLimitKmh: 60 },
    }), 0)!;
    expect(n).toMatchObject({ status: 'navigating', maneuver: { type: 'left', exit: null }, cue: 'Turn left onto Main St', road: 'Main St', distanceToManeuverM: 250, next: { maneuver: { type: 'right', exit: null }, cue: 'Turn right' } });
    expect(instructions[1]!.distanceM).toBeLessThanOrEqual(THEN_WITHIN_M);
    expect(CarNavSchema.safeParse(n).success).toBe(true);
  });

  it('leaves out a manoeuvre that is still far behind the next one', () => {
    const n = toCarNav(snap({
      route: r,
      state: { status: 'navigating', snapped: null, distanceFromRouteM: 0, progressM: 0, remainingDistanceM: 900, remainingDurationS: 90, currentInstruction: instructions[1]!, nextInstruction: instructions[2]!, nextInstructionIndex: 2, distanceToNextManeuverM: 50, speedLimitKmh: null },
    }), 0)!;
    expect(n.next).toBeNull();
  });
});
```

Add to `car-controller.native.test.tsx`:

```tsx
import { startCarNavigationFeed } from '../src/car/controller';

it('keeps the car up to date with navigation, and clears it when the trip ends', () => {
  const car = fakeCarNative();
  let snap: Record<string, unknown> = { active: false, route: null };
  const listeners = new Set<() => void>();
  const nav = { getSnapshot: () => snap as never, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) };
  const stop = startCarNavigationFeed(car as never, nav as never, () => 0);
  expect(car.setNavigation).toHaveBeenLastCalledWith(null);
  snap = { active: true, route: { id: 'r1', distanceM: 1000, durationS: 60, instructions: [] }, destinationName: 'Lookout', state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null };
  listeners.forEach((l) => l());
  expect(JSON.parse(car.setNavigation.mock.calls.at(-1)![0] as string)).toMatchObject({ routeId: 'r1', status: 'starting' });
  stop();
  expect(listeners.size).toBe(0);
});
```

Run; expected FAIL.

- [ ] **Step 2: `navModel.ts`**

```ts
import type { Instruction } from '@wayfinder/shared/schemas';
import type { NavSnapshot } from '../nav/navigationService';
import type { CarManeuver, CarNav, ManeuverType } from './protocol';

/** A manoeuvre this close after the next one is shown with it ("then turn right"). */
export const THEN_WITHIN_M = 150;

/** GraphHopper's instruction signs (see InstructionSchema). */
const BY_SIGN: Record<number, ManeuverType> = {
  [-98]: 'uTurnRight', // direction unknown; Queensland drives on the left, so U-turns go right
  [-8]: 'uTurnLeft',
  [-7]: 'keepLeft',
  [-6]: 'roundaboutExit',
  [-3]: 'sharpLeft',
  [-2]: 'left',
  [-1]: 'slightLeft',
  0: 'straight',
  1: 'slightRight',
  2: 'right',
  3: 'sharpRight',
  4: 'destination',
  5: 'waypoint',
  6: 'roundabout',
  7: 'keepRight',
  8: 'uTurnRight',
};

export function maneuverOf(ins: Pick<Instruction, 'sign' | 'exitNumber'>): CarManeuver {
  const type = BY_SIGN[ins.sign] ?? 'straight';
  return { type, exit: type === 'roundabout' && ins.exitNumber ? ins.exitNumber : null };
}

/** What the car screen shows for a trip, or null when there isn't one. */
export function toCarNav(s: NavSnapshot, now: number): CarNav | null {
  if (!s.active || !s.route) return null;
  const st = s.state;
  const ins = st?.nextInstruction ?? st?.currentInstruction ?? null;
  const idx = st?.nextInstructionIndex ?? null;
  // An instruction's distance runs to the manoeuvre after it.
  const gap = idx != null ? s.route.instructions[idx]?.distanceM : undefined;
  const after = idx != null ? s.route.instructions[idx + 1] : undefined;
  const remainingS = st?.remainingDurationS ?? s.route.durationS;
  return {
    routeId: s.route.id,
    destinationName: s.destinationName,
    status: st?.status ?? 'starting',
    rerouting: s.rerouting,
    muted: s.muted,
    error: s.error,
    maneuver: ins ? maneuverOf(ins) : null,
    cue: ins?.text ?? '',
    road: ins?.streetName ?? '',
    distanceToManeuverM: st?.distanceToNextManeuverM ?? null,
    next: after && gap != null && gap <= THEN_WITHIN_M ? { maneuver: maneuverOf(after), cue: after.text } : null,
    remainingDistanceM: st?.remainingDistanceM ?? s.route.distanceM,
    remainingDurationS: remainingS,
    arrivalEpochMs: Math.round(now + remainingS * 1000),
    position: s.position,
    headingDeg: s.headingDeg,
  };
}
```

- [ ] **Step 3: The feed**

Append to `controller.ts`:

```ts
import { navigation, type NavigationService } from '../nav/navigationService';
import { toCarNav } from './navModel';

/** Sends the car every change to the trip (and null when there is none). */
export function startCarNavigationFeed(
  n: CarNative | null = native,
  nav: Pick<NavigationService, 'subscribe' | 'getSnapshot'> = navigation,
  now: () => number = Date.now,
): () => void {
  if (!n) return () => undefined;
  const push = () => {
    const model = toCarNav(nav.getSnapshot(), now());
    n.setNavigation(model ? JSON.stringify(model) : null);
  };
  push();
  return nav.subscribe(push);
}
```

Put the new imports at the top with the others. `car-controller.native.test.tsx` now imports `navigationService`, so add `jest.mock('../src/nav/navigationService', () => ({ navigation: { subscribe: () => () => undefined, getSnapshot: () => ({ active: false }) } }));` to that file.

`apps/mobile/index.ts`: import `startCarNavigationFeed` as well and call `startCarNavigationFeed();` after `startCarController(carHandlers);`.

`vitest.config.ts` include `'apps/mobile/src/car/navModel.ts'`; `jest.config.js` `'!src/car/navModel.ts'`.

- [ ] **Step 4: Run, gate, commit**

Run: `npx vitest run apps/mobile/test/carNavModel.test.ts`, `cd apps/mobile && npx jest test/car-controller.native.test.tsx`, `pnpm check`.

```bash
git add apps/mobile/src/car apps/mobile/index.ts apps/mobile/test vitest.config.ts apps/mobile/jest.config.js
git commit -m "Send the car what to show during a trip

The car needs the next manoeuvre, the one after it when it comes close, distances, arrival time
and where you are, on every change. Navigation snapshots are now turned into that shape and
pushed to the native side; GraphHopper's signs become the car's manoeuvre kinds."
```

---

### Task 8: The car's home screen

Opening Wayfinder in the car shows **Search**, **Planned routes** and **Discover nearby** over the map. It asks you to sign in on the phone when needed, and says so when the server can't be reached. This task also adds the map-scene model the screens use to tell the map what to draw. The map itself comes in Task 12; until then the session passes a no-op.

**Files:**
- Create: `.../map/MapScene.kt`, `.../screens/HomeScreen.kt`
- Modify: `.../WayfinderSession.kt`
- Create (tests): `.../src/test/java/app/wayfinder/car/FakeCarApi.kt`, `.../Samples.kt`, `.../screens/HomeScreenTest.kt`

**Interfaces:**
- Consumes: `CarApi`, `CarStatus`, `Account`, `MessageScreen`, `ScreenKit` helpers.
- Produces:
  ```kotlin
  sealed interface MapScene { data class Overview(val here: LngLat?); data class Places(val places: List<CarPlace>); data class Routes(val options: List<RouteOption>, val selected: Int); data class Following(val line: List<LngLat>, val position: LngLat?, val headingDeg: Double?) }
  fun interface MapScenes { fun show(scene: MapScene) }
  class HomeScreen(carContext, api: CarApi, map: MapScenes, onStatus: (CarStatus) -> Unit)
  ```
  Test kit: `FakeCarApi` (records `calls`, `answer(method, value)`, `fail(method, message)`, `pushNav(nav)`), `Samples.status(account)`, `Samples.place(...)`, `Samples.option(...)`, `Samples.nav(...)`, `RecordingScenes`.

- [ ] **Step 1: Test kit**

`FakeCarApi.kt`:

```kotlin
package app.wayfinder.car

import app.wayfinder.car.bridge.*
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Plays the JavaScript side: each request waits until the test answers it. */
class FakeCarApi : CarApi {
  val calls = mutableListOf<String>()
  private val waiting = mutableMapOf<String, ArrayDeque<(Result<Any?>) -> Unit>>()
  private val navListeners = mutableSetOf<(CarNav?) -> Unit>()
  override var navigation: CarNav? = null

  @Suppress("UNCHECKED_CAST")
  private fun <T> hold(call: String, done: (Result<T>) -> Unit) {
    calls += call
    waiting.getOrPut(call.substringBefore(' ')) { ArrayDeque() }.addLast(done as (Result<Any?>) -> Unit)
  }

  /** Answers the latest request for [method]. */
  fun answer(method: String, value: Any?) = waiting[method]!!.removeLast()(Result.success(value))
  /** Answers the earliest one still waiting: an answer arriving late. */
  fun answerStale(method: String, value: Any?) = waiting[method]!!.removeFirst()(Result.success(value))
  fun fail(method: String, message: String) = waiting[method]!!.removeLast()(Result.failure(Exception(message)))
  fun pushNav(nav: CarNav?) {
    navigation = nav
    navListeners.toList().forEach { it(nav) }
  }

  override fun status(done: (Result<CarStatus>) -> Unit) = hold("status", done)
  override fun search(query: String, done: (Result<List<CarPlace>>) -> Unit) = hold("search $query", done)
  override fun discover(done: (Result<List<CarPlace>>) -> Unit) = hold("discover", done)
  override fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit) = hold("plan ${to.id}", done)
  override fun planned(done: (Result<List<PlannedItem>>) -> Unit) = hold("planned", done)
  override fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit) = hold("routeLine $routeId", done)
  override fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit) = hold("start $routeId $destinationName", done)
  override fun stop() { calls += "stop" }
  override fun setMuted(muted: Boolean) { calls += "mute $muted" }
  override fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit {
    navListeners += listener
    return { navListeners -= listener }
  }
}

class RecordingScenes : MapScenes {
  val shown = mutableListOf<MapScene>()
  override fun show(scene: MapScene) { shown += scene }
}
```

`Samples.kt`:

```kotlin
package app.wayfinder.car

import app.wayfinder.car.bridge.*

object Samples {
  fun status(account: Account = Account.SIGNED_IN) =
    CarStatus(account, "https://maps.example.test/map/style.json?theme=light", "https://maps.example.test/map/style.json?theme=dark", "Search places and addresses", LngLat(153.0, -27.4))

  fun place(id: String = "p1", name: String = "Mt Coot-tha Lookout") =
    CarPlace(id, name, "Lookout · 6.2 km away", LngLat(152.957, -27.4846), 6200.0)

  fun option(routeId: String = "r-fast", title: String = "Fastest") =
    RouteOption(routeId, title, "25 min · 1.2 km you’ve never been", 1500.0, 18400.0, 0.0, listOf(LngLat(153.0, -27.4), LngLat(152.957, -27.4846)))

  fun nav(
    status: NavStatus = NavStatus.NAVIGATING,
    maneuver: CarManeuver? = CarManeuver("left", null),
    rerouting: Boolean = false,
    error: String? = null,
    muted: Boolean = false,
    routeId: String = "r-fast",
  ) = CarNav(
    routeId, "Mt Coot-tha Lookout", status, rerouting, muted, error,
    maneuver, "Turn left onto Main St", "Main St", 250.0, null,
    4000.0, 500.0, 1790000000000L, LngLat(153.0, -27.4), 90.0,
  )
}
```

- [ ] **Step 2: Failing test**

`HomeScreenTest.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PlaceListNavigationTemplate
import androidx.car.app.model.Row
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HomeScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private var status: Any? = null
  private val screen = HomeScreen(carContext, api, scenes) { status = it }

  private fun open() = ScreenController(screen).moveToState(Lifecycle.State.STARTED)

  @Test fun waitsForTheAppThenOffersWhatTheDriverCanDo() {
    open()
    assertTrue((screen.onGetTemplate() as PlaceListNavigationTemplate).isLoading)
    api.answer("status", Samples.status())
    val t = screen.onGetTemplate() as PlaceListNavigationTemplate
    assertEquals(listOf("Search", "Planned routes", "Discover nearby"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Overview(Samples.status().here), scenes.shown.last())
    assertNotNull(status)
  }

  @Test fun opensSearch() {
    open()
    api.answer("status", Samples.status())
    ((screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is SearchScreen)
  }

  @Test fun asksToSignInOnThePhone() {
    open()
    api.answer("status", Samples.status(Account.SIGNED_OUT))
    assertEquals("Open Wayfinder on your phone and sign in.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }

  @Test fun saysWhenTheServerCantBeReachedAndTriesAgain() {
    open()
    api.answer("status", Samples.status(Account.OFFLINE))
    val t = screen.onGetTemplate() as MessageTemplate
    assertEquals("Can’t reach your server. Check your phone has signal, then try again.", t.message.text())
    assertEquals("Try again", t.actions.single().title.text())
  }

  @Test fun saysWhenThePhoneAppDoesntAnswer() {
    open()
    api.fail("status", "Wayfinder on your phone isn’t answering. Open it on your phone, then try again.")
    assertEquals("Wayfinder on your phone isn’t answering. Open it on your phone, then try again.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }
}
```

If `TestScreenManager.getScreensPushed()` or `ScreenController(Screen)` have different names in the pinned `app-testing` version, use that version's names. They're documented on the `androidx.car.app.testing` package page.

- [ ] **Step 3: Scene model and home screen**

`.../map/MapScene.kt`:

```kotlin
package app.wayfinder.car.map

import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.bridge.RouteOption

/** What the car map should be showing; each screen says which. */
sealed interface MapScene {
  data class Overview(val here: LngLat?) : MapScene
  data class Places(val places: List<CarPlace>) : MapScene
  data class Routes(val options: List<RouteOption>, val selected: Int) : MapScene
  data class Following(val line: List<LngLat>, val position: LngLat?, val headingDeg: Double?) : MapScene
}

fun interface MapScenes {
  fun show(scene: MapScene)
}
```

`.../screens/HomeScreen.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PlaceListNavigationTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarStatus
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Where the car starts: search, planned routes and Discover, over the map. */
class HomeScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val onStatus: (CarStatus) -> Unit,
) : Screen(carContext) {
  private var status: Result<CarStatus>? = null

  init {
    // Each time Home is back on top: check the account again and show the overview.
    whenStarted { load() }
  }

  private fun load() {
    api.status { r ->
      status = r
      r.getOrNull()?.let {
        onStatus(it)
        map.show(MapScene.Overview(it.here))
      }
      invalidate()
    }
  }

  private fun retry() {
    status = null
    invalidate()
    load()
  }

  override fun onGetTemplate(): Template {
    val loaded = status
      ?: return PlaceListNavigationTemplate.Builder().setTitle(appName(carContext)).setHeaderAction(Action.APP_ICON).setLoading(true).build()
    val s = loaded.getOrElse { return message(it.message ?: "Something went wrong. Try again.") }
    return when (s.account) {
      Account.SIGNED_OUT -> message("Open Wayfinder on your phone and sign in.")
      Account.OFFLINE -> message("Can’t reach your server. Check your phone has signal, then try again.")
      Account.SIGNED_IN -> PlaceListNavigationTemplate.Builder()
        .setTitle(appName(carContext))
        .setHeaderAction(Action.APP_ICON)
        .setItemList(
          ItemList.Builder()
            .addItem(row("Search", null) { screenManager.push(SearchScreen(carContext, api, map, s.searchHint)) })
            .addItem(row("Planned routes", null) { screenManager.push(PickScreens.planned(carContext, api, map)) })
            .addItem(row("Discover nearby", null) { screenManager.push(PickScreens.discover(carContext, api, map)) })
            .build(),
        )
        .build()
    }
  }

  private fun message(text: String): Template =
    MessageTemplate.Builder(text)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.APP_ICON)
      .addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build())
      .build()
}
```

The "sign in" message gets "Try again" too: after signing in on the phone, the driver taps it. That's why `asksToSignInOnThePhone` only checks the message text.

`SearchScreen` and `PickScreens` come in Task 9. To keep this task compiling on its own, create minimal versions now in their files: `class SearchScreen(carContext: CarContext, api: CarApi, map: MapScenes, hint: String) : Screen(carContext) { override fun onGetTemplate(): Template = MessageTemplate.Builder("Search").build() }`, and an `object PickScreens` with `planned`/`discover` returning `MessageScreen(carContext, "…")`. Task 9 replaces both. The `opensSearch` test only checks the pushed type.

`WayfinderSession.kt`:

```kotlin
package app.wayfinder.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import app.wayfinder.car.bridge.BridgeCarApi
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarBridge
import app.wayfinder.car.bridge.ReactBoot
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.screens.HomeScreen

class WayfinderSession(private val api: CarApi = BridgeCarApi(CarBridge.shared)) : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    ReactBoot.ensureStarted(carContext)
    val map = MapScenes { } // the car map arrives in Task 12
    return HomeScreen(carContext, api, map) { }
  }
}
```

- [ ] **Step 4: Run, check in the head unit, commit**

`pnpm test:android` → PASS. DHU: signed in shows the three rows; signed out on the phone shows the sign-in message. `pnpm check`.

```bash
git add apps/mobile/modules/wayfinder-car
git commit -m "Show a home screen in the car

Opening Wayfinder in the car now offers Search, Planned routes and Discover nearby, asks the
driver to sign in on the phone when nobody has, and says so when the server or the phone app
can't be reached, with Try again."
```

---

### Task 9: Search, Discover and Planned routes in the car

**Files:**
- Replace: `.../screens/SearchScreen.kt`; create `.../screens/PickScreen.kt` (with `object PickScreens`)
- Create: `.../screens/RoutePreviewScreen.kt`, a stub for this task (`class RoutePreviewScreen(carContext, api, map, destinationName: String, load: ((Result<PlanResult>) -> Unit) -> Unit) : Screen` returning a `MessageTemplate`, with the two companion factories below). Task 10 fills it in.
- Test: `.../screens/SearchScreenTest.kt`, `.../screens/PickScreenTest.kt`

**Interfaces:**
- Consumes: `CarApi.search/discover/planned`, `MapScene.Places`, `row`, `whenCreated`, `whenStarted`, `MAX_ROWS`.
- Produces: `SearchScreen(carContext, api, map, hint)` with `internal val callback: SearchTemplate.SearchCallback`; `PickScreen<T>(...)`; `PickScreens.planned(carContext, api, map)`, `PickScreens.discover(carContext, api, map)`; `RoutePreviewScreen.forPlace(carContext, api, map, place)`, `RoutePreviewScreen.forPlanned(carContext, api, map, item)`.

- [ ] **Step 1: Failing tests**

`SearchScreenTest.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SearchScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private val screen = SearchScreen(carContext, api, scenes, "Where to, explorer?").also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }

  @Test fun searchesAsTheDriverTypesAndShowsResultsOnTheMap() {
    screen.callback.onSearchTextChanged("co")
    assertTrue("too short to search", api.calls.isEmpty())
    screen.callback.onSearchTextChanged("coot")
    assertTrue((screen.onGetTemplate() as SearchTemplate).isLoading)
    api.answer("search", listOf(Samples.place()))
    val t = screen.onGetTemplate() as SearchTemplate
    assertEquals("Where to, explorer?", t.searchHint)
    assertEquals(listOf("Mt Coot-tha Lookout"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Places(listOf(Samples.place())), scenes.shown.last())
  }

  @Test fun dropsAnAnswerToAnOlderSearch() {
    screen.callback.onSearchTextChanged("coot")
    screen.callback.onSearchSubmitted("coot-tha")
    api.answer("search", listOf(Samples.place("p2", "Coot-tha Road")))
    api.answerStale("search", listOf(Samples.place("p1", "Cootharaba")))
    assertEquals(listOf("Coot-tha Road"), (screen.onGetTemplate() as SearchTemplate).itemList!!.items.map { (it as Row).title.text() })
  }

  @Test fun picksAPlaceToPlanTo() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place()))
    ((screen.onGetTemplate() as SearchTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
  }

  @Test fun saysWhatWentWrong() {
    screen.callback.onSearchSubmitted("coot")
    api.fail("search", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", (screen.onGetTemplate() as SearchTemplate).itemList!!.noItemsMessage.text())
  }
}
```

`PickScreenTest.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.model.PlaceListNavigationTemplate
import androidx.car.app.model.Row
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.PlannedItem
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PickScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()

  @Test fun discoverListsPlacesInUnexploredAreas() {
    val screen = PickScreens.discover(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    assertTrue((screen.onGetTemplate() as PlaceListNavigationTemplate).isLoading)
    api.answer("discover", listOf(Samples.place()))
    val t = screen.onGetTemplate() as PlaceListNavigationTemplate
    assertEquals("Lookout · 6.2 km away", (t.itemList!!.items[0] as Row).texts[0].text())
    assertEquals(MapScene.Places(listOf(Samples.place())), scenes.shown.last())
    (t.itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
  }

  @Test fun plannedSaysWhenThereAreNone() {
    val screen = PickScreens.planned(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    api.answer("planned", emptyList<PlannedItem>())
    assertEquals("Nothing planned for driving. Send a route from the website.", (screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.noItemsMessage.text())
  }

  @Test fun plannedGoesStraightToItsRoute() {
    val screen = PickScreens.planned(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    api.answer("planned", listOf(PlannedItem("pl1", "Sunday drive", Samples.option("r-sun", "Sunday drive"))))
    ((screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
    assertFalse("a planned route needs no planning", api.calls.any { it.startsWith("plan ") })
  }
}
```

- [ ] **Step 2: Screens**

`SearchScreen.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Type (parked) to find a place, then plan to it. Android Auto hides the keyboard while driving. */
class SearchScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val hint: String,
) : Screen(carContext) {
  private var results: List<CarPlace> = emptyList()
  private var loading = false
  private var error: String? = null
  /** Every search takes a number; an answer to an older one is dropped. */
  private var ticket = 0

  internal val callback = object : SearchTemplate.SearchCallback {
    override fun onSearchTextChanged(searchText: String) {
      if (searchText.trim().length >= 3) search(searchText)
    }

    override fun onSearchSubmitted(searchText: String) {
      if (searchText.isNotBlank()) search(searchText)
    }
  }

  init {
    whenStarted { if (results.isNotEmpty()) map.show(MapScene.Places(results)) }
  }

  private fun search(q: String) {
    val mine = ++ticket
    loading = true
    error = null
    invalidate()
    api.search(q.trim()) { r ->
      if (mine != ticket) return@search
      loading = false
      r.onSuccess {
        results = it.take(MAX_ROWS)
        map.show(MapScene.Places(results))
      }.onFailure {
        results = emptyList()
        error = it.message ?: "Search didn’t work. Try again."
      }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = SearchTemplate.Builder(callback).setHeaderAction(Action.BACK).setSearchHint(hint).setShowKeyboardByDefault(true)
    if (loading) return b.setLoading(true).build()
    val list = ItemList.Builder()
    error?.let { list.setNoItemsMessage(it) }
    results.forEach { p -> list.addItem(row(p.name, p.detail) { screenManager.push(RoutePreviewScreen.forPlace(carContext, api, map, p)) }) }
    return b.setItemList(list.build()).build()
  }
}
```

`PickScreen.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.PlaceListNavigationTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** A list to choose from (planned routes, places to discover), with its items on the map. */
class PickScreen<T>(
  carContext: CarContext,
  private val map: MapScenes,
  private val title: String,
  private val emptyMessage: String,
  private val load: ((Result<List<T>>) -> Unit) -> Unit,
  private val describe: (T) -> Pair<String, String>,
  private val scene: (List<T>) -> MapScene,
  private val pick: (T) -> Screen,
) : Screen(carContext) {
  private var items: Result<List<T>>? = null

  init {
    whenCreated {
      load { r ->
        items = r
        invalidate()
        showOnMap()
      }
    }
    whenStarted { showOnMap() }
  }

  private fun showOnMap() {
    items?.getOrNull()?.let { map.show(scene(it.take(MAX_ROWS))) }
  }

  override fun onGetTemplate(): Template {
    val b = PlaceListNavigationTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
    val r = items ?: return b.setLoading(true).build()
    val list = ItemList.Builder()
    r.onSuccess { found ->
      if (found.isEmpty()) list.setNoItemsMessage(emptyMessage)
      found.take(MAX_ROWS).forEach { item ->
        val (name, detail) = describe(item)
        list.addItem(row(name, detail) { screenManager.push(pick(item)) })
      }
    }.onFailure { list.setNoItemsMessage(it.message ?: "Something went wrong. Go back and try again.") }
    return b.setItemList(list.build()).build()
  }
}

object PickScreens {
  fun discover(carContext: CarContext, api: CarApi, map: MapScenes) = PickScreen(
    carContext, map, "Discover nearby", "Nothing new within half an hour’s drive.",
    load = api::discover,
    describe = { it.name to it.detail },
    scene = { MapScene.Places(it) },
    pick = { RoutePreviewScreen.forPlace(carContext, api, map, it) },
  )

  fun planned(carContext: CarContext, api: CarApi, map: MapScenes) = PickScreen(
    carContext, map, "Planned routes", "Nothing planned for driving. Send a route from the website.",
    load = api::planned,
    describe = { it.name to it.option.detail },
    scene = { items -> MapScene.Routes(items.map { it.option }, 0) },
    pick = { RoutePreviewScreen.forPlanned(carContext, api, map, it) },
  )
}
```

Stub `RoutePreviewScreen.kt` for this task:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.bridge.PlannedItem
import app.wayfinder.car.map.MapScenes

class RoutePreviewScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val destinationName: String,
  private val load: ((Result<PlanResult>) -> Unit) -> Unit,
) : Screen(carContext) {
  override fun onGetTemplate(): Template = MessageTemplate.Builder(destinationName).build()

  companion object {
    fun forPlace(carContext: CarContext, api: CarApi, map: MapScenes, place: CarPlace) =
      RoutePreviewScreen(carContext, api, map, place.name) { done -> api.plan(place, done) }

    fun forPlanned(carContext: CarContext, api: CarApi, map: MapScenes, item: PlannedItem) =
      RoutePreviewScreen(carContext, api, map, item.name) { done -> done(Result.success(PlanResult(listOf(item.option), null))) }
  }
}
```

- [ ] **Step 3: Run, head unit, commit**

`pnpm test:android` → PASS. DHU: search for a place you know, open Discover and Planned routes. Each reaches the stub preview. Run `pnpm check`.

```bash
git add apps/mobile/modules/wayfinder-car
git commit -m "Search, discover and pick planned routes from the car

The car's home rows now open a search (keyboard only when parked, as Android Auto rules), a
list of places a short drive away in areas you haven't explored, and the driving routes sent
from the website, each leading to a route preview."
```

---

### Task 10: Choosing a route in the car

The preview lists the fastest route and the ways you haven't been, with the selected one highlighted on the map, and has a **Go** button.

**Files:**
- Replace: `.../screens/RoutePreviewScreen.kt` (keep the companion factories)
- Test: `.../screens/RoutePreviewScreenTest.kt`

**Interfaces:**
- Consumes: `CarApi.start`, `PlanResult`, `RouteOption`, `MapScene.Routes`.
- Produces: `RoutePreviewScreen` with `internal fun select(index: Int)` and `internal fun go()`. Navigation screens are pushed by the coordinator (Task 11), not here.

- [ ] **Step 1: Failing test**

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.RoutePreviewNavigationTemplate
import androidx.car.app.model.Row
import androidx.car.app.testing.ScreenController
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoutePreviewScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private val options = listOf(Samples.option("r-fast", "Fastest"), Samples.option("r-exp", "Explore 1"))
  private val screen = RoutePreviewScreen.forPlace(carContext, api, scenes, Samples.place()).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }

  @Test fun comparesTheFastestWithWaysYouHaventBeen() {
    assertEquals(listOf("plan p1"), api.calls)
    assertTrue((screen.onGetTemplate() as RoutePreviewNavigationTemplate).isLoading)
    api.answer("plan", PlanResult(options, null))
    val t = screen.onGetTemplate() as RoutePreviewNavigationTemplate
    assertEquals(listOf("Fastest", "Explore 1"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Routes(options, 0), scenes.shown.last())
  }

  @Test fun startsTheOneTheDriverChose() {
    api.answer("plan", PlanResult(options, null))
    screen.select(1)
    assertEquals(MapScene.Routes(options, 1), scenes.shown.last())
    screen.go()
    assertEquals("start r-exp Mt Coot-tha Lookout", api.calls.last())
    assertEquals("Starting…", (screen.onGetTemplate() as RoutePreviewNavigationTemplate).navigateAction!!.title.text())
  }

  @Test fun explainsWhyThereIsOnlyOneWay() {
    api.answer("plan", PlanResult(options.take(1), "No other ways fit within your extra time."))
    val row = (screen.onGetTemplate() as RoutePreviewNavigationTemplate).itemList!!.items[0] as Row
    assertEquals("No other ways fit within your extra time.", row.texts[1].text())
  }

  @Test fun saysWhenNoRouteCanBeFound() {
    api.fail("plan", "No route found. Try somewhere nearer a road.")
    assertEquals("No route found. Try somewhere nearer a road.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }
}
```

- [ ] **Step 2: Implementation**

Replace the class body in `RoutePreviewScreen.kt`. Keep the companion; add imports for `Action`, `ItemList`, `Row`, `RoutePreviewNavigationTemplate`, `MessageTemplate`, `CarToast`, `RouteOption`, `MapScene`:

```kotlin
/** The fastest route and ways you haven't been, to choose between before Go. */
class RoutePreviewScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val destinationName: String,
  private val load: ((Result<PlanResult>) -> Unit) -> Unit,
) : Screen(carContext) {
  private var result: Result<PlanResult>? = null
  private var selected = 0
  private var starting = false

  init {
    whenCreated {
      load { r ->
        result = r
        showOnMap()
        invalidate()
      }
    }
    whenStarted { showOnMap() }
  }

  private val options: List<RouteOption> get() = result?.getOrNull()?.options.orEmpty()

  private fun showOnMap() {
    if (options.isNotEmpty()) map.show(MapScene.Routes(options, selected))
  }

  internal fun select(index: Int) {
    selected = index
    showOnMap()
    invalidate()
  }

  /** Once started, navigation takes over the screen (NavigationCoordinator). */
  internal fun go() {
    val option = options.getOrNull(selected) ?: return
    if (starting) return
    starting = true
    invalidate()
    api.start(option.routeId, destinationName) { r ->
      starting = false
      r.onFailure { CarToast.makeText(carContext, it.message ?: "Couldn’t start. Try again.", CarToast.LENGTH_LONG).show() }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = RoutePreviewNavigationTemplate.Builder().setTitle(destinationName).setHeaderAction(Action.BACK)
    val r = result ?: return b.setLoading(true).build()
    val plan = r.getOrElse { return problem(it.message ?: "Couldn’t plan a route. Try again.") }
    if (plan.options.isEmpty()) return problem("No route found to $destinationName.")
    val list = ItemList.Builder().setOnSelectedListener { select(it) }.setSelectedIndex(selected)
    plan.options.forEachIndexed { i, o ->
      list.addItem(
        Row.Builder().setTitle(o.title).addText(o.detail).apply { if (i == 0 && plan.note != null) addText(plan.note) }.build(),
      )
    }
    return b
      .setItemList(list.build())
      .setNavigateAction(Action.Builder().setTitle(if (starting) "Starting…" else "Go").setOnClickListener { go() }.build())
      .build()
  }

  private fun problem(text: String): Template =
    MessageTemplate.Builder(text).setTitle(destinationName).setHeaderAction(Action.BACK).build()

  companion object { /* unchanged */ }
}
```

- [ ] **Step 3: Run, head unit, commit**

`pnpm test:android` → PASS. DHU: search a place; the preview lists Fastest and Explore rows; Go starts navigation on the phone (its Navigate screen isn't open, but its notification "Navigating to …" appears). `pnpm check`.

```bash
git add apps/mobile/modules/wayfinder-car
git commit -m "Choose between the fastest route and new ways in the car

The route preview lists the fastest route and the explore routes with how much is new and how
much longer each takes, and Go starts navigation. When there are no other ways, the reason from
the phone app is shown under the fastest route."
```

---

### Task 11: Driving directions in the car

The driving screen shows the next manoeuvre with its icon and distance, "then …" when a second one follows close behind, the arrival time, Mute and End. It also tells Android Auto a trip is running, so the car's cluster display and "End navigation" from the car work. A coordinator switches to this screen whenever navigation starts, whether from the car or from the phone, and steps back when it ends.

**Files:**
- Create: `.../nav/Distances.kt`, `.../nav/Maneuvers.kt`, `.../nav/ManeuverIcons.kt`, `.../nav/NavTemplates.kt`, `.../nav/NavigationCoordinator.kt`, `.../screens/NavigationScreen.kt`
- Create: `.../res/drawable/wf_*.xml` (14 icons)
- Modify: `.../WayfinderSession.kt`
- Test: `.../nav/DistancesTest.kt`, `.../nav/ManeuversTest.kt`, `.../nav/NavTemplatesTest.kt`, `.../nav/NavigationCoordinatorTest.kt`

**Interfaces:**
- Consumes: `CarNav`, `CarManeuver`, `NavStatus`, `CarApi.navigation/onNavigation/routeLine/stop/setMuted`, `MapScene.Following`.
- Produces: `distanceOf(meters: Double): Distance`; `Maneuvers.typeOf(m: CarManeuver): Int`; `class ManeuverIcons(context) { fun iconFor(type: String): CarIcon }`; `NavTemplates.navigation(nav, icons, onEnd, onMute): NavigationTemplate`, `NavTemplates.trip(nav, icons): Trip`; `class NavigationCoordinator(carContext, api, map, icons) { fun attach(): () -> Unit }`; `class NavigationScreen(carContext, api, map, icons)`.

- [ ] **Step 1: Icons**

Download Material Symbols' Android vector drawables (Apache 2.0) into `apps/mobile/modules/wayfinder-car/android/src/main/res/drawable/`:

```bash
cd apps/mobile/modules/wayfinder-car/android/src/main/res/drawable
for pair in straight:straight turn_slight_left:turn_slight_left turn_left:turn_left turn_sharp_left:turn_sharp_left \
  turn_slight_right:turn_slight_right turn_right:turn_right turn_sharp_right:turn_sharp_right fork_left:keep_left \
  fork_right:keep_right u_turn_left:u_turn_left u_turn_right:u_turn_right roundabout_left:roundabout \
  roundabout_right:roundabout_exit sports_score:destination; do
  src="${pair%%:*}"; dst="${pair##*:}"
  curl -fsSL "https://raw.githubusercontent.com/google/material-design-icons/master/symbols/android/$src/materialsymbolsoutlined/${src}_24px.xml" -o "wf_$dst.xml"
done
# Android Auto draws the icon on its own dark card: white fill, no theme tint.
sed -i -e 's/ android:tint="[^"]*"//' -e 's/android:fillColor="[^"]*"/android:fillColor="#FFFFFFFF"/' wf_*.xml
```

If that repository path has moved, download the same icons as "Android" from fonts.google.com/icons. Add a line to `apps/mobile/modules/wayfinder-car/NOTICE`: `Manoeuvre icons: Material Symbols by Google, Apache License 2.0.`. In the DHU (Step 6), check the roundabout arrows go clockwise, as Queensland roundabouts do; swap the two roundabout files if they don't.

- [ ] **Step 2: Failing tests**

`DistancesTest.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.model.Distance
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Rounded the same way as the phone (packages/nav formatDistanceShort). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DistancesTest {
  private fun check(m: Double, shown: Double, unit: Int) = distanceOf(m).let {
    assertEquals(shown, it.displayDistance, 0.0001)
    assertEquals(unit, it.displayUnit)
  }

  @Test fun metresUnderAHundred() = check(47.4, 47.0, Distance.UNIT_METERS)
  @Test fun tensOfMetresUnderAKilometre() = check(347.0, 350.0, Distance.UNIT_METERS)
  @Test fun kilometresToOnePlace() = check(1234.0, 1.2, Distance.UNIT_KILOMETERS_P1)
  @Test fun wholeKilometresFromTen() = check(12_600.0, 13.0, Distance.UNIT_KILOMETERS)
}
```

`ManeuversTest.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.navigation.model.Maneuver
import app.wayfinder.car.bridge.CarManeuver
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ManeuversTest {
  @Test fun turns() {
    assertEquals(Maneuver.TYPE_TURN_NORMAL_LEFT, Maneuvers.typeOf(CarManeuver("left", null)))
    assertEquals(Maneuver.TYPE_TURN_SHARP_RIGHT, Maneuvers.typeOf(CarManeuver("sharpRight", null)))
    assertEquals(Maneuver.TYPE_KEEP_LEFT, Maneuvers.typeOf(CarManeuver("keepLeft", null)))
    assertEquals(Maneuver.TYPE_U_TURN_RIGHT, Maneuvers.typeOf(CarManeuver("uTurnRight", null)))
    assertEquals(Maneuver.TYPE_DESTINATION, Maneuvers.typeOf(CarManeuver("destination", null)))
  }

  @Test fun roundaboutsGoClockwiseAsQueenslandDrivesOnTheLeft() {
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW, Maneuvers.typeOf(CarManeuver("roundabout", 2)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_CW, Maneuvers.typeOf(CarManeuver("roundabout", null)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_EXIT_CW, Maneuvers.typeOf(CarManeuver("roundaboutExit", null)))
  }

  @Test fun anythingNewIsStraightOn() = assertEquals(Maneuver.TYPE_STRAIGHT, Maneuvers.typeOf(CarManeuver("hover", null)))
}
```

`NavTemplatesTest.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.RoutingInfo
import androidx.test.core.app.ApplicationProvider
import app.wayfinder.car.Samples
import app.wayfinder.car.bridge.CarManeuver
import app.wayfinder.car.bridge.NavStatus
import app.wayfinder.car.bridge.NextStep
import app.wayfinder.car.text
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavTemplatesTest {
  private val icons = ManeuverIcons(ApplicationProvider.getApplicationContext())
  private fun template(nav: app.wayfinder.car.bridge.CarNav?) = NavTemplates.navigation(nav, icons, onEnd = {}, onMute = {})

  @Test fun showsTheNextTurnHowFarAndWhenYouArrive() {
    val t = template(Samples.nav().copy(next = NextStep(CarManeuver("right", null), "Turn right")))
    val info = t.navigationInfo as RoutingInfo
    assertEquals("Turn left onto Main St", info.currentStep!!.cue.text())
    assertEquals("Main St", info.currentStep!!.road.text())
    assertEquals(250.0, info.currentDistance!!.displayDistance, 0.0)
    assertEquals("Turn right", info.nextStep!!.cue.text())
    assertEquals(500L, t.destinationTravelEstimate!!.remainingTimeSeconds)
    assertEquals(listOf("Mute", "End"), t.actionStrip!!.actions.map { it.title.text() })
  }

  @Test fun waitsForTheFirstFix() = assertTrue((template(Samples.nav(status = NavStatus.STARTING, maneuver = null)).navigationInfo as RoutingInfo).isLoading)
  @Test fun loadsUntilThereIsATrip() = assertTrue((template(null).navigationInfo as RoutingInfo).isLoading)

  @Test fun saysWhenItIsFindingANewRoute() =
    assertEquals("Finding a new route…", (template(Samples.nav(rerouting = true)).navigationInfo as MessageInfo).title.text())

  @Test fun passesOnProblems() =
    assertEquals("Navigation needs location permission.", (template(Samples.nav(error = "Navigation needs location permission.")).navigationInfo as MessageInfo).title.text())

  @Test fun saysWhenYouAreOffRoute() =
    assertEquals("Off route", (template(Samples.nav(status = NavStatus.OFF_ROUTE)).navigationInfo as MessageInfo).title.text())

  @Test fun arrives() {
    val t = template(Samples.nav(status = NavStatus.ARRIVED, muted = true))
    val info = t.navigationInfo as MessageInfo
    assertEquals("You’ve arrived", info.title.text())
    assertEquals("Mt Coot-tha Lookout", info.text.text())
    assertEquals(listOf("Unmute", "Done"), t.actionStrip!!.actions.map { it.title.text() })
    assertNull(t.destinationTravelEstimate)
  }

  @Test fun tellsTheCarAboutTheTrip() {
    val trip = NavTemplates.trip(Samples.nav(), icons)
    assertEquals("Mt Coot-tha Lookout", trip.destinations.single().name.text())
    assertEquals("Main St", trip.currentRoad.text())
  }
}
```

`NavigationCoordinatorTest.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.testing.TestScreenManager
import androidx.car.app.testing.navigation.TestNavigationManager
import app.wayfinder.car.*
import app.wayfinder.car.screens.NavigationScreen
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigationCoordinatorTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val coordinator = NavigationCoordinator(carContext, api, RecordingScenes(), ManeuverIcons(carContext))
  private val screens get() = carContext.getCarService(TestScreenManager::class.java)
  private val nav get() = carContext.getCarService(TestNavigationManager::class.java)

  @Test fun showsTheDriveWhereverItWasStarted() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    assertTrue(screens.screensPushed.last() is NavigationScreen)
    assertEquals(1, nav.navigationStartedCount)
    api.pushNav(Samples.nav().copy(remainingDistanceM = 3000.0))
    assertEquals("one drive screen, updated", 1, screens.screensPushed.count { it is NavigationScreen })
    assertEquals(2, nav.tripsSent.size)
  }

  @Test fun picksUpATripAlreadyRunningWhenTheCarConnects() {
    api.navigation = Samples.nav()
    coordinator.attach()
    assertTrue(screens.screensPushed.last() is NavigationScreen)
  }

  @Test fun stepsBackAndTellsAndroidAutoWhenTheTripEnds() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    api.pushNav(null)
    assertEquals(1, nav.navigationEndedCount)
  }

  @Test fun endsTheTripWhenTheCarAsks() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    nav.navigationManagerCallback!!.onStopNavigation()
    assertEquals("stop", api.calls.last())
  }

  @Test fun detachingEndsItsPartInTheTrip() {
    val detach = coordinator.attach()
    api.pushNav(Samples.nav())
    detach()
    assertEquals(1, nav.navigationEndedCount)
    api.pushNav(null)
    assertEquals("no second end after detaching", 1, nav.navigationEndedCount)
  }
}
```

As in Task 8, if a `TestNavigationManager` or `TestScreenManager` getter has a different name in the pinned version, use that version's name. Don't drop the assertion.

- [ ] **Step 3: Implementation**

`Distances.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.model.Distance
import kotlin.math.roundToLong

/** The car's distance for [meters], rounded as the phone shows it (formatDistanceShort). */
fun distanceOf(meters: Double): Distance = when {
  meters >= 10_000 -> Distance.create((meters / 1000).roundToLong().toDouble(), Distance.UNIT_KILOMETERS)
  meters >= 1_000 -> Distance.create((meters / 100).roundToLong() / 10.0, Distance.UNIT_KILOMETERS_P1)
  meters >= 100 -> Distance.create((meters / 10).roundToLong() * 10.0, Distance.UNIT_METERS)
  else -> Distance.create(meters.roundToLong().toDouble(), Distance.UNIT_METERS)
}
```

`Maneuvers.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.navigation.model.Maneuver
import app.wayfinder.car.bridge.CarManeuver

/** The app's manoeuvre kinds (src/car/navModel.ts) as Android Auto's. Roundabouts run clockwise: Queensland drives on the left. */
object Maneuvers {
  fun typeOf(m: CarManeuver): Int = when (m.type) {
    "slightLeft" -> Maneuver.TYPE_TURN_SLIGHT_LEFT
    "left" -> Maneuver.TYPE_TURN_NORMAL_LEFT
    "sharpLeft" -> Maneuver.TYPE_TURN_SHARP_LEFT
    "slightRight" -> Maneuver.TYPE_TURN_SLIGHT_RIGHT
    "right" -> Maneuver.TYPE_TURN_NORMAL_RIGHT
    "sharpRight" -> Maneuver.TYPE_TURN_SHARP_RIGHT
    "keepLeft" -> Maneuver.TYPE_KEEP_LEFT
    "keepRight" -> Maneuver.TYPE_KEEP_RIGHT
    "uTurnLeft" -> Maneuver.TYPE_U_TURN_LEFT
    "uTurnRight" -> Maneuver.TYPE_U_TURN_RIGHT
    "roundabout" -> if (m.exit != null) Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW else Maneuver.TYPE_ROUNDABOUT_ENTER_CW
    "roundaboutExit" -> Maneuver.TYPE_ROUNDABOUT_EXIT_CW
    // Android Auto has no waypoint manoeuvre; the cue says "waypoint".
    "waypoint", "destination" -> Maneuver.TYPE_DESTINATION
    else -> Maneuver.TYPE_STRAIGHT
  }
}
```

`ManeuverIcons.kt`:

```kotlin
package app.wayfinder.car.nav

import android.content.Context
import androidx.car.app.model.CarIcon
import androidx.core.graphics.drawable.IconCompat
import app.wayfinder.car.R

class ManeuverIcons(private val context: Context) {
  fun iconFor(type: String): CarIcon {
    val res = when (type) {
      "slightLeft" -> R.drawable.wf_turn_slight_left
      "left" -> R.drawable.wf_turn_left
      "sharpLeft" -> R.drawable.wf_turn_sharp_left
      "slightRight" -> R.drawable.wf_turn_slight_right
      "right" -> R.drawable.wf_turn_right
      "sharpRight" -> R.drawable.wf_turn_sharp_right
      "keepLeft" -> R.drawable.wf_keep_left
      "keepRight" -> R.drawable.wf_keep_right
      "uTurnLeft" -> R.drawable.wf_u_turn_left
      "uTurnRight" -> R.drawable.wf_u_turn_right
      "roundabout" -> R.drawable.wf_roundabout
      "roundaboutExit" -> R.drawable.wf_roundabout_exit
      "waypoint", "destination" -> R.drawable.wf_destination
      else -> R.drawable.wf_straight
    }
    return CarIcon.Builder(IconCompat.createWithResource(context, res)).build()
  }
}
```

`NavTemplates.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.Trip
import app.wayfinder.car.bridge.CarManeuver
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.NavStatus
import java.util.TimeZone
import kotlin.math.roundToLong

object NavTemplates {
  fun navigation(nav: CarNav?, icons: ManeuverIcons, onEnd: () -> Unit, onMute: () -> Unit): NavigationTemplate {
    val arrived = nav?.status == NavStatus.ARRIVED
    val strip = ActionStrip.Builder()
      .addAction(Action.Builder().setTitle(if (nav?.muted == true) "Unmute" else "Mute").setOnClickListener(onMute).build())
      .addAction(Action.Builder().setTitle(if (arrived) "Done" else "End").setOnClickListener(onEnd).build())
      .build()
    val b = NavigationTemplate.Builder().setActionStrip(strip)
    when {
      nav == null -> b.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
      arrived -> b.setNavigationInfo(MessageInfo.Builder("You’ve arrived").apply { nav.destinationName?.let { setText(it) } }.build())
      nav.rerouting -> b.setNavigationInfo(MessageInfo.Builder("Finding a new route…").build())
      nav.error != null -> b.setNavigationInfo(MessageInfo.Builder(nav.error).build())
      nav.status == NavStatus.OFF_ROUTE -> b.setNavigationInfo(MessageInfo.Builder("Off route").build())
      nav.maneuver == null -> b.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
      else -> b.setNavigationInfo(routingInfo(nav, nav.maneuver, icons))
    }
    if (nav != null && !arrived) b.setDestinationTravelEstimate(estimate(nav))
    return b.build()
  }

  /** For the car's own displays (the cluster behind the wheel, heads-up). */
  fun trip(nav: CarNav, icons: ManeuverIcons): Trip = Trip.Builder()
    .addDestination(Destination.Builder().setName(nav.destinationName ?: "Destination").build(), estimate(nav))
    .apply {
      if (nav.road.isNotEmpty()) setCurrentRoad(nav.road)
      val m = nav.maneuver
      if (m != null && nav.status == NavStatus.NAVIGATING) addStep(step(m, nav.cue, nav.road, icons), estimate(nav))
      else setLoading(nav.status == NavStatus.STARTING)
    }
    .build()

  private fun routingInfo(nav: CarNav, m: CarManeuver, icons: ManeuverIcons): RoutingInfo =
    RoutingInfo.Builder()
      .setCurrentStep(step(m, nav.cue, nav.road, icons), distanceOf(nav.distanceToManeuverM ?: 0.0))
      .apply { nav.next?.let { setNextStep(step(it.maneuver, it.cue, "", icons)) } }
      .build()

  private fun step(m: CarManeuver, cue: String, road: String, icons: ManeuverIcons): Step =
    Step.Builder(cue.ifEmpty { "Continue" })
      .setManeuver(
        Maneuver.Builder(Maneuvers.typeOf(m))
          .apply { if (Maneuvers.typeOf(m) == Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW) setRoundaboutExitNumber(m.exit!!) }
          .setIcon(icons.iconFor(m.type))
          .build(),
      )
      .apply { if (road.isNotEmpty()) setRoad(road) }
      .build()

  private fun estimate(nav: CarNav): TravelEstimate =
    TravelEstimate.Builder(distanceOf(nav.remainingDistanceM), DateTimeWithZone.create(nav.arrivalEpochMs, TimeZone.getDefault()))
      .setRemainingTimeSeconds(nav.remainingDurationS.roundToLong())
      .build()
}
```

`screens/NavigationScreen.kt`:

```kotlin
package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.NavTemplates

/** Directions while driving, over a map that follows you. */
class NavigationScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
) : Screen(carContext) {
  private var nav: CarNav? = api.navigation
  private var line: List<LngLat> = emptyList()
  private var lineFor: String? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      private var off: (() -> Unit)? = null
      override fun onCreate(owner: LifecycleOwner) {
        off = api.onNavigation(::update)
        update(api.navigation)
      }
      override fun onDestroy(owner: LifecycleOwner) {
        off?.invoke()
      }
    })
  }

  private fun update(n: CarNav?) {
    nav = n
    // The route changes on a reroute; fetch its line once per route, not on every fix.
    if (n != null && n.routeId != lineFor) {
      val id = n.routeId
      lineFor = id
      api.routeLine(id) { r ->
        if (lineFor == id) {
          line = r.getOrDefault(emptyList())
          showMap()
        }
      }
    }
    showMap()
    invalidate()
  }

  private fun showMap() = map.show(MapScene.Following(line, nav?.position, nav?.headingDeg))

  override fun onGetTemplate(): Template =
    NavTemplates.navigation(nav, icons, onEnd = { api.stop() }, onMute = { api.setMuted(!(nav?.muted ?: false)) })
}
```

`nav/NavigationCoordinator.kt`:

```kotlin
package app.wayfinder.car.nav

import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.screens.NavigationScreen

/**
 * Keeps the car in step with navigation, wherever it was started: shows the driving screen, tells
 * Android Auto a trip is running (so the car's own displays and "End navigation" work), and steps
 * back to the start when it ends.
 */
class NavigationCoordinator(
  private val carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
) {
  private var navigating = false
  private val screens get() = carContext.getCarService(ScreenManager::class.java)
  private val navManager get() = carContext.getCarService(NavigationManager::class.java)

  fun attach(): () -> Unit {
    navManager.setNavigationManagerCallback(object : NavigationManagerCallback {
      override fun onStopNavigation() = api.stop()
    })
    val off = api.onNavigation(::update)
    update(api.navigation)
    return {
      off()
      if (navigating) navManager.navigationEnded()
      navigating = false
      navManager.clearNavigationManagerCallback()
    }
  }

  private fun update(nav: CarNav?) {
    if (nav != null && !navigating) {
      navigating = true
      navManager.navigationStarted()
      screens.popToRoot()
      screens.push(NavigationScreen(carContext, api, map, icons))
    } else if (nav == null && navigating) {
      navigating = false
      navManager.navigationEnded()
      screens.popToRoot()
    }
    if (nav != null) navManager.updateTrip(NavTemplates.trip(nav, icons))
  }
}
```

`WayfinderSession.kt`: attach the coordinator once Home is on the stack, and detach when the session ends:

```kotlin
class WayfinderSession(private val api: CarApi = BridgeCarApi(CarBridge.shared)) : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    ReactBoot.ensureStarted(carContext)
    val map = MapScenes { } // the car map arrives in Task 12
    val coordinator = NavigationCoordinator(carContext, api, map, ManeuverIcons(carContext))
    // After Home is on the stack, so a trip already running goes on top of it.
    Handler(Looper.getMainLooper()).post {
      val detach = coordinator.attach()
      lifecycle.addObserver(object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) = detach()
      })
    }
    return HomeScreen(carContext, api, map) { }
  }
}
```

(imports: `android.os.Handler`, `android.os.Looper`, `androidx.lifecycle.DefaultLifecycleObserver`, `androidx.lifecycle.LifecycleOwner`, `app.wayfinder.car.nav.*`)

- [ ] **Step 4: Run the tests**

`pnpm test:android` → all PASS.

- [ ] **Step 5: Gate**

`pnpm check`.

- [ ] **Step 6: Drive it in the head unit**

In the DHU, go to Search → a place → Go. Expected: the driving screen shows the first manoeuvre with its icon, distance and arrival time. Use the DHU's simulated location, or a GPX replay on the phone with a mock location app, to drive the route: distances count down, a "then" hint appears where two turns come close, and a wrong turn shows "Off route" and then "Finding a new route…". Tap End; the car returns home and the phone's "Navigating to …" notification goes away. Next, start a route on the **phone**: the car jumps to the driving screen by itself. Finally, force-stop the phone app and start from the car again, to confirm it works cold. Check the roundabout icon direction.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/modules/wayfinder-car
git commit -m "Give turn-by-turn directions in the car

The car now shows each manoeuvre with its icon, the distance to it, the turn after when it comes
close, and when you'll arrive, with Mute and End, and says when you're off route or being
rerouted. Android Auto is told when a trip runs so the car's cluster and 'End navigation' work,
and the car switches to directions whether the trip began in the car or on the phone."
```

---

### Task 12: The map on the car screen

Draws the server's map on the car's surface: routes and places while choosing, then following you tilted and heading-up while driving. Dark style at night.

**Files:**
- Create: `.../map/SceneLayout.kt`, `.../map/CarMapRenderer.kt`
- Modify: `.../WayfinderSession.kt`, `.../screens/HomeScreen.kt` usage (styles from status)
- Test: `.../map/SceneLayoutTest.kt`. `CarMapRenderer` draws with OpenGL and is checked by hand in the DHU (recorded in `docs/verification.md`, Task 15).

**Interfaces:**
- Consumes: `MapScene`, `MapScenes`, `CarStatus.styleLight/styleDark`.
- Produces: `data class SceneDrawing(selected: List<LngLat>, others: List<List<LngLat>>, points: List<LngLat>, position: LngLat?)`; `sealed interface CameraSpec { Follow(target, bearing), Fit(points), Center(target, zoom), Keep }`; `object SceneLayout { fun drawing(scene): SceneDrawing; fun camera(scene): CameraSpec; val AUSTRALIA: CameraSpec.Center }`; `class CarMapRenderer(carContext) : SurfaceCallback, MapScenes { fun setStyles(light: String?, dark: String?); fun refreshStyle(); fun release() }`.

- [ ] **Step 1: Failing test**

```kotlin
package app.wayfinder.car.map

import app.wayfinder.car.Samples
import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Test

class SceneLayoutTest {
  private val here = LngLat(153.0, -27.4)

  @Test fun overviewCentresOnYouOrShowsAustralia() {
    assertEquals(CameraSpec.Center(here, 13.0), SceneLayout.camera(MapScene.Overview(here)))
    assertEquals(SceneLayout.AUSTRALIA, SceneLayout.camera(MapScene.Overview(null)))
  }

  @Test fun placesAreMarkedAndFitted() {
    val scene = MapScene.Places(listOf(Samples.place(), Samples.place("p2").copy(location = here)))
    assertEquals(listOf(LngLat(152.957, -27.4846), here), SceneLayout.drawing(scene).points)
    assertEquals(CameraSpec.Fit(listOf(LngLat(152.957, -27.4846), here)), SceneLayout.camera(scene))
  }

  @Test fun theChosenRouteStandsOut() {
    val a = Samples.option("a")
    val b = Samples.option("b").copy(geometry = listOf(here, LngLat(153.1, -27.5)))
    val d = SceneLayout.drawing(MapScene.Routes(listOf(a, b), 1))
    assertEquals(b.geometry, d.selected)
    assertEquals(listOf(a.geometry), d.others)
    assertEquals(CameraSpec.Fit(a.geometry + b.geometry), SceneLayout.camera(MapScene.Routes(listOf(a, b), 1)))
  }

  @Test fun drivingFollowsYouHeadingUpOrShowsTheRouteUntilThereIsAFix() {
    val line = listOf(here, LngLat(153.1, -27.5))
    assertEquals(CameraSpec.Follow(here, 90.0), SceneLayout.camera(MapScene.Following(line, here, 90.0)))
    assertEquals(CameraSpec.Fit(line), SceneLayout.camera(MapScene.Following(line, null, null)))
    assertEquals(here, SceneLayout.drawing(MapScene.Following(line, here, 90.0)).position)
  }
}
```

This is plain JUnit with no Android classes, so it needs no Robolectric runner.

- [ ] **Step 2: `SceneLayout.kt`**

```kotlin
package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat

data class SceneDrawing(val selected: List<LngLat>, val others: List<List<LngLat>>, val points: List<LngLat>, val position: LngLat?)

sealed interface CameraSpec {
  data class Follow(val target: LngLat, val bearing: Double?) : CameraSpec
  data class Fit(val points: List<LngLat>) : CameraSpec
  data class Center(val target: LngLat, val zoom: Double) : CameraSpec
  data object Keep : CameraSpec
}

/** What to draw and where to look for each scene; the renderer only carries it out. */
object SceneLayout {
  /** The whole country, as the phone map starts (MapCanvas OVERVIEW). */
  val AUSTRALIA = CameraSpec.Center(LngLat(134.5, -27.5), 3.6)

  fun drawing(scene: MapScene): SceneDrawing = when (scene) {
    is MapScene.Overview -> SceneDrawing(emptyList(), emptyList(), emptyList(), null)
    is MapScene.Places -> SceneDrawing(emptyList(), emptyList(), scene.places.map { it.location }, null)
    is MapScene.Routes -> SceneDrawing(
      scene.options.getOrNull(scene.selected)?.geometry.orEmpty(),
      scene.options.filterIndexed { i, _ -> i != scene.selected }.map { it.geometry },
      emptyList(),
      null,
    )
    is MapScene.Following -> SceneDrawing(scene.line, emptyList(), emptyList(), scene.position)
  }

  fun camera(scene: MapScene): CameraSpec = when (scene) {
    is MapScene.Overview -> scene.here?.let { CameraSpec.Center(it, 13.0) } ?: AUSTRALIA
    is MapScene.Places -> if (scene.places.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.places.map { it.location })
    is MapScene.Routes -> scene.options.flatMap { it.geometry }.let { if (it.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(it) }
    is MapScene.Following -> scene.position?.let { CameraSpec.Follow(it, scene.headingDeg) }
      ?: if (scene.line.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.line)
  }
}
```

- [ ] **Step 3: `CarMapRenderer.kt`**

```kotlin
package app.wayfinder.car.map

import android.app.Presentation
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import app.wayfinder.car.bridge.LngLat
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/**
 * The map on the car screen: MapLibre (the phone map's engine) in a Presentation on a virtual
 * display that draws into the car's surface. Uses the server's own style, dark at night.
 */
class CarMapRenderer(private val carContext: CarContext) : SurfaceCallback, MapScenes {
  private var display: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var map: MapLibreMap? = null
  private var styles: Pair<String?, String?> = null to null
  private var loadedStyle: String? = null
  private var scene: MapScene = MapScene.Overview(null)
  private var surfaceSize = Rect()
  private var visible = Rect()

  override fun onSurfaceAvailable(container: SurfaceContainer) {
    val surface = container.surface ?: return
    MapLibre.getInstance(carContext)
    val vd = carContext.getSystemService(DisplayManager::class.java).createVirtualDisplay(
      "wayfinder-car-map", container.width, container.height, container.dpi, surface, DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY,
    )
    val p = Presentation(carContext, vd.display)
    val view = MapView(p.context)
    view.onCreate(null)
    p.setContentView(view)
    p.show()
    view.onStart()
    view.onResume()
    view.getMapAsync { m ->
      map = m
      m.uiSettings.isLogoEnabled = false // OSM attribution stays on
      loadedStyle = null
      refreshStyle()
    }
    display = vd
    presentation = p
    mapView = view
    surfaceSize = Rect(0, 0, container.width, container.height)
    if (visible.isEmpty) visible = Rect(surfaceSize)
  }

  override fun onVisibleAreaChanged(visibleArea: Rect) {
    visible = visibleArea
    applyCamera()
  }

  override fun onStableAreaChanged(stableArea: Rect) {}

  override fun onSurfaceDestroyed(container: SurfaceContainer) = release()

  fun setStyles(light: String?, dark: String?) {
    styles = light to dark
    refreshStyle()
  }

  /** Also called when the car switches between day and night. */
  fun refreshStyle() {
    val m = map ?: return
    val url = (if (carContext.isDarkMode) styles.second else styles.first) ?: return
    if (url == loadedStyle) return
    loadedStyle = url
    m.setStyle(Style.Builder().fromUri(url)) { style ->
      addLayers(style)
      applyScene()
    }
  }

  override fun show(scene: MapScene) {
    this.scene = scene
    applyScene()
  }

  fun release() {
    mapView?.run { onPause(); onStop(); onDestroy() }
    presentation?.dismiss()
    display?.release()
    mapView = null
    presentation = null
    display = null
    map = null
    loadedStyle = null
  }

  private fun addLayers(style: Style) {
    style.addSource(GeoJsonSource(OTHERS))
    style.addSource(GeoJsonSource(SELECTED))
    style.addSource(GeoJsonSource(POINTS))
    style.addSource(GeoJsonSource(POSITION))
    style.addLayer(LineLayer(OTHERS, OTHERS).withProperties(lineColor(GREY), lineWidth(6f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(LineLayer(SELECTED, SELECTED).withProperties(lineColor(ACCENT), lineWidth(8f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(CircleLayer(POINTS, POINTS).withProperties(circleColor(ACCENT), circleRadius(7f), circleStrokeColor(WHITE), circleStrokeWidth(2f)))
    style.addLayer(CircleLayer(POSITION, POSITION).withProperties(circleColor(ACCENT), circleRadius(10f), circleStrokeColor(WHITE), circleStrokeWidth(3f)))
  }

  private fun applyScene() {
    val style = map?.style?.takeIf { it.isFullyLoaded } ?: return
    val d = SceneLayout.drawing(scene)
    style.getSourceAs<GeoJsonSource>(SELECTED)?.setGeoJson(lines(listOf(d.selected)))
    style.getSourceAs<GeoJsonSource>(OTHERS)?.setGeoJson(lines(d.others))
    style.getSourceAs<GeoJsonSource>(POINTS)?.setGeoJson(points(d.points))
    style.getSourceAs<GeoJsonSource>(POSITION)?.setGeoJson(points(listOfNotNull(d.position)))
    applyCamera()
  }

  private fun applyCamera() {
    val m = map ?: return
    if (visible.isEmpty) return
    val left = visible.left.toDouble()
    val top = visible.top.toDouble()
    val right = (surfaceSize.width() - visible.right).toDouble().coerceAtLeast(0.0)
    val bottom = (surfaceSize.height() - visible.bottom).toDouble().coerceAtLeast(0.0)
    when (val spec = SceneLayout.camera(scene)) {
      is CameraSpec.Follow -> m.easeCamera(
        CameraUpdateFactory.newCameraPosition(
          CameraPosition.Builder()
            .target(spec.target.latLng())
            .zoom(16.0)
            .tilt(45.0)
            .apply { spec.bearing?.let { bearing(it) } }
            // Keep the car low in the view so more of the road ahead shows.
            .padding(left, top + visible.height() * 0.4, right, bottom)
            .build(),
        ),
        900,
      )
      is CameraSpec.Fit -> {
        val distinct = spec.points.distinct()
        if (distinct.size == 1) {
          m.easeCamera(CameraUpdateFactory.newLatLngZoom(distinct[0].latLng(), 15.0), 600)
        } else {
          val bounds = LatLngBounds.Builder().includes(distinct.map { it.latLng() }).build()
          m.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, (left + 40).toInt(), (top + 40).toInt(), (right + 40).toInt(), (bottom + 40).toInt()), 600)
        }
      }
      is CameraSpec.Center -> m.moveCamera(CameraUpdateFactory.newLatLngZoom(spec.target.latLng(), spec.zoom))
      CameraSpec.Keep -> Unit
    }
  }

  private fun lines(ls: List<List<LngLat>>) =
    FeatureCollection.fromFeatures(ls.filter { it.size >= 2 }.map { l -> Feature.fromGeometry(LineString.fromLngLats(l.map { Point.fromLngLat(it.lon, it.lat) })) })

  private fun points(ps: List<LngLat>) = FeatureCollection.fromFeatures(ps.map { Feature.fromGeometry(Point.fromLngLat(it.lon, it.lat)) })

  private fun LngLat.latLng() = LatLng(lat, lon)

  private companion object {
    const val SELECTED = "wf-route-selected"
    const val OTHERS = "wf-route-others"
    const val POINTS = "wf-places"
    const val POSITION = "wf-position"
    // The phone's accent (src/lib/theme.ts) and a quiet grey for the routes not chosen.
    const val ACCENT = "#1765cc"
    const val GREY = "#8a94a6"
    const val WHITE = "#ffffff"
  }
}
```

- [ ] **Step 4: Wire it into the session**

In `WayfinderSession.onCreateScreen`, replace `val map = MapScenes { }` with:

```kotlin
val map = CarMapRenderer(carContext)
carContext.getCarService(AppManager::class.java).setSurfaceCallback(map)
lifecycle.addObserver(object : DefaultLifecycleObserver {
  override fun onDestroy(owner: LifecycleOwner) = map.release()
})
renderer = map
```

Add a `private var renderer: CarMapRenderer? = null` property. Pass `{ status -> map.setStyles(status.styleLight, status.styleDark) }` as Home's `onStatus`, and add `override fun onCarConfigurationChanged(newConfiguration: Configuration) { renderer?.refreshStyle() }` so the map follows the car's day and night switch.

- [ ] **Step 5: Run and check by hand**

`pnpm test:android` → PASS. In the DHU:
- Home centres on your position, or shows Australia without a fix.
- Search results are marked and fitted.
- The route preview shows the chosen route in blue and the others in grey, and selecting another row swaps them.
- Driving follows you tilted and heading-up, with the car low on the screen.
- Switching the DHU to night (`day`/`night` commands in its console) switches to the dark style.
- OSM attribution is visible.

Then `pnpm check`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/modules/wayfinder-car
git commit -m "Draw the map on the car screen

Android Auto navigation apps draw their own map. The car now gets the server's own MapLibre style
(the phone map's engine, in a presentation on the car's surface): routes and places while
choosing, then following you heading-up while driving, dark at night."
```

---

### Task 13: Spoken directions that duck the music

`expo-speech` doesn't ask for audio focus, so directions talk over music in the car. A native voice now uses navigation-guidance audio and transient ducking focus. The phone gets it too.

**Files:**
- Create: `.../voice/NavVoice.kt`; Modify: `.../WayfinderCarModule.kt`, `apps/mobile/modules/wayfinder-car/index.ts`
- Create: `apps/mobile/src/nav/voice.ts`; Modify: `apps/mobile/src/nav/navigationService.ts` (use it)
- Modify: `apps/mobile/test/fakes.tsx` (`fakeCarNative` gets `speak`, `stopSpeaking`)
- Test: `.../voice/NavVoiceTest.kt`, `apps/mobile/test/voice.native.test.tsx`

**Interfaces:**
- Produces: `speak(text: string): void`, `stopSpeaking(): void` in `src/nav/voice.ts`; native `speak(text)`, `stopSpeaking()`; Kotlin `class NavVoice(context) { fun speak(text); fun stop(); companion val ATTRIBUTES }`.

- [ ] **Step 1: Failing tests**

`NavVoiceTest.kt`:

```kotlin
package app.wayfinder.car.voice

import android.media.AudioAttributes
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavVoiceTest {
  private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
  private val audio = context.getSystemService(AudioManager::class.java)

  @Test fun speaksAsNavigationSoMusicDips() {
    assertEquals(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE, NavVoice.ATTRIBUTES.usage)
    val voice = NavVoice(context)
    shadowOf(voice.tts).onInitListener.onInit(TextToSpeech.SUCCESS)
    voice.speak("Turn left")
    assertEquals("Turn left", shadowOf(voice.tts).lastSpokenText)
    assertEquals(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK, shadowOf(audio).lastAudioFocusRequest.audioFocusRequest.focusGain)
  }

  @Test fun saysWhatWasAskedBeforeTheVoiceWasReady() {
    val voice = NavVoice(context)
    voice.speak("In 200 metres, turn left")
    assertNull(shadowOf(voice.tts).lastSpokenText)
    shadowOf(voice.tts).onInitListener.onInit(TextToSpeech.SUCCESS)
    assertEquals("In 200 metres, turn left", shadowOf(voice.tts).lastSpokenText)
  }
}
```

`apps/mobile/test/voice.native.test.tsx`:

```tsx
/// <reference types="jest" />
import * as Speech from 'expo-speech';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

it('uses the app’s own voice, which dips music, where it is built in', () => {
  const car = { speak: jest.fn(), stopSpeaking: jest.fn() };
  jest.isolateModules(() => {
    jest.doMock('../modules/wayfinder-car', () => ({ native: car }));
    const voice = require('../src/nav/voice') as typeof import('../src/nav/voice');
    voice.speak('Turn left');
    voice.stopSpeaking();
  });
  expect(car.speak).toHaveBeenCalledWith('Turn left');
  expect(car.stopSpeaking).toHaveBeenCalled();
  expect(Speech.speak).not.toHaveBeenCalled();
});

it('falls back to Expo’s voice elsewhere', () => {
  jest.isolateModules(() => {
    const voice = require('../src/nav/voice') as typeof import('../src/nav/voice');
    voice.speak('Turn left');
    voice.stopSpeaking();
  });
  expect(Speech.speak).toHaveBeenCalledWith('Turn left', { language: 'en-AU', rate: 1.0 });
  expect(Speech.stop).toHaveBeenCalled();
});
```

- [ ] **Step 2: Kotlin voice**

`NavVoice.kt`:

```kotlin
package app.wayfinder.car.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Spoken directions as navigation audio: the car (or phone) dips music while they play and
 * brings it back after.
 */
class NavVoice(context: Context) : TextToSpeech.OnInitListener {
  private val audio = context.getSystemService(AudioManager::class.java)
  private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(ATTRIBUTES).build()
  internal val tts = TextToSpeech(context.applicationContext, this)
  private var ready = false
  private var queued: String? = null

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) return
    tts.language = Locale("en", "AU")
    tts.setAudioAttributes(ATTRIBUTES)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {}
      override fun onDone(utteranceId: String?) { audio.abandonAudioFocusRequest(focus) }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) { audio.abandonAudioFocusRequest(focus) }
    })
    ready = true
    queued?.let { speak(it) }
    queued = null
  }

  fun speak(text: String) {
    if (!ready) {
      queued = text
      return
    }
    audio.requestAudioFocus(focus)
    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wayfinder-directions")
  }

  fun stop() {
    queued = null
    if (ready) tts.stop()
    audio.abandonAudioFocusRequest(focus)
  }

  companion object {
    val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }
}
```

In `WayfinderCarModule.definition()`, add:

```kotlin
    val voice by lazy { NavVoice(appContext.reactContext!!) }
    Function("speak") { text: String -> voice.speak(text) }
    Function("stopSpeaking") { voice.stop() }
    OnDestroy { if (voice.isInitialized()) voice.value.stop() }
```

`val … by lazy` can't be queried for initialisation inside the DSL, so write it as a module property instead: `private val voiceLazy = lazy { NavVoice(appContext.reactContext!!) }`, use `voiceLazy.value` in the functions, and in the existing `OnDestroy` block add `if (voiceLazy.isInitialized()) voiceLazy.value.stop()`.

- [ ] **Step 3: JS voice**

`modules/wayfinder-car/index.ts`: add `speak(text: string): void; stopSpeaking(): void;` to the declared class and to the `CarNative` pick. Add `speak: jest.fn(), stopSpeaking: jest.fn(),` to `fakeCarNative()`.

`apps/mobile/src/nav/voice.ts`:

```ts
import * as Speech from 'expo-speech';
import { native } from '../../modules/wayfinder-car';

/** Spoken directions. The app's own voice dips music while it speaks; Expo's is the fallback. */
export function speak(text: string) {
  if (native) native.speak(text);
  else Speech.speak(text, { language: 'en-AU', rate: 1.0 });
}

export function stopSpeaking() {
  if (native) native.stopSpeaking();
  else Speech.stop();
}
```

In `navigationService.ts`, replace `import * as Speech from 'expo-speech'` with `import { speak as say, stopSpeaking } from './voice'`. The service's `speak` becomes:

```ts
  const speak = (text: string) => {
    if (snap.muted) return;
    quietly(() => stopSpeaking());
    quietly(() => say(text));
  };
```

and every other `Speech.stop()` becomes `stopSpeaking()`. The existing turn-by-turn assertions on `Speech.speak(..., { language: 'en-AU' })` still hold: in Jest `native` is null (setup.ts), so the fallback runs.

- [ ] **Step 4: Run, check, commit**

`cd apps/mobile && npx jest`, `pnpm test:android`, then `pnpm check`. DHU (or the car): play music, navigate, and the music dips for each direction.

```bash
git add apps/mobile/modules/wayfinder-car apps/mobile/src/nav apps/mobile/test
git commit -m "Dip the music for spoken directions

Expo's speech doesn't ask for audio focus, so directions talked over whatever was playing in the
car. The app now speaks through its own voice as navigation guidance with ducking focus, on the
phone and in the car; Expo's voice remains the fallback where the native module isn't built in."
```

---

### Task 14: Back to directions on the phone

A trip started from the car runs with no phone screen. When the phone app is open, a banner at the top says so and opens the directions.

**Files:**
- Create: `apps/mobile/src/ui/NavigatingBanner.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/navigate.tsx`
- Test: `apps/mobile/test/navigating-banner.screen.test.tsx`; add cases to `apps/mobile/test/navigate.screen.test.tsx`

**Interfaces:**
- Consumes: `navigation.subscribe/getSnapshot` (Task 1); `useTurnByTurn(null)` shows a running trip.
- Produces: `<NavigatingBanner />`; route `/navigate?resume=1`.

- [ ] **Step 1: Failing tests**

`navigating-banner.screen.test.tsx`:

```tsx
/// <reference types="jest" />
import { act, fireEvent, screen } from '@testing-library/react-native';
import { NavigatingBanner } from '../src/ui/NavigatingBanner';
import { fake, renderScreen, resetFakes } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
let mockSnap = { active: false, destinationName: null as string | null };
const mockListeners = new Set<() => void>();
jest.mock('../src/nav/navigationService', () => ({
  navigation: { getSnapshot: () => mockSnap, subscribe: (l: () => void) => (mockListeners.add(l), () => mockListeners.delete(l)) },
}));

beforeEach(() => {
  resetFakes();
  mockSnap = { active: false, destinationName: null };
});

it('shows nothing without a trip', async () => {
  await renderScreen(<NavigatingBanner />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('appears when a trip starts (from the car, say) and opens the directions', async () => {
  await renderScreen(<NavigatingBanner />);
  await act(async () => {
    mockSnap = { active: true, destinationName: 'Mt Coot-tha Lookout' };
    mockListeners.forEach((l) => l());
  });
  expect(screen.getByText('Navigating to Mt Coot-tha Lookout')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to directions' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate?resume=1');
});
```

Add to `navigate.screen.test.tsx`:

```tsx
it('follows a trip already running when opened to resume it', async () => {
  setRouteToNavigate(null as never);
  fake.params = { resume: '1' };
  await renderScreen(<Navigate />);
  expect(screen.queryByText('No route selected.')).toBeNull();
  expect(screen.getByRole('button', { name: 'End' })).toBeOnTheScreen();
});

it('says there is no route when asked to resume but nothing is running', async () => {
  setRouteToNavigate(null as never);
  fake.params = { resume: '1' };
  mockNav.route = null;
  await renderScreen(<Navigate />);
  expect(screen.getByText('No route selected.')).toBeOnTheScreen();
});
```

The existing test 'says when there is no route to follow' must still pass: with no `resume` param, the screen behaves exactly as before.

- [ ] **Step 2: Implementation**

`apps/mobile/src/ui/NavigatingBanner.tsx`:

```tsx
import { router } from 'expo-router';
import { Navigation } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { navigation } from '../nav/navigationService';
import { space, useTheme } from '../lib/theme';

/** While a trip runs without the Navigate screen open (started in the car, say): a way back to it. */
export function NavigatingBanner() {
  const t = useTheme();
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  if (!snap.active) return null;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: t.accent }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to directions"
        onPress={() => router.push('/navigate?resume=1')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] }}
      >
        <Navigation size={20} color="#ffffff" />
        <Text style={{ color: '#ffffff', fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {snap.destinationName ? `Navigating to ${snap.destinationName}` : 'Navigating'}
        </Text>
        <Text style={{ color: '#ffffff', fontWeight: '600' }}>Back to directions</Text>
      </Pressable>
    </SafeAreaView>
  );
}
```

`(tabs)/_layout.tsx`: wrap the returned `<Tabs …>` as

```tsx
    <View style={{ flex: 1 }}>
      <NavigatingBanner />
      <Tabs …unchanged… />
    </View>
```

(import `View` from `react-native` and `NavigatingBanner` from `../../src/ui/NavigatingBanner`.)

`navigate.tsx`:

```tsx
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  // Resuming follows the trip already running (started in the car, say) instead of starting one.
  const initial = useMemo(() => (resume === '1' ? null : takeRouteToNavigate()), [resume]);
  const nav = useTurnByTurn(initial);

  if (!initial && !(resume === '1' && nav.route)) {
    …the existing "No route selected." view…
  }
```

(import `useLocalSearchParams` from `expo-router`.)

- [ ] **Step 3: Run, gate, commit**

`cd apps/mobile && npx jest` then `pnpm check`. On the phone: start a trip from the DHU, open the phone app, and the banner shows; tapping it opens the directions, and End on the phone ends the trip in the car too.

```bash
git add apps/mobile/src/ui/NavigatingBanner.tsx apps/mobile/app apps/mobile/test
git commit -m "Show a way back to directions on the phone during a car trip

A trip started from the car runs without the phone's Navigate screen, so opening the phone app
gave no sign of it. A banner now says where you're navigating to and opens the directions, which
follow the running trip rather than starting another."
```

---

### Task 15: Docs, distribution and the release

**Files:**
- Modify: `docs/architecture.md`, `docs/testing.md`, `docs/verification.md`, `docs/install-android.md`, `docs/build-android.md`, `docs/development.md`, `CLAUDE.md`
- Modify: `apps/mobile/app.config.ts` (`version: '0.3.0'`, `versionCode: 3`), `apps/mobile/package.json` (`"version": "0.3.0"`)

- [ ] **Step 1: Architecture**

Add to `docs/architecture.md` a section **"Android Auto"**:

```markdown
## Android Auto

The car app is a local Expo module, `apps/mobile/modules/wayfinder-car` (Kotlin; `android/` is
generated, so nothing native lives there). Android Auto binds `WayfinderCarAppService`; its screens
are Car App Library templates, and it draws its own map (MapLibre, the phone map's engine) onto
the car's surface through a virtual display, using the server's `/map/style.json`.

The car screens hold no data of their own. They ask the JavaScript side through a small bridge
(`CarBridge` in Kotlin, `src/car/controller.ts` in JS): `status`, `search`, `discover`, `plan`,
`planned`, `routeLine`, `start`, `stop`, `mute`, and JS pushes every navigation change back
(`src/car/navModel.ts`). The messages are defined in `src/car/protocol.ts` and `bridge/Protocol.kt`,
pinned by fixtures both test suites read.

Navigation is one session for the whole app (`src/nav/navigationService.ts`), followed by the
phone's Navigate screen and the car alike; a trip started on either shows on both. While it runs,
a location foreground service keeps directions coming with the phone locked.

If Android Auto opens Wayfinder while the phone app is closed, Kotlin starts React, and the app
entry (`apps/mobile/index.ts`) starts the car controller without any screen.

Templates are the ones every Android Auto version has (`minCarApiLevel` 1). Not yet: panning the
car map, a speed-limit sign in the car, cars with Android built in (Android Automotive).
```

- [ ] **Step 2: Testing**

In `docs/testing.md`:
- Commands table: add `| pnpm test:android | The Android Auto module's Kotlin tests (Robolectric), in the Android build image; takes over node_modules while it runs |`. Mention it in the `pnpm check` paragraph.
- "Which layer" table: add `| Android Auto screens, bridge, map scenes | apps/mobile/modules/wayfinder-car/android/src/test | FakeCarApi, Samples, TestKit (TestCarContext) |` and `| The car ↔ app messages | carProtocol.test.ts + ProtocolTest.kt, over the fixtures in modules/wayfinder-car/android/src/test/resources/fixtures | — |`.
- Feature map: add a row `| Android Auto: search, Discover, planned routes, route choice, directions, map | carProtocol.test.ts, carNavModel.test.ts, carModule.test.ts, categories.test.ts | — | car-controller.native.test.tsx, car-handlers.native.test.tsx, navigation-service.native.test.tsx, navigation-location.native.test.tsx, voice.native.test.tsx, navigating-banner.screen.test.tsx, Kotlin tests in modules/wayfinder-car | — |`. Extend the turn-by-turn row with `navigation-service.native.test.tsx`, `navigation-location.native.test.tsx`.
- "Not covered" list: add `**The car map on a car surface.** SceneLayoutTest covers what is drawn and where the camera goes; MapLibre drawing through the virtual display is checked in the Desktop Head Unit (verification.md).`

- [ ] **Step 3: Verification checklist**

Add to `docs/verification.md` a section **"Android Auto (Desktop Head Unit)"** with this checklist, and tick each item on the release build:

```markdown
## Android Auto (Desktop Head Unit)

Run against a release APK on a real phone (docs/build-android.md, "Trying it in a car").

- [ ] Wayfinder is listed in Android Auto; opening it with the phone app force-stopped shows Home within 5 s
- [ ] Signed out on the phone: the car asks to sign in; after signing in, Try again shows Home
- [ ] Search (parked) finds a place; its preview shows Fastest and Explore rows, the chosen one blue on the map
- [ ] Discover nearby lists places with "% unexplored area"; Planned routes lists driving routes only
- [ ] Go: directions with icon, distance and arrival; "then" hint on close turns; map follows heading-up
- [ ] Wrong turn: "Off route", then "Finding a new route…", then new directions and route line
- [ ] Roundabout icons turn clockwise
- [ ] Music dips for each spoken direction; Mute silences them
- [ ] Phone locked for the whole drive: directions keep coming
- [ ] Trip started on the phone appears in the car; trip started in the car shows the phone banner
- [ ] End in the car, End on the phone, and the car's own "End navigation" each end the trip everywhere
- [ ] Night mode switches the map to the dark style; OSM attribution visible
```

- [ ] **Step 4: Install and build docs**

`docs/install-android.md`: add section **"6. Android Auto"**:

```markdown
## 6. Android Auto

Wayfinder works on a car screen through Android Auto. Because it isn't from the Play Store,
Android Auto hides it until you allow it once:

1. On the phone, open **Settings → Connected devices → Connection preferences → Android Auto**
   (or search Settings for "Android Auto").
2. Scroll to the bottom and tap **Version** ten times, then **OK** to turn on developer settings.
3. Open the **⋮** menu → **Developer settings**, and turn on **Unknown sources**.
4. Connect to the car. Wayfinder is in the car's app list.

In the car you can search (while parked), pick a planned route, find places nearby you haven't
explored, choose between the fastest route and new ways, and follow directions. Directions keep
going with the phone locked. Start a trip on the phone and the car shows it too.

Android Auto updates occasionally turn **Unknown sources** off again; if Wayfinder disappears
from the car, repeat step 3.
```

`docs/build-android.md`: add **"Trying it in a car"**:

````markdown
## Trying it in a car

Without a car, use Google's Desktop Head Unit (DHU):

1. Install it with the Android SDK tools: `sdkmanager "extras;google;auto"` (and `platform-tools`
   for `adb`).
2. On the phone: turn on Android Auto's developer settings and **Unknown sources**
   (install-android.md, section 6), then in the **⋮** menu choose **Start head unit server**.
3. Connect the phone by USB with USB debugging on, then:

   ```bash
   adb forward tcp:5277 tcp:5277
   ```

   ```bash
   $ANDROID_HOME/extras/google/auto/desktop-head-unit
   ```

Type `day` or `night` in the DHU console to switch modes. For a drive without driving, replay a
GPX track with a mock-location app set in the phone's developer options.
````

`docs/development.md`: add a recipe, **"Changing the car app"**. Cover: Kotlin lives in `apps/mobile/modules/wayfinder-car`; a new bridge request needs a `protocol.ts` schema, a `Protocol.kt` parser, a fixture, a handler in `src/car/handlers.ts` and a `CarApi` method; run `pnpm test:android`; try it in the DHU.

`CLAUDE.md`: in **Commands**, add `pnpm test:android` (Kotlin tests for the Android Auto module, in Docker, and part of `pnpm check`). In **Layout**, change `apps/mobile` to `apps/mobile` (Expo Android app; `modules/wayfinder-car` is the Android Auto car app).

- [ ] **Step 5: Version, build, verify, commit**

1. Set `version: '0.3.0'`, `versionCode: 3` in `app.config.ts` and `"version": "0.3.0"` in `apps/mobile/package.json`.
2. `pnpm check`: everything passes.
3. `EXPO_PUBLIC_API_URL=https://maps.paulsjones.com infra/scripts/build-apk.sh`, then install `dist/wayfinder.apk` over the current app. It installs as an update because it's signed with the same key.
4. Work through the Android Auto checklist in `docs/verification.md` with the DHU, and in a real car if one is available. Fix anything that fails, with a test, before calling it done.
5. `VERIFY_REGION=qld pnpm verify:mobile` against the live server. The API is unchanged, so this should pass as before.

```bash
git add docs CLAUDE.md apps/mobile/app.config.ts apps/mobile/package.json
git commit -m "Document Android Auto and release it as 0.3.0

Explains how the car app fits together, how to test it (pnpm test:android, the head unit), how
drivers enable it for a sideloaded app, and records the manual checks run on the release build."
```

---

## Self-review notes

- **Coverage of the scope:** search (T6, T9), Discover (T6, T9), planned routes (T6, T9), fastest vs explore (T6, T10), directions (T7, T11), map (T12), voice ducking (T13), phone-locked navigation (T2), cold start from the car (T5), phone ↔ car handover (T11, T14), distribution and docs (T15). Round trips from the car are left out on purpose (listed as a follow-up).
- **Names used across tasks:** `navigation.{start,stop,setMuted,handleFix,getSnapshot,subscribe}` and `NavSnapshot.active` (T1) are used in T2, T5–T7 and T14. `CarApi` methods (T5) match `FakeCarApi` (T8) and every screen. `MapScene.{Overview,Places,Routes,Following}` (T8) is used in T9–T12. `RoutePreviewScreen.forPlace/forPlanned` (T9 stub) keeps its companion in T10. `ManeuverIcons(context)` is used by `NavTemplates`, `NavigationScreen` and `NavigationCoordinator`.
- **Where the plan is least certain:** the exact getter names in `androidx.car.app:app-testing` (`screensPushed`, `tripsSent`, `navigationStartedCount`, …), the Material Symbols raw file path, and whether `expo-module-gradle-plugin` needs anything more for SDK 57. Each spot says what to check and keeps the assertion. MapLibre drawing on the car surface and a cold start through `reactHost.start()` are proven in the DHU at Tasks 5 and 12, before anything is built on them.
