# Android Auto with the phone locked

What Wayfinder can and can't do in the car while the phone is locked. Written 2026-11-03 about app
0.5.8; **Fixed since** says what later changes altered, and the rest of the page describes 0.5.8
unless it says otherwise. **None of this has been run on a phone with Android Auto and the phone
locked on purpose:** no such device was attached. Each finding says what it rests on.

## Fixed since (app 0.5.9)

- **The phone's GPS listener now starts even when the location service is refused,** so someone who
  allowed location all the time should get phone positions on a trip started from the car. The service
  is tried again when an app screen next shows, which also brings the "Navigating to …" notification.
- **JavaScript timers now keep running** for the length of a trip (test drives too) and while the car
  app is open, through a headless task that does nothing and ends when its promise resolves
  (`src/lib/keepTimers.ts`, `ReactBoot.keepTimersRunning`). That covers every row of the timer table
  below. The cost is a timer check on each frame while it runs, so a little more battery with the
  screen off. **Checked on the Android 16 emulator, 2026-11-03,** on a test build with simulated GPS:
  a trip with the screen turned off at 04:17:04 and the app's activity stopped (the log shows
  `wm_on_stop_called`) uploaded at 04:17:29, 04:18:29, 04:19:29 and 04:20:29, every 60 s. The emulator
  has no Android Auto, so the car-session case and test drive haven't been run.
- **Still open:** with location allowed only while using the app, a trip started from the car while
  locked has no phone GPS and relies on the car's position, and whether a location service can start
  from the car at all still needs a phone in a car.

## Since 0.6.0

- **Home with no trip** follows the car on the car's own GNSS, which needs nothing from the locked
  phone, with the speed and the road's limit; the phone's GPS is only a fallback for a car that gives
  no position, and with location allowed only while using the app it likely gives none while locked.
  The limit and the saved places (Home first) come through the phone's JavaScript and its connection,
  as everything else on the car does. Checked by tests only; not yet seen in a car.
- **A trip keeps listening to the phone's location in the car app** (feedback 2026-11-06, two reports from
  0.6.0: "Still finding where you are" with Home following the car fine). Home's map had the phone's GPS
  as a fallback for a car that gives no position, but it stopped listening when the trip took over the
  screen, so a car without GNSS left the trip with no position source once the phone's own GPS wasn't
  running. The fallback now runs for the length of a trip too (`TripFixes` in `IdleFixes.kt`), sending
  the phone's fixes only while the car is silent. Checked by tests only; with location allowed only
  while using the app and the phone locked, Android may still give the car app nothing.

## Since 0.7.2 (2026-11-13; in app 0.7.3, on internal testing 2026-11-14)

Three faults found from the live server's log of 13 November (0.7.2) and the code. That morning the
car's Home ran for three drives (8:33, 11:28 and 12:29 am/pm) with its map following the car and
not one request for a route, a search or Discover; in the last, every position the map asked a
limit for was one of the same few points, some seen an hour before, up to 300 m off the road and
with no heading. **None of this has been seen on a phone:** none was attached.

- **A trip started with no app screen asked for location permission it already had.** Asking needs
  a screen. With none (opened from the car, the phone locked or the app never opened), Expo
  answers "denied", and behind a locked screen may never answer. The trip then said "Navigation
  needs location permission" or sat with no phone GPS: neither the listener of 0.5.9 nor the GPS
  watch was started. The trip now reads the permission first and only asks when it isn't granted
  (`navigationService.ts`).
- **The car session's own listener got Wi-Fi and mobile-tower positions, not GPS.** It asked
  Android's fused provider the old way (name, interval, distance), which Android 12 and up treat
  as "balanced power". With an app screen up Expo's GPS watch was running and the listener got its
  fixes; with the phone locked nothing had GPS on. It now asks for high accuracy
  (`LocationManagerFixSource.request`), and a phone position rougher than 100 m isn't used, as
  one from the car isn't (`IdleFixes`).
- **Planning from the car asked the phone where it was, though the car's map already knew.** With
  no trip, positions the car session had from the phone drew the map but never reached JavaScript,
  so Search, Saved places, Discover and Go's plan asked Expo for a position again, which a locked
  phone may not give within the 8 s allowed ("Can't tell where you are"). Every phone position the
  car session uses now goes to the phone app too, as the car's GNSS ones always did, so planning
  starts from where the car's map shows you. This is the likely cause of not being able to start
  a route while driving (the phone is in a pocket then, and in the hand when parked); it isn't
  proven, as nothing recorded what the driver tapped.

From a scan of the code between the phone and the car the same day, also fixed (tests only):

- **A plan asked for on the move starts the way the car is going.** The car's plan sent no
  heading, so a route could begin behind a moving car and the trip was off its route at once. The
  heading of the last position, if under 5 s old and the car is moving, goes with the plan, and
  the server starts every route that way (it needs the server deployed; an older server ignores
  it). The live routing engine accepts a heading with alternatives, detour models and via points.
- **A car position dropped as old no longer sets the phone's aside.** A car whose clock runs
  behind the phone's had its positions dropped and the phone's ignored too.
- **Positions keep coming on every car screen,** not only Home (`WhileShowing`), so a plan from
  Search or Saved places a minute after leaving Home still knows where the car is.
- **One trip update the car can't read is not the trip ending:** the car keeps what it last read.
- **With no trip, a position with no heading gets one from movement,** so the limit is looked up
  for the way the car is going, not the way it was going six minutes ago.
- **Home asks the phone for places every 2 minutes while moving,** not every 30 s.
- **The phone's Plan tab no longer plans again every 200 m of a trip** it sits behind.

To check on a phone: steps 1 and 3 below, and plan from Home while a drive is replayed with the
phone locked.

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
