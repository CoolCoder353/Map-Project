# Android quality gaps

Where Wayfinder falls short of Google's Android quality guidelines, written for whoever fixes
them. Three sets of guidelines apply:

| Guidelines                                                                                                        | Applies to                                                                       | Section here                                                |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [Car app quality](https://developer.android.com/docs/quality-guidelines/car-app-quality) (navigation)             | The Android Auto car app (`apps/mobile/modules/wayfinder-car`)                   | [Car app gaps](#car-app-gaps-android-auto)                  |
| [Core app quality](https://developer.android.com/docs/quality-guidelines/core-app-quality)                        | The phone app (`apps/mobile`)                                                    | [Phone app gaps](#phone-app-gaps-core-and-adaptive-quality) |
| [Adaptive app quality](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality), Tiers 3 and 2 | The phone app on tablets, foldables, desktop windows and with keyboards and mice | [Phone app gaps](#phone-app-gaps-core-and-adaptive-quality) |

Checked 2026-10-02 by reading the code and the built release manifest, with a few checks against
the Nothing Phone used for testing; **nothing here has been run on a head unit, a tablet or a
foldable** (see [verification.md](verification.md#android-auto-desktop-head-unit)).

## Why this matters, and when

**None of these gaps blocks what we do today.** Android Auto only lists a Car App Library app that
Google Play installed (Unknown sources does not cover it), and an **internal testing** track gets
no Android Auto review. The guideline pages are test guidance, not a list Play enforces item by
item. Where Play does enforce something (target SDK, app bundles, permission declarations) the gap
says so.

- **Car app:** navigation is a "built for use while driving" category, so it must meet **Tier 2
  (Car Optimized)** before Google Play accepts it for open testing or production. Tier 1 (Car
  Differentiated) is optional and adds cluster-display maps. The first three car gaps also make the
  app better for people using it now.
- **Phone app:** the most important gap is the large-screen one (gap 4), because it changes how the
  app behaves today on any tablet or foldable running Android 16.

## Fixed (2026-10-02)

Gaps 1 to 11 below were fixed or decided in one change. What each did, and what is still unchecked:

- **Navigation requests (NF-6, VC-1):** the car service takes `androidx.car.app.action.NAVIGATE` with `geo:` links, in `onCreateScreen` and `onNewIntent`. Signed-out and closed-app cases are handled. Not tried with Assistant on a head unit.
- **Navigation notifications (NF-3):** one ongoing navigation notification with `CarAppExtender`, cancelled on end, stop and detach. The phone's own "Navigating to …" notification still shows too. Not seen on a head unit.
- **Test drive (NF-7):** `onAutoDriveEnabled` runs a ~90 s simulation of the running trip, or a built-in 2 km route when none is running. It records and uploads nothing. Not tried on the Desktop Head Unit.
- **EP-2 (restore state on relaunch):** judged met. The car picks up a running trip on connect and Home offers "Back to directions".
- **Large screens:** the manifest portrait lock is gone; `useOrientationPolicy` locks portrait at runtime under 600 dp. Forms cap their width, and screens use a side panel from 840 dp. State is kept across resize (tested in Jest). Nothing has run on a tablet, foldable or Chromebook; the sizes are on the checklist in [verification.md](verification.md).
- **Touch targets:** buttons, compact buttons, segments and the small controls are 48 dp.
- **Predictive back:** enabled (`predictiveBackGestureEnabled`). Back from every screen is unchecked on a device.
- **Permissions:** `SYSTEM_ALERT_WINDOW` and the two external-storage permissions are blocked. Biometric ones stay (from `expo-secure-store`). The Android 12 and older screenshot attach is unchecked.
- **Autofill:** register password has `new-password`.
- **Network security config:** a config plugin writes one that disallows cleartext; `ALLOW_HTTP=1` builds allow it. Not checked in a built APK.
- **Keyboard, mouse (Tier 2):** focus outline, hover shading, Esc in search, Enter sends feedback on large windows. Not built: context menus and content zoom. Ctrl+scroll map zoom and tab order are untested on a device.
- **Signing in on a new phone:** decision: not needed for an invite-only group. The backup rules include only shared preferences, so the sign-in token and `wayfinder-tracking.db` stay off the new phone; users sign in again. If ever wanted: Credential Manager, then Restore Credentials, then an optional biometric lock.

## Fixed (2026-10-02, full-page audit)

A second pass read the full car app quality page, the navigation and distribution pages, and Play's
permission rules, criterion by criterion (table below). Found and fixed:

- **Background location prominent disclosure (Play User Data policy; the likeliest rejection):**
  there was none; Settings went straight to Android's prompts. Now `requestTrackingPermission`
  (`src/tracking/background.ts`) shows the disclosure (`src/tracking/disclosure.ts`) before any
  Android prompt unless "Allow all the time" is already granted, and asks Android nothing on "Not
  now" or a dismiss. It names the data (location), says it is collected even when the app is closed
  or not in use, says what for (recording roads travelled, suggesting new ones), who gets it (only
  the group's server) and how to turn it off. Tests: `tracking.native.test.tsx`,
  `permissions.native.test.tsx`, `settings.screen.test.tsx`.
- **`POST_NOTIFICATIONS` was declared but never asked for**, so on Android 13+ the recording
  notification, "Navigating to …" and the car's turn-by-turn notification (NF-3) were hidden. Now
  asked after location when tracking is turned on, and when a trip starts on the phone (never from
  the car). `src/lib/notifications.ts`; tests in `permissions.native.test.tsx`,
  `navigation-service.native.test.tsx`.
- **VI-1:** car messages sending the driver to the phone ("Open Wayfinder on your phone and sign
  in", "isn't answering", "update", "location is off") didn't say to look only when safe; "Check
  your phone has signal" sent the driver to the phone for no reason. Now in `CarMessages.kt` (and
  `src/car/handlers.ts`, `controller.ts`), each with "When it's safe". Tests: `CarMessagesTest`,
  `HomeScreenTest`, `NavigateRequestsTest`, `BridgeCarApiTest`, `car-handlers`/`car-controller`.
- **SA-1:** the car map glided (600 ms) to places and routes on list and preview screens. Now it
  jumps; only following the car moves smoothly (`SceneLayout.moveMs`, `SceneLayoutTest`).
- **NF-6 / VC-1:** Google's navigation page says Android Auto looks for the `NAVIGATE` filter on an
  **activity**; it was only on the car service. `NavigateActivity` now carries it (and on the phone
  just opens Wayfinder); the service filter stays. Tests: `NavigateActivityTest`, `carModule.test.ts`.

### Car app criteria, one by one (navigation, Android Auto)

Tier 2 is needed for open testing and production. AAOS-only criteria (PE-1, EP-4, DO-1, DL-1,
DL-2, LS-*) and those for other categories (media, messaging, video, games, browsers, POI, IoT,
weather) don't apply.

| ID | Status | Notes |
| -- | ------ | ----- |
| PC-1 | met | Search, routes, Discover nearby, turn-by-turn: all navigation |
| EP-1 | Play | The listing must describe what the car app does |
| EP-2 | met | A running trip comes back on connect; Home offers "Back to directions" |
| AR-1 | n/a | Templates only on the car; no activity draws there |
| SA-1 | fixed | Only the map following the car animates |
| AD-1, NA-1, PA-1 | n/a | No ads, no payments |
| IU-1 | met | Images are maneuver icons and the app icon only |
| VI-1 | fixed | "When it's safe" on every message that sends the driver to the phone |
| AC-1 | met | Every task is three screens (Home, list or search, preview); navigate requests pop to Home first |
| ST-1 | met | No scrolling text |
| VC-1 | fixed, needs device | NAVIGATE on an activity as well as the service; try Assistant on the DHU |
| DR-1 | met, needs device | Go shows "Starting…" at once; lists show loading; measure on the DHU |
| DR-2, DR-3 | needs device | 10 s launch and content load |
| VD-1 | needs device | Maneuver icons are host-tinted vectors; check contrast day and night |
| TH-1 | n/a | Car App Library 1.7, no custom theme |
| DD-1 | met | Navigation audio (`USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`, transient may-duck) only for spoken directions |
| IN-1 | met | Only the navigation notification, only during a trip |
| NF-1 | met | Turn-by-turn on `NavigationTemplate` |
| NF-2 | met, needs device | Surface draws only map, route and position within the visible area |
| NF-3 | met (now with permission asked), needs device | One ongoing `CarAppExtender` notification |
| NF-4 | met | `updateTrip` with step, road and destination estimates |
| NF-5 | met, needs device | `onStopNavigation` ends the trip: voice, notification and `updateTrip` stop |
| NF-6 | fixed, needs device | `geo:` points and queries, from onCreateScreen and onNewIntent |
| NF-7 | met | `onAutoDriveEnabled` test drive, records nothing |
| MR-1 | met | `isDarkMode` picks the dark style; redrawn on configuration change |
| NF-9 (Tier 1) | open | Cluster map; optional |

Play policy items: target SDK 36 (met); `FOREGROUND_SERVICE_LOCATION` with the service's
`foregroundServiceType="location"` from expo-location (met); background location disclosure
(fixed); `POST_NOTIFICATIONS` (fixed). The background location declaration form and video are
the owner's ([play-store-android-auto.md](play-store-android-auto.md)).

## Still open

- **NF-9 (map on the cluster, Tier 1):** not started; it needs the owner's go-ahead.
- **Smaller car app items:** DR-1/DR-2/DR-3 timings, NF-2, NF-5, VD-1 and the new VC-1/NF-6 activity filter all need a head unit.
- **Starting navigation from the car with the phone app in the background** starts a location
  foreground service from the background; Android 14 may refuse it with only "while using"
  permission. Directions still come from the location watch while the process lives; check on a
  device (verification.md has the item).
- **Contacts:** read only after the person turns on contact search, whose description explains
  it. Play may still want a separate disclosure before the contacts prompt if the reviewer judges
  the address lookup unexpected; low risk, not built.
- **Phone gaps: context menus (`T-Context_Menus`) and content zoom (`T-Content_Zoom`)** are not built.

### Needs measuring, not changing

These need a device or the Play pre-launch report, and no code change is known. Record results in
[verification.md](verification.md).

| Test                                                                        | What to check                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T-App_Startup_Time`                                                        | A progress cue if loading takes over 2 seconds (the first map load on a slow connection)                                                                                                                |
| `T-Rendering_Performance`, `T-StrictMode_Compliance`, `T-Stability_ANR`     | 60 fps while the Navigate map moves; no StrictMode red flashes; no ANRs. Once on Play, the pre-launch report and Android vitals cover stability                                                         |
| `T-Power_Management`                                                        | Background tracking and a navigation trip through Doze and App Standby (already listed under "Open / manual" in verification.md)                                                                        |
| `T-State_Preservation`, `T-Sleep_Resume`, `T-Lock_Resume`, `T-App_Switcher` | Leaving and returning, locking and unlocking, and relaunch from Home mid-trip, from every screen                                                                                                        |
| `T-Visual_Contrast`, `T-Content_Description`                                | Run Google's Accessibility Scanner over every screen: 4.5:1 text contrast and a description on every icon-only control                                                                                  |
| `T-Production_Build_Quality`, `T-SDK_Maintenance`, `T-Compile_SDK_Version`  | No debug libraries in the release build, dependencies up to date, and the compile SDK matching the target SDK (the target is 36, confirmed in the built manifest)                                       |
| `T-Background_Service_Optimization`                                         | Always-on location is the core feature and Google lists "keeping the GPS powered on" as a poor use of a service. Keep it behind the Settings switch and justify it in the Play background-location form |

### Already met, or not applicable

- **Met:** no personal data in logs (no `console.*` in `app`/`src`, no `Log` calls in the car
  module); runtime permissions are asked for when used (tracking from Settings, contacts only when
  switched on, location at search and navigate); all manifest components set `android:exported`
  explicitly; cleartext traffic off; tokens in secure storage; spoken directions take audio focus
  as navigation guidance (`NavVoice`, used by the phone too, with Expo's speech as the fallback);
  light and dark themes; targets API 36.
- **Not applicable today:** WebViews (none), the Android Sharesheet (the app shares nothing),
  video and audio playback, camera and media projection, in-app purchases, messaging notifications,
  drag and drop.
- **Not pursued:** adaptive Tier 1 (desktop windowing, foldable postures, stylus extras, camera and
  audio). Revisit only with a reason to.

## Before you start

- Read [architecture.md](architecture.md#android-auto), which explains the bridge between the
  Kotlin car screens and the JavaScript side, and [testing.md](testing.md) for where tests go.
- The car criteria were checked against the full pages on 2026-10-02 (table above). The core and
  adaptive pages were read through summaries only; adaptive Tier 1 was not read.
- Several fixes here (gaps 4 to 6 and 9) change how the phone app behaves for existing users. Ask
  the owner before landing them, and build an APK to try on a phone and a tablet emulator first.
- No coverage floor drops and no test is skipped to land these (CLAUDE.md). `pnpm check` must pass.

## When a gap is fixed

Update, in the same change: this file (move it to a "Fixed" line with the date, or delete it when
empty), the matching feature row in [testing.md](testing.md), the car section of
[architecture.md](architecture.md#android-auto) for anything that changes a flow, and tick or add
the matching item in the Android Auto checklist in [verification.md](verification.md).
