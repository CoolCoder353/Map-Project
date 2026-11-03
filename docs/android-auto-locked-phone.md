# Android Auto with the phone locked

What Wayfinder can and can't do in the car while the phone is locked, as of 2026-11-03 (app 0.5.8
plus the changes in the same commit as this page). **None of this has been run on a phone with
Android Auto and the phone locked on purpose:** no device was attached. Each finding says what it
rests on.

## The short version

- **A trip started on the phone, then locked, works.** Directions and GPS keep going. Uploads and
  anything else on a JavaScript timer stop until the trip ends or the app is opened.
- **A trip started from the car with the phone locked runs without the phone's GPS.** The
  location service is refused, and the error also skips the phone's own location listener. Directions
  then depend entirely on the car giving its position, and there's no "Navigating to …" notification
  on the phone.
- **JavaScript timers don't run unless an app screen is showing,** which is wider than "locked": a
  car-only start with the phone unlocked on its home screen is the same. Test drive, which Google's
  reviewers use, runs on one of these timers.

## What happens in each case

| With the phone locked | Started on the phone, then locked | Started from the car, locked |
|---|---|---|
| Car screen, map, turn card | Should work | Should work |
| Location for directions | Phone GPS through the service (seen working) | **Car's GPS only**; nothing if the car gives none |
| "Navigating to …" notification on the phone | Yes | **No** |
| Next-turn notification in the car | Yes | Yes, with notification permission |
| Spoken directions | Should work | Should work |
| New route when off route | Yes | Yes, while the car gives positions |
| Trip uploaded during the drive | **No**, all at the end (kept on the phone until then) | **No**, all at the end |
| "Usually about 20 s more" counting down at lights | **Stops** while no positions arrive | **Stops** while no positions arrive |
| Search, Discover, Planned routes, planning | Yes | Yes |
| A slow or failed server call | **Says "phone isn't answering"** after 45 s, not "no connection" after 30 s | Same |
| Test drive | **Doesn't move** once locked | **Doesn't move** |
| Report from the car | Yes | Yes |
| Signing in, granting a permission | Needs the phone unlocked | Needs the phone unlocked |

"Should work" means nothing in the code depends on the lock, and it hasn't been seen on a device.

## Findings

### 1. A trip started from the car gets no location service and no phone GPS

*From reading the code of `expo-location` and this app.*

`startNavigationLocation` (`apps/mobile/src/nav/navigationLocation.ts`) first calls
`Location.startLocationUpdatesAsync` with a foreground service. `expo-location` refuses that unless
an app screen is on show (`LocationModule.kt`: `!AppForegroundedSingleton.isForegrounded` throws
`ForegroundServiceStartNotAllowedException`). Only activities set that flag, so a car session never does.

The throw leaves `startNavigationLocation` before it adds the `onPhoneFix` listener and calls
`watchPhoneLocation()`, and `navigationService` ignores the failure. So:

- no foreground service, and no "Navigating to …" notification;
- no `PhoneLocation` fixes, even for someone who has allowed location all the time;
- directions come only from `CarLocation`, which needs Car API level 3 and a car that reports its
  position. Without one, the trip waits at "Finding where you are…".

Google's documentation says removing `expo-location`'s check wouldn't be enough by itself: on Android
14 and up, a location foreground service must be started while the app has a visible activity, and
its list of exemptions doesn't mention Android Auto. Whether the Android Auto host's binding gives
the app that right in practice is **unknown and needs a device**.

