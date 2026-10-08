# Verification record

What has been checked, how to repeat it, and what is still open. Update this when the checks change.

## Automated

| Check | Command | Status |
|---|---|---|
| Lint | `pnpm lint` | clean |
| Types (7 packages) | `pnpm typecheck` | clean |
| Whole gate | `pnpm check` | passing, 2026-10-08 |
| Unit tests | `pnpm test:unit` | passing, 149 tests: geo/H3/novelty/segmentation, schemas, copy in every voice, nav engine, OSM tag mapping, boundaries, opening hours, GraphHopper client, metrics, API and worker config, job registration, refresh steps, mobile upload queue and API client (timeouts, server addresses, answers checked against the schemas), the Android manifest's permissions |
| Web component tests | `pnpm test:web` | passing, 164 tests: every planner panel, sign-in/register/reset, route guards, account menu, feedback, every admin page, the map layer against a fake MapLibre |
| Integration tests, PGlite | `pnpm test:integration` | passing, 125 (+4 skipped unless `GRAPHHOPPER_LIVE_URL` is set): services, every API area, the admin CLI, the job queue, data export, worker jobs and the refresh pipeline |
| Integration tests, real Postgres 17 | `TEST_DATABASE_URL=… pnpm test:coverage` | passing, 413 (+4 skipped) across all Vitest projects, against `postgres:17-bookworm`, 2026-09-27 |
| Vitest coverage | `pnpm test:coverage` | 96.6% lines, 94.2% statements, 92.4% functions, 86.0% branches; floors 95 / 92 / 90 / 84 |
| Android tests | `pnpm test:mobile` | passing, 126 tests: every screen (the native map faked), navigation, background tracking and the upload queue, contacts, session, the map component, and each failure below that the phone can throw at them |
| Android coverage | `pnpm test:mobile:coverage` | 93.9% lines, 90.1% statements, 79.5% functions, 87.8% branches; floors 92 / 88 / 77 / 85 |
| Android app on the emulator | [development.md](development.md#emulator), APK built for the local stack | 2026-09-27: launches; register, sign-in errors, a server address without `https://`, planning (directions, explore, loops), contact search, navigation without a GPS fix, opening offline and Try again, Coverage against an older server. 2026-09-28: background tracking recording with the app open, and driving a real route (27 Whitby Place, Thornlands to Goodlife Ormiston, on the local Australia graph) to arrival with background tracking on: fastest and explore routes, speed limits, points from both reaching the server |
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
- Explore detours still U-turned at their via points after the cul-de-sac fix (a user report, 2026-09-27). Via points sit on road nodes, where GraphHopper's `pass_through` has no effect, so the route dipped into the side street and turned round. Measured on the live GraphHopper around Cleveland: 19 of 25 street-snapped vias gave a U-turn at the via; moving the via to the road the route turned off left 21 of 25 with no U-turn, and driving routes with any U-turn are no longer offered.
- Android contacts with several addresses offered only the first, and the feedback message box drew black text on the dark panel (a caller's `style` replaced the field's own, colour included). Both user reports, 2026-09-27.
- Android closed a few seconds into a trip (a user report, 2026-09-28; found on the emulator). With background tracking on, `expo-task-manager` hands each batch of locations to a persisted JobScheduler job, which Android refuses to apps without `RECEIVE_BOOT_COMPLETED`; the app lists its permissions, so it never had it, and the refusal went uncaught on the main thread. It took moving to set it off, so it showed up as starting a trip.
- The Android app died on launch: `expo-contacts` was from an older Expo SDK (found on the emulator). Its SDK 57 main entry also throws for the functions the app used, so a bare version bump would have left contact search silently empty.
- Android, found reading every screen after crash reports (each now has a test):
  - A round trip that finished after switching to Directions crashed Plan (`routes[0].id` of an empty list); clearing a place left its routes up, with Start still going there.
  - Starting a route with fewer than two points (a planned route, or from and to the same place) threw inside navigation with nothing to catch it, and the app had no error boundary, so any render error closed it.
  - Leaving navigation while the phone was still asking for location left GPS running; location switched off failed silently; a failed reroute was never retried, although the screen said it would be.
  - Fitting the map to a long route spread every point into `Math.min`, which overflows the stack past about 100k points.
  - Typing over a chosen place swallowed the first key; "Your location" failures were unhandled, and their message sat in a list the permission prompt closes.
  - A server address typed without `https://` (or with a keyboard's stray space) failed with "No server address set"; a server that never answered spun forever; a login page or the wrong site gave "JSON Parse error".
  - Opening the app offline signed people out; the next account on a phone saw the last one's trips and planned routes until they refetched.
  - A place category the app didn't know crashed Discover; Trips said "no trips yet" when it couldn't load them; Settings' Sync, Remove, and switches failed silently.
  - Against a server from before coverage-by-roads, Coverage crashed on the missing numbers (found on the emulator). APKs and the server update separately, so the answers screens depend on are now checked against the shared schemas, and a mismatch says the app or server needs updating.
- Android navigation never zoomed in when a trip started (a user report, 2026-09-27). Following your position only re-centres the map at the zoom it already has, and the map opened on the whole of Australia, so the trip was followed from the country overview; the screen's fit-to-the-whole-route never ran at start (the map wasn't loaded yet) but zoomed back out on every reroute. The map now sets a street-level zoom while following, opens at the route's start before the first fix, and navigation no longer fits the whole route.

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

## Android Auto (Desktop Head Unit)

**Not run yet.** The car app is built and its automated tests pass (`pnpm test:android`,
`pnpm test:mobile`, `carModule.test.ts`), but no head unit or car was available, so nothing below
has been ticked. Run it against a release APK on a real phone (build-android.md, "Trying it in a
car"), tick each item as it passes, and record the date. Fix anything that fails, with a test.

Known gaps against Google's car app quality guidelines (navigation requests from other apps and
Assistant, navigation notifications, a test-drive mode) are written up, with the phone app's core
and adaptive quality gaps, in
[quality-gaps.md](quality-gaps.md); they are not on this checklist until they are built.

- [ ] Wayfinder is listed in Android Auto; opening it with the phone app force-stopped shows Home within 5 s
- [ ] Signed out on the phone: the car asks to sign in; after signing in, Try again shows Home
- [ ] Search (parked) finds a place; its preview shows Fastest and Explore rows, the chosen one blue on the map
- [ ] The route-preview rows for explore routes show their "(N min longer)" text
- [ ] Discover nearby lists places with "% unexplored area"; Planned routes lists driving routes only
- [ ] The car map draws through the virtual display: the style loads, and the map follows each screen (places, routes, directions)
- [ ] Go: directions with icon, distance and arrival; "then" hint on close turns; map follows heading-up
- [ ] Wrong turn: "Off route", then "Finding a new route…", then new directions and route line
- [ ] Wrong turn with no signal and the phone locked: "Finding a new route…" gives way within about 20 s to "Couldn’t get a new route…", and a new route comes once there is signal again
- [ ] Back on the driving screen goes to Home with "Back to directions" first, which returns to the directions; the trip keeps going meanwhile
- [ ] Roundabout icons turn clockwise (both kinds of roundabout)
- [ ] Music dips for each spoken direction and comes back after; Mute silences them
- [ ] Phone locked for the whole drive: directions keep coming
- [ ] Trip started on the phone appears in the car; trip started in the car shows the phone banner, with its padding clear of the status bar and gesture bar
- [ ] End in the car, End on the phone, and the car's own "End navigation" each end the trip everywhere
- [ ] Night mode switches the map to the dark style; OSM attribution visible
- [ ] Cold start from the car: force-stop the phone app, open Wayfinder from the car, and Home appears without opening the phone
- [ ] Cold start from the car with the phone app never opened since the phone started and the phone locked, then start a trip: the "Navigating to …" notification appears and directions keep coming (Android 12+ limits on starting foreground services from the background; Android 14's "while using the app" location rules)
- [ ] Swipe the app away mid-trip, then open it again: no "Navigating" notification left over, and GPS isn't left running
- [ ] "Navigate to Mt Coot-tha Lookout" by voice (Assistant) opens its route preview, with the phone app closed and with it open; `adb shell am start -a androidx.car.app.action.NAVIGATE -d "geo:-27.47,153.03"` (or the DHU's equivalent) does the same for a point
- [ ] A navigate request while signed out on the phone asks to sign in, and Try again continues to the place
- [ ] During a trip, the car's notification area shows the next instruction, with a heads-up only when it changes; tapping it returns to the directions; it is gone when the trip ends
- [ ] DHU "auto drive" (`adb shell dumpsys activity service androidx.car.app.samples.navigation.car.NavigationCarAppService AUTO_DRIVE`, with our service name) starts a test drive with no route chosen and with one running; it arrives, ends cleanly, and the trip does not appear in the web app's trips or coverage
- [ ] Start a trip with no signal at all: the car map is blank at first, then draws once there is signal (the style is tried again)
- [ ] Every car message that sends the driver to the phone (signed out, phone not answering, update needed, location off) says "When it’s safe" (VI-1)
- [ ] Choosing places, routes or a list row jumps the car map straight to them with no glide; only the map following the car moves smoothly (SA-1)
- [ ] "Navigate to …" by voice works from a Play install, where Android Auto finds Wayfinder through `NavigateActivity`'s filter (NF-6, VC-1); `adb shell am start -a androidx.car.app.action.NAVIGATE -d "geo:0,0?q=Mt+Coot-tha"` on the phone alone just opens Wayfinder
- [ ] Another navigation app starts directions while Wayfinder's trip runs: Wayfinder's voice, notification and cluster info stop (NF-5)
- [ ] Launch to Home in under 10 s and content (search, Discover, route preview) in under 10 s; every button answers within 2 s (DR-1 to DR-3)
- [ ] Maneuver icons and the map's route colours are legible in day and night on the DHU (VD-1)
- [ ] Start a trip on the phone, then connect the car: the driving screen's map draws (it was black until End; 2026-10-06 report)
- [ ] Driving: the position marker stays put while the map glides under it; the speed-limit sign and the speed show bottom left of the map, the speed red when over the limit
- [ ] Driving: + and − zoom the followed map; dragging (pan mode, or touch) stops it following and shows Re-centre, which brings it back
- [ ] Off route and rerouted: the road driven before the reroute stays on the map, in purple
- [ ] Roundabout icons show the exit taken (left, straight on, right) for a few real roundabouts
- [ ] Report on the driving screen: a toast, and the report under Admin → Feedback with what the car showed and the place
- [ ] Before the first fix the driving screen says "Finding where you are…", not a spinner
- [ ] Arriving: "You have arrived" said once; the trip ends by itself about 15 s later, on the car and the phone
- [ ] Drive into a dead end mid-trip: "Route updated. Turn around when you can" once, and no new route every few seconds while you find somewhere to turn

## Phone app: window sizes, keyboard and mouse

Not run yet: needs an APK built with the orientation change (see quality-gaps.md, gap 4) on
emulators. Jest covers the layouts at phone, 600 dp and 1000 dp with the window faked; these check
what Jest can't (the real window, the real map, a real keyboard and mouse). Android Studio
emulators are enough.

- [ ] Phone (portrait, about 393 dp wide): the app stays upright when the phone is turned, on every screen
- [ ] Foldable 841 x 701 dp, 8" tablet 1024 x 640 dp, 10.5" tablet 1280 x 800 dp, 13" Chromebook 1600 x 900 dp: fills the window with no letterboxing; sign in and register keep a narrow centred form
- [ ] The same four sizes in landscape and portrait: Plan, Discover and Coverage show the map beside the details; Trip replay and Navigate do too, with the turn banner and the time left in the left panel
- [ ] Rotate, fold and unfold, and drag the window between sizes in multi-window, with a trip running on Navigate: the trip keeps going, the map keeps following, nothing resets
- [ ] The same with text typed in Plan's search fields, the feedback message, and the sign-in form; scroll positions on Settings and Trips stay
- [ ] Resize a window down below 600 dp (phone-sized multi-window): the app locks upright again, and large again lifts the lock
- [ ] Touch targets: every button, segment, chip, search clear button and the mute button is easy to hit; layout inspector shows none under 48 dp
- [ ] Keyboard: Tab moves through every control in a sensible order with a visible outline; Enter or Space presses the focused control; Enter submits sign in and register
- [ ] Esc in a search box closes the suggestions, then clears the box (a Chromebook's Esc may act as Back, so check what it does there)
- [ ] Feedback on a tablet or Chromebook: Enter sends once there is a message; on a phone Enter starts a new line
- [ ] Mouse: buttons, list rows, chips and cards shade under the pointer; scroll wheel scrolls lists; the map zooms with Ctrl plus the scroll wheel and with pinch on a touchscreen
- [ ] A password manager offers to save and generate on the register form, and fills sign in

## Google Play permission checks (phone)

- [ ] Settings, Background tracking on, with location never granted: the "Use your location in the background?" disclosure shows first; "Not now" leaves the switch off with no Android prompt; "Continue" leads to Android's location prompt, then "Allow all the time"
- [ ] With "Allow all the time" already granted, turning tracking on asks nothing
- [ ] Android 13+, notifications never allowed: turning tracking on (after location) and starting a trip on the phone each ask to allow notifications; a trip started from the car does not ask on the phone
- [x] Record the disclosure, the system prompts and the recording notification for the Play background location declaration video (2026-10-04, emulator, app 0.4.0: `store/play/background-location.mp4`). On that run, with location and notifications never granted: the disclosure came first, Continue led to Android's prompt and then its location page, "Allow all the time" stuck, notifications were asked for next, and the notification showed with the app in the background. Its small icon is a plain circle, not the Wayfinder arrow

## Open / manual

- **`pnpm play` against the real Play API (2026-10-04):** `status` lists the tracks and `listing` committed the store listing. An upload of a new bundle hasn't run against Play yet. Service account permission changes took more than 10 minutes to reach the API.

- **Android on a device.** Install the APK (`infra/scripts/build-apk.sh`) and check: background tracking survives the app being killed and Doze; a real walk appears as new coverage on the web; turn-by-turn with a deliberate wrong turn triggers a reroute; the offline queue uploads when connectivity returns.
- **The native map itself.** Every Android screen is tested in Jest with the map faked, and the map component with MapLibre Native mocked; MapLibre Native on a device is covered only by device testing.
- **Restore drill.** `infra/scripts/backup.sh` and `restore.sh` are written but a full restore has not been rehearsed on this machine.
- **The live server has no backups yet.** Nothing is scheduled on `maps.paulsjones.com`; see [deploy-small-server.md](deploy-small-server.md#open-items).
- **"The app crashes when I start the map"** (a user report, 2026-09-22) is unconfirmed. The likely causes were closed in code, but it has not been reproduced on a device; a logcat from an affected phone would settle it:
  ```bash
  adb logcat -c && adb logcat | grep -iE "wayfinder|AndroidRuntime|maplibre"
  ```
- **The 2026-09-23 APK crashes on launch; the fix needs a new APK in people's hands.** Found on
  the emulator, 2026-09-27: `expo-contacts ~15.0.11` was from an older Expo SDK and needs
  `AnyTypeProvider`, which `expo-modules-core` 57 no longer has, so every launch died with
  `NoClassDefFoundError` before the first screen. Fixed in code (`expo-contacts ~57.0.6`, used
  through `expo-contacts/legacy`) and checked on the emulator with a build against the dev stack.
  App 0.2.0 (versionCode 2), with this fix and the 2026-09-28 feedback fixes, was built for
  `maps.paulsjones.com` on 2026-09-28: it installs over the old build, opens on the emulator with no
  crash, and its sign-in screen reaches the server. It hasn't been shared with testers yet. This
  is likely what the crash reports were.
- **2026-10-08 feedback fixes** (reports from 5–7 October; app 0.5.0, versionCode 6, server
  changes for routes and saved places). Checked by tests, and on the live server's data where noted:
  the car map black when a trip was already running (the styles were only asked for by Home);
  "You have arrived" said twice (the destination's "now" announcement and the arrival); a new route
  asked for every 7 seconds in a dead-end street (Ironbark Street, 5 Oct: reproduced against the
  live graph, where the only way on is back); the car's endless spinner before the first fix;
  roundabout icons that ignored the exit; no zoom, pan, speed limit or speed in the car; a jerky
  position marker; the road driven vanishing after a reroute. Added from ideas: Report in the car,
  the trip ending itself after arriving, Discover places opening directions, Open in Google Maps,
  and saved places ("Home", "Work"). Still to do: the car checklist above on a head unit or car.
- **App 0.4.0 (versionCode 5)** adds Delete account and a privacy policy link in Settings, and builds an `.aab` for Google Play. Not built or deployed yet; the web `/privacy` and `/delete-account` pages need the web deploy, then check both load signed out.
- **App 0.3.1 (versionCode 4), with Android Auto and the 2026-10-01 feedback fixes, is not shared
  yet.** 0.3.0 was never built. Still to do for 0.3.1: its install over 0.2.0, `pnpm verify:mobile`
  against the live server and the Android Auto checklist above.
- **2026-10-01 feedback fixes** (reports from 28–29 September). Checked by tests, and on the live
  server's data where noted: background trips cut into one per upload by a rejected fix (the
  reporter's 28 Sept trips); parked time kept on trips, so drives averaged walking pace; a navigated
  drive recorded a second time by background tracking; roads drawn and counted only by their
  longest stretch (gaps on the coverage map); a U-turn round a roundabout announced as "exit 1"
  when a detour's stop lay on it (reproduced against the live graph); new routes mid-drive starting
  backwards; contacts' addresses found in the wrong suburb (reproduced against the live places);
  coverage not refreshing or framing the roads on Android, nor framing them on the web; trip replay
  speed. Not reproduced, waiting on detail from the reporter: wrong speed limits (the limits along
  their navigated route match OSM), traffic lights not recognised.
