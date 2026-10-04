# Google Play listing

`pnpm play listing` sends the text in `listing/<language>/` (title, short and full description),
the contact email and website in `details.json`, the two graphics below and, once there are some, the PNGs in `screenshots/phone/` (2 to 8, in
file-name order). Edit the files here, not in Play Console, or the next sync undoes the change. The category and
tags aren't in Play's API: set those in Play Console (Store settings).

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

## Phone screenshots

`screenshots/phone/` holds five, 1080x2160 (Play rejects a long side more than twice the short
one, so the emulator's 1080x2400 captures are cropped: status bar, 41 px of map, gesture bar).
Taken 2026-10-04 on the emulator with app 0.4.0 against the live server, signed in as the reviewer
account in Brisbane, with Android's status bar demo mode for a clean clock and icons:

1. `1-explore-routes.png`: directions to Mt Coot-tha Lookout, the fastest route and an explore route
2. `2-turn-by-turn.png`: navigating, "Turn right onto George Street"
3. `3-discover.png`: lookouts and parks nearby in areas not yet explored
4. `4-round-trip.png`: hour-long loops from Kangaroo Point Cliffs
5. `5-search.png`: place search with opening hours

Coverage isn't among them: the reviewer account's only long trip was simulated, came out as a
walk, and the screen opens zoomed in on one block.

## Still missing

- Optional: 7-inch and 10-inch tablet screenshots, and a promo video.
