# To do

Improvements users would notice, picked from a survey of the project on 2026-11-03; the other seven
picked then were done the same day (see verification.md). Each has what users see today, where in
the code, and a rough size. Line numbers are as of that date. Take an item
off this list when it ships, and record it in [verification.md](verification.md).

## A new route can ask for a turn the car has already reached

- **Today:** on the 3 November drive, replaying the requests shows a new route from a car doing 55
  km/h on Gordon Street can start "Continue 10 m, turn left", too close to make, so it goes off route
  again seconds later (requests 8 s apart). The answer also flips between routes from one second to
  the next (1,008 m, then a 612 m one with a U-turn).
- **Where:** `fastestRoute` in `packages/core/src/services/routing.ts`, `reroute` in
  `apps/mobile/src/nav/navigationService.ts`. The replay used where the trip ended, not its real
  destination, so check it against a drive first.
- **Size:** medium. Car, phone.

## Screenshot of the car screen with a report

- **Today:** a one-tap report from the car has words only (a tester's idea, 3 November). Whether the
  car app can capture its own screen hasn't been looked into; the map it draws may be all it can get.
- **Where:** `apps/mobile/src/car/handlers.ts` (the report), `apps/mobile/modules/wayfinder-car`.
- **Size:** unknown until that's checked. Car, server.

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
