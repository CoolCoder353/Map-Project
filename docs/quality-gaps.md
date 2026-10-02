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

## Still open

- **NF-9 (map on the cluster, Tier 1):** not started; it needs the owner's go-ahead.
- **Smaller car app items:** DR-2/DR-3 launch time, NF-5 and NF-2 all need a head unit.
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
- This list was built on 2026-10-02 from the car navigation criteria, the core app quality page
  and the adaptive Tier 3 and Tier 2 pages, each read through a summary. **Fetch the full pages and
  check every criterion that applies**, including the car app's general (non-navigation) ones, in
  case something is missing. Adaptive Tier 1 was not read in full.
- Several fixes here (gaps 4 to 6 and 9) change how the phone app behaves for existing users. Ask
  the owner before landing them, and build an APK to try on a phone and a tablet emulator first.
- No coverage floor drops and no test is skipped to land these (CLAUDE.md). `pnpm check` must pass.

## When a gap is fixed

Update, in the same change: this file (move it to a "Fixed" line with the date, or delete it when
empty), the matching feature row in [testing.md](testing.md), the car section of
[architecture.md](architecture.md#android-auto) for anything that changes a flow, and tick or add
the matching item in the Android Auto checklist in [verification.md](verification.md).
