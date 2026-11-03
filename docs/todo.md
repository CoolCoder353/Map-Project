# To do

Improvements users would notice, from a survey of the project and the drives on 2026-11-03; the others
picked then are done (see verification.md). Each has what users see today, where in
the code, and a rough size. Line numbers are as of that date. Take an item
off this list when it ships, and record it in [verification.md](verification.md).

## Android Auto with the phone locked: what's left

- **Today:** with location allowed only while using the app, a trip started from the car while locked
  has no phone GPS and relies on the car's position, and it has no "Navigating to …" notification until
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
