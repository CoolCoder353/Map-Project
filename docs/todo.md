# To do

Improvements users would notice, from a survey of the project and the drives on 2026-11-03; the others
picked then are done (see verification.md). Each has what users see today, where in
the code, and a rough size. Line numbers are as of that date. Take an item
off this list when it ships, and record it in [verification.md](verification.md).

## First run of the device harness on a phone (start here for any Android Auto check)

- **Today:** `pnpm device` (development.md, "Device harness") is built, tested and documented, the
  server has test accounts (deployed 2026-11-09) and app 0.6.1, which it needs, is on Play's
  internal track. It has never run on a real phone or the head unit. Every Android Auto check below
  waits on this.
- **Needs from the phone's owner, before Claude starts:**
  1. A Wayfinder account for Claude on `maps.coolcodertech.com`, made an admin, with **Test
     account** switched on on its `/admin` user page. They sign it in; Claude never handles its
     password.
  2. The phone on Wayfinder 0.6.1 (versionCode 17) from internal testing, plugged in by USB with
     USB debugging allowed, and Wayfinder signed in to that account.
  3. In Android Auto on the phone: developer settings (tap the version ten times), **Unknown
     sources** on, and **Start head unit server** from the ⋮ menu.
- **Then, in order:**
  1. `pnpm device devices`, `pnpm device register <serial>`, `pnpm device account <email>`,
     `pnpm device up --car --window`. If anything refuses, follow its message; don't work round it.
  2. Two things never checked on a phone. Phone GPS: `pnpm device gps 153.0251 -27.4698`, then
     `pnpm device shot phone` shows the map at the Brisbane CBD; if the phone refuses
     `cmd location providers`, make `gps` and `drive` move only the car on real phones (with a
     test) and say so here. Car taps: `pnpm device car key navigation`, `pnpm device tap car 400 240`
     works; with the dialler open on the car (opened by the person, in the DHU window),
     `tap car` must refuse. If it doesn't, stop building on car taps and tell the user.
  3. `pnpm device drive scripts/device/routes/brisbane-to-mt-coot-tha.geojson --speed 60`, taking
     `shot car` and `shot phone` while it runs; `pnpm device logs` for crashes.
  4. `pnpm device down`: says "Signed out of …"; `adb shell dumpsys location | grep -i test` shows
     no test provider (`providers list` doesn't exist on Android 16); the head unit has quit. Tell the owner they can sign back in to their own
     account.
  5. Record the run in verification.md (date, phone, what passed), tick only the Android Auto
     items actually seen working, then work through the rest of that checklist with the harness.
- **Second phone run done (2026-11-10, 0.7.0):** see the "Second run" section of
  [device-test-2026-11-09.md](device-test-2026-11-09.md). Its findings are fixed in code
  (see that section); the next run should check by eye that a replayed drive now moves the phone's
  trip (`pnpm device logs` says "car location: following the car's position") and that no turn
  card covers the car's directions at a trip's start.
- **First phone run done (2026-11-09):** see [device-test-2026-11-09.md](device-test-2026-11-09.md).
  It worked over wireless debugging (`adb pair`, then register the `ip:port` serial); USB dropped
  every few seconds. Fixed since (2026-11-10): H2–H9, H12–H16 (it no longer fakes a phone's own
  GPS at all; drives move the car). Still open: H1 (USB), H10 (no audio from the head unit), H17
  (car lists can't be scrolled). Most of the phone and car findings are fixed; the report's
  "Fixed on 10 November" section says which, and why the rest aren't.
- **Already checked (2026-11-09, emulator):** 0.6.1 opens with no crash and `pnpm device ui`
  recognises the sign-in screen. Android Auto itself doesn't run on an emulator: Play refuses to
  install it there (the spike is in docs/superpowers/specs/2026-11-09-device-harness-design.md).
- **Size:** an hour with the phone. Car, phone.

## Android Auto with the phone locked: what's left

- **Fixed in 0.7.3 (internal testing 2026-11-14), to check on a phone:** a trip started from the car no longer asks for
  location permission it has, the car session asks for GPS accuracy, and planning uses the car
  session's positions. With the phone locked: plan and Go from Home during a replayed drive, and
  look for "Navigation needs location permission" and for the map jumping between a few points.
- **Today:** with location allowed only while using the app, a trip started from the car while locked
  may have no phone GPS and rely on the car's position, and it has no "Navigating to …" notification until
  the app next shows. Whether Android lets a location service start from the car at all is unknown.
  What's fixed and what isn't: [android-auto-locked-phone.md](android-auto-locked-phone.md).
- **Where:** `apps/mobile/src/nav/navigationLocation.ts`.
- **Needs:** a phone in a car, or with the head unit. Car, phone.

## A new route can still flip between answers

- **Today:** replaying the 3 November drive, the answer changes from one second to the next (1,008 m,
  then a 612 m one with a U-turn). Turns too close to make are now left out; this isn't.
- **Where:** `fastestRoute` in `packages/core/src/services/routing.ts`. The replay used where the trip
  ended, not its real destination, so check it against a drive first.
- **Size:** medium. Car, phone.

## Checks on a device and the head unit that have never been run

- **Today:** the whole Android Auto head-unit checklist is unticked, and several car fixes were made
  by reasoning from the code, not seen working (the car marker in the 2 November playtest, for
  one). Google's Accessibility Scanner (contrast, labels) hasn't been run, nor the 2026-10-28 phone
  checks on a device. The head-unit pass also blocks open testing.
- **Where:** [verification.md](verification.md) (Android Auto section, the 2 November playtest
  entry), [quality-gaps.md](quality-gaps.md) ("Needs measuring"),
  [play-store-android-auto.md](play-store-android-auto.md) (the head-unit row).
- **Size:** medium, mostly testing time. Car, phone.
- **Needs:** a phone with Android Auto and Accessibility Scanner from Play, over USB. The emulator
  here (`wayfinder`, a Google APIs image without Play) can't run either, and a Play image needs a
  Google account signed in on it. With a phone attached: `adb install dist/wayfinder.apk`, start
  the head unit (`~/Android/Sdk/extras/google/auto/desktop-head-unit --usb`), then work through
  verification.md's Android Auto list.
