# To do

Improvements users would notice, picked from a survey of the project on 2026-11-03. Each has what
users see today, where in the code, and a rough size. Line numbers are as of that date. Take an item
off this list when it ships, and record it in [verification.md](verification.md).

## Trip detail shows raw GPS, not the roads, and not which ones were new

- **Today:** a trip's map draws the wobbly raw points, and a trip that "found 6 new roads" doesn't
  show where they were.
- **Where:** the road-snapped line is stored (`trips.matched_geometry`, migration 005) but `getTrip`
  never returns it (`packages/core/src/services/tracks.ts:391-404`); the phone and web draw the raw
  points (`apps/mobile/app/trip/[id].tsx:24`, `apps/web/src/planner/TripDetailPanel.tsx:50-51`).
  The new roads can probably be found from `visited_ways.first_visited_at`, which takes the trip's
  own time (`packages/core/src/services/roads.ts:72-79`): roads first travelled between a trip's
  start and end. (Inferred; check before relying on it.)
- **Do:** draw the snapped line, falling back to the raw one; highlight the trip's new roads.
- **Size:** small for the line, medium for the new roads. Server, web, phone.

## Web: Discover says "Beache", and search is silent when nothing matches

- **Today:** the web makes a category's singular by cutting a trailing "s" ("Beaches" → "Beache",
  "Historic" stays "Historic" where the phone says "Historic site"), and passes the plural on as a
  destination's description. The web search dropdown only opens with results or an error, so a
  search that finds nothing shows nothing; the phone says "No places match …".
- **Where:** `apps/web/src/planner/DiscoverPanel.tsx:130,140` against the phone's `kindOf` in
  `apps/mobile/src/lib/categories.ts`; `apps/web/src/components/SearchField.tsx:176` against
  `apps/mobile/src/ui/PlaceSearch.tsx:195`.
- **Size:** small. Web.

## Phone: each tap of the extra-time + / − asks for explore routes again

- **Today:** every tap sends a request at once, with no pause and nothing cancelled. Late answers
  are ignored, but the 2 GB server still works each one out. The web waits 250 ms and cancels.
- **Where:** `apps/mobile/app/(tabs)/plan.tsx:76-104` and `:187`, against
  `apps/web/src/planner/DirectionsPanel.tsx:75-106`.
- **Size:** small. Phone (and server load).

## An explore trip turns into a "fastest" one after a reroute

- **Today:** a reroute fetches `/api/routes/fastest` and replaces the route, so its kind becomes
  `fastest` and the phone's turn banner flips from explore green to fastest blue mid-trip. The
  detour's remaining points are kept, so a driver who skips a detour on purpose keeps being sent
  back to it (inferred).
- **Where:** `apps/mobile/src/nav/navigationService.ts:216-220`; banner colour in
  `apps/mobile/app/navigate.tsx:104`.
- **Do:** keep the trip's kind through a reroute; offer "Skip detour, fastest from here".
- **Size:** small. Phone, car.

## The phone's turn icons are cruder than the car's

- **Today:** on the phone "keep left" shows a hard-left arrow, "keep right" and slight turns show
  straight ahead, and roundabouts use an anticlockwise icon with no exit. The car has keep, slight
  and sharp icons and draws roundabouts clockwise with the exit taken. The web's are different again.
- **Where:** `iconFor` in `apps/mobile/app/navigate.tsx:18`, against
  `apps/mobile/modules/wayfinder-car/.../nav/Maneuvers.kt` and `RoundaboutIcon.kt`;
  `apps/web/src/planner/RouteOption.tsx:7-19`.
- **Size:** small. Phone, web.

## Coverage that fails to load fails silently

- **Today:** the phone ignores the error and the web only logs it, so the map just looks empty, as
  if you'd been nowhere.
- **Where:** `apps/mobile/app/(tabs)/coverage.tsx:40` (`.catch(() => undefined)`),
  `apps/web/src/map/MapProvider.tsx:413`.
- **Do:** say it couldn't load, with a way to try again.
- **Size:** small. Phone, web.

## Phone navigation: no re-centre, and End ends the trip with one tap

- **Today:** the car has pan, zoom and Re-centre; the phone's map follows you but has no re-centre
  button, and dragging it probably stops the following for good (inferred). "End" stops the trip at
  once, with no confirm or undo.
- **Where:** `apps/mobile/app/navigate.tsx:182` (End); the map's follow mode in
  `apps/mobile/src/map/MapCanvas.tsx`.
- **Size:** small. Phone.

## Checks on a device and the head unit that have never been run

- **Today:** the whole Android Auto head-unit checklist is unticked, and several car fixes were made
  by reasoning from the code, not seen working (the car marker in the 2 November playtest, for
  one). Google's Accessibility Scanner (contrast, labels) hasn't been run, nor the 2026-10-28 phone
  checks on a device. The head-unit pass also blocks open testing.
- **Where:** [verification.md](verification.md) (Android Auto section, the 2 November playtest
  entry), [quality-gaps.md](quality-gaps.md) ("Needs measuring"),
  [play-store-android-auto.md](play-store-android-auto.md) (the head-unit row).
- **Size:** medium, mostly testing time. Car, phone.
