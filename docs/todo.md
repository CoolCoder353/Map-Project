# To do

Improvements users would notice, picked from a survey of the project on 2026-11-03; the other seven
picked then were done the same day (see verification.md). Each has what users see today, where in
the code, and a rough size. Line numbers are as of that date. Take an item
off this list when it ships, and record it in [verification.md](verification.md).

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
