# Phone and Android Auto test run, 9 November 2026

First run of the device harness on a real phone: a Nothing Phone A059 (Android 16) on Wayfinder 0.6.1
(versionCode 17), signed in to the test account `test@test.com`, with Google's Desktop Head Unit 2.0
for the car screen, against `maps.coolcodertech.com`. About 90 minutes of hands-on testing on both
screens, plus reading the car module and the phone's navigation code where a screen pointed at a cause.

How it was run, and what limited it:

- USB kept dropping (H1), so the phone was driven over **wireless debugging**.
- Phone GPS couldn't be faked through the harness (H8, H18). Drives were replayed by mocking the
  platform "fused" provider and the head unit's location together; the route used is approximate,
  so some off-route behaviour comes from the replay leaving the road.
- Car taps needed a 1.16× correction (H16) and the right ~14% of the car screen couldn't be tapped,
  so the zoom buttons and the ✕ on cards weren't tested. Lists below the fold couldn't be scrolled (H17).
- No audio reaches the PC from the head unit (H10) and the phone's media volume was turned to 0 at the
  owner's request, so **spoken directions weren't heard**; voice findings come from the code.
- Nothing was reported to the server from the car. A saved place **Home = Bunnings Warehouse,
  Victoria Point** was created on the test account to test the car's Home row.

Each item says what was seen; "Code:" items were found or confirmed by reading the source.
P = phone app, C = Android Auto, H = the device harness and setup.

## The ones to fix first

- **C33** The car's route preview is empty (no route, no Go) whenever a trip has no explore
  alternatives, so many trips can't be started from the car at all.
- **H13** The harness's `gps`/`drive` replace the phone's real GPS for every app (Life360 and Home
  Assistant were listening on this phone).
- **P31 / P37 / P60** A 1.6 km drive credited 185 "new roads" and 11.5 km of coverage; bad or
  jumping fixes are recorded with no filter.
- **C15 / P61** After going off route on an explore trip, the new route drags you back to every
  remaining detour point (25 km trip became 57 km).
- **C1 / C21 / P16** Every new turn pops a heads-up notification over Wayfinder's own directions,
  on the car and on the phone.
- **C38** Directions are spoken even when audio focus is refused (during a phone call).
- **P8** "Explore 2" was faster than "Fastest".
- **P14** "Your location" is captured once and never updated: Plan, Discover and Round trip all
  plan from where you were, not where you are.
- **C74** Guessed traffic-light colours are drawn on the driving map as if real.
- **H4** (fixed in this change) The harness refused every phone tap while Android Auto was connected.


## Fixed on 10 November

Fixed in code with tests, `pnpm check` passing. None of it has been seen on the phone or the head
unit yet: the next harness run should check the top ones by eye. Server changes need a deploy, the
app ones a new build to internal testing.

- **Top of the list:** C33 (the preview's note now rides on the row's one line), H13/H8/H18 (the
  harness never fakes a phone's own GPS; drives move the car), P31/P34/P37 (a road match far longer
  than the drive credits nothing; the phone records no jumps or fixes worse than 50 m; trips
  already credited stay as they are), P60, C15/P61 (after a missed turn only detour points still on
  the way are kept), C1/C21/C60/P16/P88 (no heads-up while Wayfinder's directions are on the car;
  a low-importance channel on the phone), C38 (no speech while audio focus is refused), P8 (an
  explore route that comes out quicker becomes the fastest), P14/P94/P67 (Your location is kept
  current and routes follow it), C74 (no guessed light colours on the car).
- **Phone:** P1, P2, P3, P6, P11, P19/P65 (a "Voice directions are off" line), P26, P29, P38, P39,
  P40 (until a search runs), P41, P42 (after the next places import), P44, P46, P53, P55, P59, P62,
  P64 (the wait doubles, up to 2 min), P74, P75, P76, P77 (search ranks from where you are now),
  P78, P80, P81, P82, P90, P92, P93 (kept while the app runs), P95, P98.
- **Car:** C6, C9, C10/C50, C11/C51, C12/C52, C22, C23 (End takes a second tap within 5 s; Done
  doesn't), C28/C54, C29, C32, C35, C36, C37, C39, C40, C41, C42/C96 (Report first, End last, mute
  between), C43, C46 (and so C19 in part), C47, C48, C55, C56, C57 (100 routes kept), C59, C64,
  C68, C73, C76, C79/C87 in part (distance first; no drive time yet), C80, C81, C85.
- **Harness:** H2, H3, H4, H5, H6, H7, H9, H11 (todo.md's check), H12, H14 (moot), H15 (the car
  app re-logs "car screen shown" every 15 s), H16 (measured 1.16 scale; taps off the screen
  refused). H1 is documented: use wireless debugging.

## Fixed later on 10 November