The checklist in [verification.md](verification.md) expects the notification in this case ("Cold
start from the car … the 'Navigating to …' notification appears"). From the code, it will fail.

### 2. JavaScript timers stop whenever no app screen is showing

*From React Native 0.86.3's source, with one drive that fits it. It wasn't observed directly on a phone.*

`JavaTimerManager.kt` starts paused, pauses in `onHostPause`, and only resumes in `onHostResume` or
while a headless JS task runs. `setTimeout` with a delay and `setInterval` never fire in between; a
zero-delay `setTimeout` still does. Events, `fetch` and promises carry on, so JavaScript isn't asleep:
it runs whenever something native calls it. Kotlin's timers are unaffected.

The drive of 2 November (08:44–09:24 UTC, trip `f7e1a5c3`) fits this. Uploads came on the minute until
09:12:41, then none for 12 minutes while points kept being recorded at 60 a minute, then 709 points
at once at the end of the trip at 09:24:47. Nothing recorded whether the phone was locked for that
stretch, so this is consistent with it, not proof. It does show location and navigation carrying on
with the timers stopped.

| Timer | What goes wrong |
|---|---|
| `uploader` in `navigationService.ts` (60 s) | Nothing is uploaded until the trip ends. Points are safe in the phone's queue |
| `ticker` in `navigationService.ts` (1 s) | The wait at the lights stops counting while stopped, as the phone sends no fixes standing still |
| `later(FIRST_FIX_WAIT_MS)` in `navigationService.ts` | "Still finding where you are" never appears |
| `setTimeout` in `apiClient.ts` (30 s) | Server calls don't time out, so the car's 45 s limit says the phone isn't answering when the real trouble is the connection |
| `within()` in `car/handlers.ts` (8 s) | Planning with no recent position can wait the full 45 s for a fix instead of giving up after 8 s |
| `setInterval` in `car/simulation.ts` | **Test drive doesn't move.** Google's reviewers use auto drive (quality item NF-7), so check this before the Android Auto review |

Already allowed for: giving up on a new route, and ending the trip after arriving, are both checked
as fixes arrive.

### 3. Some limits belong to the phone, not the app

*From other sources; not checked on a device.*

- **After a restart, until first unlocked:** Android keeps an app's normal storage encrypted, and this
  app's sign-in and queue live there. Testers report needing one unlock after a restart. Android can
  also restart a phone by itself after 3 days locked.
- **Samsung, One UI 7 (Android 15) and up:** Samsung says Android Auto won't start once the phone has
  been locked for over an hour, and to unlock it before connecting by USB. An app can't change this.
- **A driver can't fix anything from the car:** signing in and granting location or notifications need
  the unlocked phone. The car's messages already say "When it's safe".

## What to do about it

Fixes are listed in [todo.md](todo.md). In order:

1. **Add the phone's location listener even when the service is refused** (small). With "allow all the
   time" this may bring phone GPS back to car-started trips. Test on a device.
2. **Keep JavaScript timers running during a car session or trip** (medium). React Native's own route
   is a headless JS task, which `JavaTimerManager` already treats as a reason to run timers. This fixes
   every row of the timer table at once, including test drive.
3. **Find out whether a location service can start from the car** (needs a device). If it can't, say on
   the phone's trip and in the docs that car-started trips use the car's position.
4. **Correct the checklist** once 1 to 3 are settled.

## Checking it on a phone

Takes a phone with Android Auto over USB, using the release APK and the Desktop Head Unit
([build-android.md](build-android.md)).

```bash
adb logcat | grep -E "Foreground service started from background|ForegroundServiceStartNotAllowed|WayfinderCar"
```

1. **Lock, then open from the car.** Force-stop Wayfinder, lock the phone, open it from the car, start
   a trip. Look for the phone's notification, and whether directions follow while the car gives no
   position.
2. **Start on the phone, then lock.** Note the time, drive for five minutes, and look at
   `track_batches.received_at` for that trip: no uploads until the end confirms the timers finding.
3. **Test drive.** Start it from the car with the phone locked, then with the phone on its home screen.
4. **Weak signal.** With no signal and the phone locked, ask for a plan: which message comes, and when.
5. **Locked for over an hour,** on a Samsung, then connect.

## Sources

- [Build a navigation app (Car App Library)](https://developer.android.com/training/cars/apps/navigation)
- [Restrictions on starting a foreground service from the background](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Samsung: unlocking for Android Auto on One UI 7](https://www.samsung.com/ae/support/mobile-devices/why-do-i-need-to-unlock-my-phone-for-android-auto-to-work-when-connecting-via-usb-in-one-ui-7/)
- [Testers' reports of unlocking once after a restart](https://forum.fairphone.com/t/fp5-android-auto-not-working-after-screen-lock/119372)
- [Android's automatic restart after 3 days locked](https://9to5google.com/?p=662778)
- In this repository's dependencies: `JavaTimerManager.kt` (react-native 0.86.3), `LocationModule.kt` (expo-location)
