# Google Play listing

`pnpm play listing` sends the text in `listing/<language>/` (title, short and full description),
the two graphics below and, once there are some, the PNGs in `screenshots/phone/` (2 to 8, in
file-name order). Edit the files here, not in Play Console, or the next sync undoes the change.

## Graphics

| File | Size | Notes |
| --- | --- | --- |
| icon-512.png | 512x512 PNG, no alpha | Square, no rounded corners or shadow (Play applies the mask). Redrawn as vector from the launcher icon (arrow and two dots on #1765cc), because `apps/mobile/assets/icons/play-store-icon.png` has baked-in rounded corners. |
| feature-graphic.png | 1024x500 PNG, no alpha | "Wayfinder" and "Find the roads you haven't driven" on #1765cc, with the arrow and a dotted road trail. No hexagons, device frames or third-party marks. |

Rendered with `rsvg-convert` from SVG; font is whatever sans-serif the machine resolved (Roboto-like fallback).

## Background location video

`background-location.mp4` (34 s, 720x1600) is the demo video for Play's background location
declaration. Recorded 2026-10-04 on the emulator with app 0.4.0 (versionCode 5) against the live
server, signed in as the reviewer account, with a mock location in Brisbane and taps shown. It
shows: Settings → Location history → Background tracking; the in-app "Use your location in the
background?" disclosure; Continue; Android's location prompt (While using the app); Android's
location page (Allow all the time); the notification prompt; the switch on; then, from the home
screen, the "Wayfinder is recording your travels" notification. Play wants a YouTube link: upload
it as Unlisted and paste the link into the declaration.

## Still missing

- Phone screenshots (2-8 required). Skipped: no `adb` or Android emulator on this machine. Capture from the APK (`dist/wayfinder.apk`) once an emulator or device is available, signing in with the reviewer account in `infra/android/play-review.env`.
- Optional: 7-inch and 10-inch tablet screenshots, and a promo video.