Also in code with tests, `pnpm check` passing, and not yet seen on a device. Server changes (route
names come from the routes themselves, but drive-time bands, where trips ended, road dates, the
driving map style, search and loop shapes are the server's) need a deploy; the rest a new build.

- **Found from the code, to check on the device:** C2/C88 (the speed readout keeps a column at the
  left of the map and the car is centred in the rest), C5/C24/C27 (every map but the one following
  the car is flat and north up), C16 (the car's minutes are rounded as the phone's), C62 (a tap
  isn't a drag: the map keeps following), C63 (leaving the Navigate screen ended the trip; now only
  End or arriving does, and the car says when directions stopped on the phone), C71 (same
  message), C82 (Search offers your saved places and keeps what you typed), P24/P25 (the banner has
  the status bar and a light status bar; the screens under it leave the top to it), P85 (the
  driving map marks where navigation has you and follows it).
- **Layout and look:** P4 (the map steps aside while you type a place), P5 (Save this place comes
  after the routes), P7 (routes under place names), P12 (a bigger-map button), P15 (no second
  marker for Your location), P20 (place dots only where their names show), P21/P86 (the route and
  turn banner are blue on every trip, as in the car), P22 (End asks in the app's own bar), P27 (the
  driving map turns with you), P28/C18/C92 (no bus stops anywhere; no buildings, place dots or
  light markers while driving), P35 (the back button sits on the trip map), P45 (one round − and +
  everywhere), P47/C30 (pins numbered as their cards, a tap goes to the card; overlapping car pins
  share one badge), P48 (more room round Discover's results), P50 (Plan scrolls to the top for a
  trip from Discover), P56 (Sign out beside the account), P57 (a shorter budget line), P68 (only
  the chosen loop is green), P96/P99 (a key on Coverage; a tapped road says when you travelled
  it), P100/C77 (the map credit moved clear), C4 (Planned routes only when there are some), C17
  (the road driven is the route's blue, faded), C49 (the search key shows results on the map), C70
  (night colours for the car's own drawing), C89 (a short "then" line), C91 (bigger, lighter
  street names), C93 (long names cut to one line).
- **Features, done with the obvious choice:** P10/C94 (explore routes named by the road that sets
  them apart, "Via Moggill Road"), P23/P63/P97 (a summary when a trip ends, with Resume, and a note
  when nothing was recorded), P32 (the trip map draws the GPS as recorded), P33 (where each trip
  ended), P36 (start and end times in the list), P43 (drive-time bands in Discover, phone and car),
  P54 (a Voice directions switch in Settings), P69 (a loop over time says by how much), P72 (walks
  keep off main roads; out-and-back loops only when nothing better), P83/P84 (a route starting
  elsewhere asks first; arriving shows where you are, not "0 min"), C13/C34 (a start marker),
  C14 (Plan says when directions are running), C45 (a phone trip keeps what the car was showing),
  C26, C31/C53 (car Discover uses the phone's time and kinds of place), C58, C65/C97 (the car waits
  25 s, the phone 15 s for the server), C66, C67 (the car map opens where you last were), C69 (the
  speed box turns red, with one chime), C72/C75 (a choice when the Assistant's name fits several
  places; an unnamed point is looked up), C78 (Home asks again every 30 s), C84/C86 (the test drive
  follows a real route at the route's own speed), C95 (a hint, once, that other routes can be
  chosen), C98 (Directions from Search and Discover), C99 (a saved place's address in the title),
  C100/P30 ("take route 32", "take the M3").
- **Search:** P73 ("1 George St Brisbane" finds the city's George Street first), P79 (one name for
  hardware shops).
- **Harness:** H17 (`car scroll up|down` and `car select` on the rotary controller).

## Still not fixed, and why

- **C90 (lane guidance):** left out, as asked.
- **P58, in part:** voice and light/dark map colours are in Settings. Not done: avoiding tolls and
  unsealed roads (the routing graph has no toll or surface data until it is rebuilt with them),
  avoiding motorways (it would take the fastest route off its fast path, too slow for the small
  server), and units (Australia uses kilometres only).
- **P89/P91, in part:** End and Mute are on the turn notification while the car is connected. A
  phone-only trip's notification is the location service's, which can't carry buttons or change
  once started; it now says where the trip goes.
- **C16, in part:** the minutes now match; "hr" against "h" is how Android Auto writes durations.
- **H10, in part:** this PC has no sound device, so the head unit still plays nothing; each spoken
  direction is in `pnpm device logs` instead.
- **Checked, no change:** C44 (a trip running when the car connects goes straight to its
  directions; not reproduced), C83 (Android Auto's own panel; the harness's taps now land where
  aimed), P66 (TalkBack lists a scroll view's hidden rows and scrolls to one before using it; a
  plain tap there is on the map, as it should be), P70 (the place names cut at the map's edge are
  the map's own; no padding avoids them).
- **By design, kept:** P9 ("1 h"), P13, P17, P18/C3 (the grey ring marks an estimate; the
  screen-reader label says so), P49 (Discover's reach is a drive-time area, a route's time can be a
  minute over), P51, P52, P71, P87 (the foreground service needs its own notification), C7/C8
  (the car's search rows now carry distance first; ranking is the server's, improved for P78),
  C20, C25, C61 (the ✕ on the time card is Android Auto's own).

## Phone app (100)

- **P1** Plan opens on central Australia (OVERVIEW 134.5,-27.5 z3.6) even with location granted and a fresh fix; for a Queensland-only server the map is an empty desert showing "QUEENSLAN" cut off. Should start at the user's position or the server's region.
- **P2** No "my location"/recentre button on the Plan map.
- **P3** Map's accessibility label is MapLibre's default English "Showing a Map created with MapLibre. Scroll by dragging two fingers…" — not Wayfinder copy and wrong (one finger drags).
- **P4** Search: the keyboard covers all but the top edge of the first result; the sheet doesn't move above the keyboard. You must dismiss the keyboard to see results.
- **P5** After picking a destination the route cards are below the fold: "Save this place as Home/Work/Other…" sits between the destination and the routes, pushing Start off screen.
- **P6** Route-fit puts the destination marker on the map edge: "Mount Coot-tha" label cut to "ount Coot-tha", "Clevelan" cut; fitBounds padding too small.
- **P7** Route line drawn over the "Brisbane" place label ("Br sbane").
- **P8** "Explore 2" (52 min) is faster than "Fastest" (53 min). The fastest route isn't the fastest; explore card shows no time difference at all.
- **P9** "Explore 1" time shows "1 h" — rounding a 60-min trip loses minutes; elsewhere it's "53 min". Use "1 h 0 min"/consistent format.
- **P10** Explore routes named "Explore 1", "Explore 2": nothing says which way they go (via which road/suburb).
- **P11** Save-place chips appear for a locality ("Mount Coot-tha" suburb) — offering to save a whole suburb as Home/Work.
- **P12** Map area is fixed ~35% of the screen; scrolling the sheet doesn't give the map more room and the selected route can't be inspected larger.
- **P13** Two route cards share the same green chip "38 km you've never been" equal to their whole length - new account: novelty chips add nothing; maybe hide when 100%.
- **P14** Plan's "Your location" start is resolved once: after the phone moved 30 km (blue dot at CBD), the start marker labelled "Your location" and all three routes still start from the old place; no refresh.
- **P15** The route-start marker for "Your location" is a hollow white ring separate from the blue location dot; with a stale start you see two "you" markers.
- **P16** During navigation the phone shows a heads-up notification for each turn on top of the app's own turn banner, hiding it, while the app is open.
- **P17** First instruction offers "Skip the detour" seconds after the person deliberately chose an explore route; "detour" frames the chosen route as a mistake.
- **P18** An inferred speed limit ("probably 50 km/h, no sign mapped") differs from a mapped one only by a grey instead of red ring; nothing on screen says it's a guess (only the screen-reader label).
- **P19** Voice guidance starts muted (button says "Unmute voice") with no hint that voice is off.
- **P20** Unlabelled orange dots are scattered across the map (phone and car); nothing explains them and they look like POIs you can't tap.
- **P21** The navigation route is green-dashed on the phone and solid blue on the car for the same route.
- **P22** "End this trip?" uses the system AlertDialog with ALL-CAPS buttons ("KEEP GOING", "END TRIP"), unlike the app's own style.
- **P23** After ending a trip the Plan screen goes straight back to the same routes, with no summary of the trip just ended and no "trip saved" feedback.
- **P24** "Navigating to …" banner is followed by an empty black strip (~55 px) before the map.
- **P25** "Navigating to …" banner sits under the status bar: the clock and icons are drawn on the blue banner with low contrast.
- **P26** Phone draws a straight light-blue line from the old position to the new one across 30 km after a jump (the trail joins points that were never driven).
- **P27** Phone nav map is north-up and doesn't turn with the direction of travel.
- **P28** Same bus-stop label clutter and yellow traffic-light dots on the phone's driving map.
- **P29** Speed indicator disappears entirely once moving when the position has no speed, instead of computing speed from successive fixes.
- **P30** "Keep left and take 32 toward Milton Road": a bare route number "32" with no "M"/"route" reads oddly (phone and car).
- **P31** SERIOUS: a 1.6 km drive along Coronation Drive was credited with "185 roads you'd never travelled before"; the trip map paints a grid of CBD streets and a road north to Red Hill/Petrie Terrace that were never driven. Map matching (or the fix replay with no speed/bearing) wildly over-credits coverage.
- **P32** Trip detail map shows only matched "new roads", not the actual path driven, so you can't see where you really went or spot the bad matching.
- **P33** Trip list/detail don't say where the trip went ("to Coot-tha Place") even for a navigated trip.
- **P34** Trip list row: "185 new roads" chip for a 1.6 km trip; no sanity cap (max plausible roads per km).
- **P35** Trip detail header: "← Trips" back link sits in a tall empty band above the map (~110 px unused).
- **P36** Trip detail time "9:16 pm – 9:18 pm" says 2 min, but the drive ran from about 9:16 to 9:18:30; the trip list shows the start only.
- **P37** Coverage says "11.5 km of road travelled" and "Driven 11.5 km" right beside "Distance recorded 1.6 km" from the only trip: 7× more road credited than driven (same root as P31).
- **P38** Coverage, inside the Android app: "Background tracking is off. You can turn it on in the Android app." — web copy shown on Android; should link to Settings' switch.
- **P39** Coverage has no way to jump to the switch: the notice isn't tappable.
- **P40** Discover searches from the stale "Your location" (the old ring near Cleveland), not the current blue dot in the city (same as P14); distances are from the wrong place.
- **P41** Discover lookouts list "Whites Hill Lookout" and "Whites Hill" as two results for the same lookout, both 18 km.
- **P42** Discover "Lookouts" includes a bird hide ("Birdhide") and a wader roost ("Empire Point Wader Roost").
- **P43** Discover distances are straight-line ("6.6 km away") while the filter is time ("Within 30 min"); no drive time per result.
- **P44** Every Discover result shows "100% unexplored area": "area" leaks the internal area idea (coverage is roads); and when all say 100% the chip carries no information.
- **P45** Discover's −/+ buttons are tall pills, Plan's are circles; same control, two looks.
- **P46** Discover results sit below the fold after "Find places"; the screen doesn't scroll to them, so it looks like nothing happened (only a sliver of the first card shows).
- **P47** Discover map pins have no labels and don't link to their cards.
- **P48** The Discover map is half covered: its top-centre "Brisbane" label is hidden under the blue dot and pins ("Bri").
- **P49** Discover "Within 30 min" listed Sankey's Lookout, but its fastest route is 31 min (more for explore routes).
- **P50** Opening Directions from Discover keeps the Plan sheet's old scroll offset: the Directions/Round trip switch is gone and the "Your location" field is cut off under the map.
- **P51** An explore route to Sankey's Lookout runs past the destination, out west to a dead end and back (dashed spur beyond the pin).
- **P52** The Discover → Plan hand-off loses the Discover start point and mode choice? (Plan reverted to "Your location" stale ring near Cleveland.)
- **P53** Settings shows no app version or build anywhere (testers can't tell which build they're on).
- **P54** Settings has no voice guidance setting (on/off, volume, voice) though voice starts muted (P19).
- **P55** Settings: "Download a copy of your data from Settings on the website." — no link to the website.
- **P56** Settings: "Sign out" sits between Feedback and "Your data", away from the account line at the top, and full-width like a primary action.
- **P57** Settings: "Explore routes may take up to 15 min extra" wraps to two lines between tall pill −/+ buttons; reads cramped.
- **P58** Settings: no units, map style/theme, or "avoid" (tolls, motorways, unsealed) options; route defaults are only mode and budget.
- **P59** Feedback: the disabled Send button is a dim blue slab with grey text (very low contrast) and nothing says why it's disabled.
- **P60** Code (navigationService.handleFix): every fix is queued for upload with no jump/accuracy filter; a 30 km teleport (or a bad fix) is recorded as driven and becomes part of the trip and coverage (P26, likely P31/P37).
- **P61** Code: a reroute keeps the explore route's remaining via points (reroute(e.from, e.to, e.remainingVia)), so after missing a turn you're sent back to every unvisited detour point however far (C15).
- **P62** Code: after a reroute the voice only says "Route updated", not the new next instruction (except for turn-arounds).
- **P63** Code: an arrived trip ends itself after 15 s; if you arrive at the end of a car park or slightly early, guidance is gone with no "resume".
- **P64** Code: "Couldn't get a new route. Keep heading to the destination; trying again shortly." is shown with no way to retry now; on a long outage it repeats every 15 s with no backoff.
- **P65** Code: mute is stored on the phone across trips and restarts ("wf.voiceMuted") with no reminder at trip start that voice is off (P19).
- **P66** Plan sheet content scrolled under the map stays tappable/announced for accessibility (the Directions/Round trip switch at y≈850 is reported on screen while the map covers it); a tap there goes to the map.
- **P67** Round trip loops start from the stale "Your location" (the ring near Cleveland) while the blue dot is in Milton, 30 km away (P14 again).
- **P68** Round trip: every loop is drawn in the same green dash; the selected one is only slightly thicker, so overlapping loops can't be told apart.
- **P69** Round trip "About 1 h" gave a 1 h 4 min loop; the budget overshoots with no note.
- **P70** Round trip: the map isn't refit to the loops with padding: "Logan Village" and "Brisbane" labels sit on the cut edges and the location dot overlaps "Brisbane" ("B●bane").
- **P71** Switching to Round trip drops the chosen destination silently; switching back restores it? (it was gone from the field list in Round trip with no hint it's kept).
- **P72** Walking loop 1 includes a long out-and-back spur west along a main road (same street walked twice) rather than a loop; loops also follow arterial roads (orange) on foot.
- **P73** Search "1 George St Brisbane" puts 1 George Street, Ormiston first; the suburb/city word "Brisbane" is ignored, so the CBD's George Street isn't offered first.
- **P74** Search can't take coordinates: "-27.4698, 153.0251" → "No places match".
- **P75** Search can't find a postcode: "4000" → "No places match".
- **P76** Search doesn't know common Australian names: "maccas" (McDonald's) finds nothing; "Woolies Cleveland" returns Cleveland town and a BP, not Woolworths.
- **P77** Search distances ("4.7 km") are from the stale start, not where the phone is now (P14).
- **P78** Search "Bunnings": a store 22 km away (Acacia Ridge) is first, above ones 4.3 km and 7.4 km away.
- **P79** Search category labels are inconsistent for the same chain: "Hardware" vs "Hardware store".
- **P80** "Other…" opens an empty name field (placeholder "Gym, Mum's, School") instead of starting with the place's own name ("Bunnings Warehouse").
- **P81** After swapping, the destination is "Your location" and the "Save this place as Home/Work/Other…" chips still show, offering to save "Your location" (wherever the phone is) as a place.
- **P82** The travel mode picked in Round trip (Walk) silently carries over to Directions; Settings' default (Drive) isn't restored.
- **P83** A route planned from another start (Bunnings → "Your location") can be started; navigation then follows the phone's real position, which is at the destination, so it says "You've arrived" instantly with "0 min, 0 m to go". Start should warn that you're not at the start, or route from where you are.
- **P84** Arrived screen: the trip's map keeps showing the whole planned line with no destination marker, and "0 min / 0 m to go" stays as the ETA.
- **P85** On this drive's navigation screen there's no location dot at all; the route starts at Whitby Place but nothing marks where you are.
- **P86** The turn banner is blue on a fastest route and green on an explore route; the colour change isn't explained anywhere.
- **P87** During a trip the phone shows two Wayfinder notifications: the turn ("Turn right onto Carlingford Drive · 130 m", from the car module's channel, importance high) and a second "Navigating — Directions keep going with the screen off." Two entries for one trip.
- **P88** The phone's turn notification comes from the car module's channel "Navigation directions" (IMPORTANCE_HIGH), the source of the heads-up in P16; it's posted even when no car is connected? (here a car was).
- **P89** Neither trip notification has an End or Mute action; you must open the app to stop directions.
- **P90** Both trip notifications are visibility PRIVATE, so on the lock screen the next turn is hidden ("Contents hidden" on most phones) exactly when it's useful to glance at.
- **P91** The foreground-service notification says "Navigating" but not where to, and doesn't update with the next turn or ETA.
- **P92** Code (plan.tsx): Plan's extra-time budget is read from your settings once when the screen first mounts; changing the default in Settings doesn't reach Plan until the app restarts.
- **P93** Code (plan.tsx): the round-trip length always starts at "About 1 h"; the last choice isn't remembered.
- **P94** Code (useApproxLocation): "Your location" is filled only from a last-known fix under 10 minutes old and never asks for a fresh one; after a reboot or a long idle, Plan and Discover start with no start point at all.
- **P95** Code (plan.tsx fitTo): routes are fitted with 40 px side padding while markers carry ~150 px labels, the cause of P6's cut labels.
- **P96** Green means three different things: explore routes (dashed), "new roads" on Trips/Coverage, and the novelty chips; with orange main roads underneath there's no legend.
- **P97** Trips that started but didn't move (the first Mount Coot-tha trip, the Bunnings walk) leave no trace in Trips, with no note that nothing was recorded.
- **P98** Trips list says "Drive, navigated" with no explanation of "navigated" (vs. background-recorded).
- **P99** Coverage map has no legend and tapping a road does nothing; you can't see when you drove it.
- **P100** Every map's attribution ⓘ sits on the bottom-right edge where the sheet starts, half over the sheet's rounded corner.

## Android Auto (100)

- **C1** During navigation Android Auto shows a heads-up "Turn right onto Carlingford Drive" card (from the phone notification) over Wayfinder's own maneuver card, which is hidden beneath it (only "Drive" peeks out). Duplicate and covers the real one.
- **C2** Speed-limit sign and "0 km/h" are drawn in the middle of the car map (around 390,300), next to the car marker and over the route, not in a corner.
- **C3** Car shows an inferred speed limit "50" as a sign whose only difference is a grey ring (same as P18), even with no route and while parked.
- **C4** Car's main menu card covers the left half of the map; the 4th row is cut off at the bottom edge with no scroll hint.
- **C5** With no route, the car map is tilted 3D with a rotated compass, unlike the north-up flat phone map; position on car (Alexandra Hills) differed from the phone's (CBD) at the same moment.
- **C6** Car search opens on "No items" before typing: no recent searches, saved places or hint.
- **C7** Car search results have no category (Street, Locality, Library): "Coot Place", "Coot Lane", "Coot-tha Place" are all streets but nothing says so; the phone shows the type.
- **C8** Car search "coot": results not ordered by distance (33 km above 28 km) and the obvious place, Mount Coot-tha, isn't in the first three.
- **C9** Car search text is lost after going back and in again.
- **C10** Car search results say "11 km away" measured from the phone's real position, while the phone app (mocked) is 30 km elsewhere; no indication which position is used.
- **C11** Car route list shows only "36 km you've never been" for Fastest — the route's total length isn't shown at all; on Explore "43 km you've never been" reads as the length but isn't labelled.
- **C12** Car "Explore 1 57 min (11 min longer)" vs Fastest "45 min": the difference shown (11) doesn't match the times shown (12); rounding each separately.
- **C13** Car route preview has no start marker; only the destination pin.
- **C14** Starting a trip from the car leaves the phone's Plan screen showing a different, stale plan (Mount Coot-tha, three Start buttons) under a "Navigating to Coot-tha Place" banner; tapping Start there would begin a second trip.
- **C15** After the position jumped from near Cleveland to the CBD (off route), the reroute to Coot-tha Place (Forest Lake, ~25 km from the CBD) became 57 km / 1 hr 15 min: it keeps the explore route's old via points and drags you back across town, far over the 15-min budget. Same on the phone (1 h 16 min, 57 km).
- **C16** Car shows "1 hr 15 min" while the phone shows "1 h 16 min" for the same trip at the same moment: different number and different unit style.
- **C17** A purple line runs from the car marker to the route on the car map, unexplained; it's a different colour from the route.
- **C18** Car map shows bus-stop labels ("George St Stop 119 near Tank St", "Adelaide Street Stop 20 at City Hall") and dozens of traffic-light icons all over the driving map: heavy clutter for a car display.
- **C19** The car marker isn't snapped to the road: it sat in the river south of Coronation Drive while the phone showed the same moment's position on the road; the two screens disagree about where you are.
- **C20** Rerouted explore route loops back on itself (up Coronation Drive and back down a parallel street) and its length grew 57 → 58 km while driving toward the destination.
- **C21** Code: the navigation notification posts as IMPORTANCE_HIGH (heads-up) on every new instruction even when Wayfinder's own navigation screen is in front on the car (NavNotifications.update), causing the duplicate card in C1. Google's guidance: heads-up only when the app isn't showing.
- **C22** Code: a raw `nav.error` string is used as the car notification title (NavNotifications.titleOf), so whatever error text the bridge produces is shown to the driver.
- **C23** Ending a trip from the car is one tap with no confirmation or undo, while the phone asks "End this trip?"; easy to hit by accident in a moving car (the ✕ sits right by the ETA).
- **C24** After ending a trip the car map jumps 30 km back to the phone's real GPS position, not where the car (head-unit GPS) is; the idle car map ignores the car's own location.
- **C25** Car "Planned routes" screen: the location marker disappears from the map (it was there on the home menu).
- **C26** Car "Planned routes" empty text tells the driver to "Send a route from the website": an instruction they can't follow in the car; no alternative (e.g. Search) offered.
- **C27** Car "Discover nearby" map is left rotated from the last drive (~90°: Logan appears north-west of Cleveland, Brisbane north-east) with only a small compass to hint; browse screens should be north-up.
- **C28** Car "Discover nearby" isn't ordered by distance: #1 is 6.6 km away, #2 (Rushwood Sanctuary) is 180 m away.
- **C29** Car "Discover nearby" rows end in "100% unexpl…" truncated; the chip text costs a whole line on a small screen and says nothing (all 100%).
- **C30** Car "Discover nearby" pins 2, 4 and 5 overlap into an unreadable cluster.
- **C31** Car "Discover nearby" offers no choice of kind (lookouts, cafés…) and no time limit, unlike the phone; it mixes a wader roost and a park.
- **C32** A place 180 m away ("Rushwood Sanctuary") is offered as somewhere to discover by car.
- **C33** SERIOUS: Car route preview shows an empty panel — no route row, no Go button, no message — whenever there are no explore alternatives. Seen twice: Rushwood Sanctuary (180 m) and the saved Home (Bunnings, 5 km); the route is drawn but the trip can't be started from the car. Both times the code adds plan.note as a second text line on the only row (RoutePreviewScreen.onGetTemplate); likely the host rejects that row. Never tested against a real host.
- **C34** Car route preview: no "Starting point" or current-position marker; the route just begins somewhere on the map.
- **C35** The car home list offers "Test drive — Follow a pretend trip" to every driver in a real car (it was the 4th, cut-off row); a pretend trip on a real dashboard while driving is confusing and it isn't a feature drivers need.
- **C36** Code: car search loses its text on returning (SearchTemplate never gets setInitialSearchText), the cause of C9; results stay but the box is empty, so they look unrelated.
- **C37** Code: typing one or two letters in car search shows the host's "No items" (MIN_TYPED = 3, no message) as if nothing matched.
- **C38** Code: NavVoice ignores the result of requestAudioFocus, so directions are spoken even when focus is refused (during a phone call), talking over the call.
- **C39** Code: NavVoice uses QUEUE_FLUSH: a new instruction cuts the previous one off mid-sentence (e.g. a reroute right after "In 200 m turn left").
- **C40** Code: NavVoice sets Locale("en","AU") and ignores LANG_MISSING_DATA/NOT_SUPPORTED: on a phone without the Australian voice it may stay silent or use a different engine voice with no notice.
- **C41** Code: NavVoice keeps only the last text queued before the engine is ready; the first instruction(s) of a trip can be dropped.
- **C42** Code: the car's "Report" text button sits in the same action strip as "End", side by side; mis-tapping either at speed does the other thing.
- **C43** Code: "Off route" is shown as a bare message with no distance/ETA and nothing to do; the ETA disappears while off route and while "Finding a new route…".
- **C44** Code: when the car session ends mid-trip (unplug), the coordinator calls navigationEnded() though the phone trip continues; reconnecting shows Home first, not the running directions, until the next update arrives.
- **C45** Code: a trip starting on the phone pops every car screen to root (popToRoot) — whatever the driver/passenger was doing on the car (typing a search) is thrown away.
- **C46** Code: CarLocation accepts every car fix with no accuracy or age check, and the phone's fixes are fed in parallel (PhoneLocation); two sources for one position explain the car/phone disagreement in C19.
- **C47** Code: saved "Home" on the car is found only by the English name "home" (case-insensitive); a place saved as "Home 🏠" or "My house" isn't one tap away.
- **C48** While driving (restrictions on), car Search shows "Voice only while driving" and then "No items": no saved places or recent destinations to tap, so the only way to pick a destination on the move is voice.
- **C49** Car Search screen has no map behind it: the whole display turns into a grey panel, losing your position while you search.
- **C50** Code (handlers.here): the phone's last-known position up to 10 minutes old is preferred over the car's fresh GNSS fix, so car search distances/ranking use where you were up to 10 min ago (~15 km at highway speed).
- **C51** Code (toOption): a route's detail shows the new-km figure instead of its length whenever newKm ≥ 0.1, the cause of C11; the total length is never shown when anything is new.
- **C52** Code (toOption): extra time is formatted separately from total time ("57 min (11 min longer)"), both rounded independently, the cause of C12.
- **C53** Code: car Discover is hard-wired to 30 min by car and the server's default categories; the person's Discover choices on the phone aren't used.
- **C54** Code: car Discover results are passed through in server order without sorting by distance (C28).
- **C55** Code: car report message stamps the time in Australia/Brisbane regardless of the phone's time zone.
- **C56** Code: car plan's note "No other ways fit within your extra time." doesn't say what the extra time is or that it can be changed on the phone.
- **C57** Code: only the 30 most recently offered routes can be started; a planned route shown earlier and then many searches later fails with "That route has expired. Plan it again." with no Plan again button.
- **C58** Code: "That route is no longer available." from routeLine leaves the driving screen with no route line drawn and no message to the driver.
- **C59** A walking trip started on the phone takes over Android Auto as if it were a drive (car navigation screen, speed box, "You've arrived" heads-up); walking routes shouldn't drive the car display (the car's Planned routes even filters walks out).
- **C60** "You've arrived" appears twice on the car: as a heads-up card with ✕ over the navigation card (C1 again for arrival).
- **C61** The car's driving screen has two "end trip" controls at once: the ✕ on the ETA card and "End" in the action strip.
- **C62** Code/observed: after a tap on the car map during navigation the car location marker vanished and the map stopped following, with the action strip hidden — nothing on screen to get back to following until you tap again.
- **C63** A trip started on the phone (to Bunnings, parked at the start) ended within about a minute while switching phone screens, with no message on either screen saying why; the car dropped back to Home.
- **C64** The car's mute button didn't change state when tapped (stayed crossed-out; the phone still said "Unmute voice").
- **C65** Code (CarBridge): a car request waits up to 45 s before telling the driver the phone isn't answering; 45 s of spinner on a dashboard reads as a hang.
- **C66** Code (SceneLayout): the Places scene (search results) passes no position, so the car's search-results map never shows where you are relative to the numbered results.
- **C67** Code (SceneLayout): with no position yet the car's home map opens on all of Australia at zoom 3.6 (same choice as P1).
- **C68** Code (SceneLayout): Planned routes are numbered at the midpoint of each line; routes sharing roads put their numbers on top of each other.
- **C69** Code/observed: over the limit, only the speed digits turn light red (#FF6B6B on a dark box); the sign doesn't change and there's no sound, easy to miss at a glance.
- **C70** Code (WayfinderSession.onCarConfigurationChanged): day/night only refreshes the map style; the drawn speed box, puck and route casing keep fixed colours.
- **C71** Code (CarBridge.disconnect): if the phone's JavaScript restarts mid-trip (app update, crash), the car drops the directions instantly with no message.
- **C72** Code (NavigateRequests): "Navigate to <name>" from the Assistant takes the first search result without a choice; with search ranking as in P78 ("Bunnings" → a store 22 km away first) the driver is sent to the wrong branch.
- **C73** Code (navModel.toCarNav): the speed limit is only sent while status is "navigating", so it vanishes from the car whenever you're off route or a new route is being found — exactly when you're on an unfamiliar road.
- **C74** Code (navModel/SceneLayout): traffic lights ahead are drawn red or green from learned timings, a guess shown on the driving display as if it were the light's state; a driver may slow or speed up on it.
- **C75** Code (NavigateRequests): a point with no label opens a preview titled "Chosen place"; the address isn't looked up.
- **C76** Code (NavigateIntents): only geo: URIs are read; "google.navigation:q=…" (what many apps send) is reported as "Wayfinder couldn't read that destination."
- **C77** The map's attribution ⓘ button sits at the bottom-left under the edge of the list card on most car screens (half covered).
- **C78** A place saved on the phone (Home) doesn't appear on the car's Home list until you leave Home and come back; the list isn't refreshed while it's showing.
- **C79** Car Home row for a saved Home shows the place's description ("Bunnings Warehouse, Hardware store · Vic…") truncated, not a drive time; the useful part (how far, how long) is cut off.
- **C80** With a saved Home the car list pushes "Discover nearby" and "Test drive" below the fold on an 800×480 screen; only two other rows are visible.
- **C81** Car search shows the saved "Home" as an ordinary numbered result with no "Saved place" label or home icon (the phone labels it "Saved place").
- **C82** Returning to car Search (after the car's notification panel) shows "No items" with the keyboard closed, though the screen asks for the keyboard by default; you must tap the box first.
- **C83** A stray tap on the car's clock area opens Android Auto's notification panel over Wayfinder; with the harness's scaled taps (H16) it's easy to land outside Wayfinder.
- **C84** Code (simulation.demoRoute): the test drive's route is two straight lines from wherever you are ("Test Street", "Demo Road") drawn across real houses, parks and water on the car map.
- **C85** Code (simulation/handlers.simulate): the car's auto-drive during a real trip restarts that trip as a simulated one, so the real trip stops recording and the directions end when the pretend drive "arrives".
- **C86** Code (simulation): test-drive speed is the route length / 90 s, capped at 60 m/s, so on a long trip the car shows 216 km/h against a 60 sign, over-limit red the whole way.
- **C87** Car Home row for a saved place gives no drive time or ETA (the phone knows it), so "Home" can't be judged at a glance.
- **C88** While parked on the driving screen, the "0 km/h" speed box and the speed sign sit over the start of the route line.
- **C89** Car turn card's "Then" line is cut off ("Turn left onto Little C…") at an 800×480 resolution where the card has room for two lines.
- **C90** No lane guidance on the car for "Keep left and take 32 toward Milton Road" at a motorway split.
- **C91** Car map street labels are small grey on dark grey ("Carlingford Drive", "McBride Circuit"), hard to read at arm's length.
- **C92** Car map draws every building footprint at driving zoom; with the POI dots and traffic lights the background is busy.
- **C93** Car Discover rows wrap long names onto two lines, so only two places fit on screen at once.
- **C94** Car route preview: Explore rows say only "11 min longer · 43 km you've never been", nothing about where the route goes (via which suburb/road).
- **C95** Car route preview: only the selected row shows "Go"; nothing tells the driver the other rows can be selected.
- **C96** Car driving screen: "Report" is a large text button beside a small mute icon; reporting is more prominent than muting.
- **C97** Car: when no route options load, the preview spinner has no timeout message for 45 s (bridge timeout C65).
- **C98** Car: "Back to directions" is only on Home; from Search or Discover during a trip there's no way back except the rail icon or notification.
- **C99** Car: route preview titles a planned/saved place by its saved name ("Home") only, without the address, so you can't confirm which Home it is.
- **C100** Car turn card reads "Keep left and take 32 toward Milton Road": the bare route number "32" with no M/route marker or shield (same text as P30, observed on the car).

## Device harness and setup (18)

- **H1** USB: phone (Nothing A059) re-enumerates every ~5s over USB while Android Auto installed; adb unusable. Wireless debugging works. Docs only describe USB.
- **H2** A failed `up` leaves .harness/session.json; next `up` refuses "session already open" and the advice (`down`) signs the test account out even though nothing was set up / account never confirmed in that session (account:null case OK, but after DHU fail account IS set -> down signs out).
- **H3** After a PC crash/reboot the session file is stale (dead DHU pid, adb forward gone); only way forward is `down`, which signs the test account out. Needs `up` to recover a dead session.
- **H4** With Android Auto connected, focusedPackage read the car display's mCurrentFocus (gearhead) so every phone tap/type was refused. FIXED here (display 0 only) with tests.
- **H5** `up` reads Settings after a fixed 2.5s sleep; on a slower phone it reads the previous screen and reports "signed in as someone the harness can't read", telling you to `down` (sign out). Should poll.
- **H6** When the notification shade is open, `up` says "signed in as someone the harness can't read" instead of "something is covering Wayfinder".
- **H7** Every head-unit connect pulls down the shade / brings Android Auto's phone screen to front, so the first phone command after `up --car` is refused; `up` should return Wayfinder to front.
- **H8** `gps` on a real phone (Android 16, Nothing) prints nothing and has no effect on Wayfinder: the test 'gps' provider is set but Wayfinder uses the fused provider, which keeps the real position (Your location stayed at the real home, not the CBD). Silent no-op.
- **H9** Android Auto resumes Spotify on the phone speaker at full volume on each head-unit connect; harness should pause media / mute on up.
- **H10** DHU is 2.0 (2022 build); ALSA errors fill dhu.log on a PC with no default card; no audio from the head unit at all, so voice guidance can't be checked.
- **H11** `adb shell cmd location providers list` in todo.md's `down` check doesn't exist on Android 16 ("Unknown command: list").
- **H12** `shot car` returns as soon as the file exists, before the head unit finishes writing it: the first read got a truncated PNG (180 KB of 310 KB) that image readers reject.
- **H13** SAFETY: `gps`/`drive` replace the phone's real "gps" provider. Google Play services' fused provider reads it, so every other app on the phone (here Life360 and Home Assistant are registered for location) gets the fake position; Life360 would show the owner at the CBD to their circle. Mocking the platform "fused" provider instead moves Wayfinder (verified) without touching gps.
- **H14** `gps reset` turns mock_location off for the shell, which also kills any other test provider; no way to reset only one.
- **H15** `tap car` always refused after about a minute: it needs the last "WayfinderCar: car screen shown" line in logcat, but this phone's main log buffer is 256 KiB and the harness's own `ui` dumps flood it ("AccessibilityNodeInfoDumper: Skipping invisible child" per node), so the line is gone. Same for `logs` catching crashes. Read `dumpsys activity`/car service state or keep a log file instead.
- **H16** `tap car x y` doesn't use the `shot car` pixel grid: taps land at about (x/1.16, y/1.16), so typing "coot" produced "d774", and the right ~14% of the car screen (keyboard backspace, the ✕ on cards, the zoom +/− buttons) can't be tapped at all (anything past ~690 px clamps).
- **H17** The harness can't scroll car lists (no drag/swipe for the car, and taps beyond ~y 400 can't land after the scaling in H16), so any car row below the fold — Home's "Test drive", later route options — can't be reached.
- **H18** On a real phone Wayfinder's trip position comes from Play services' fused location (expo-location), which neither the harness's gps test provider (H8) nor a platform fused one controls; PhoneLocation (LocationManager) follows the platform mock, so the two disagree. The harness can't fake a phone drive end to end.
