---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/admin"]
---

# Surface: Wayfinder web app (planner, coverage, trips, settings, /admin)

Mode: Operate. Audience: invited friends planning trips at a desk; operators (dev/admin) in /admin.
Task: find a place, compare fastest vs explore routes, generate loops, discover unexplored places, review coverage and trips, send routes to the phone. Admins monitor health and manage users, data, invites, app name and copy voice.
Constraints: app name and voice come from runtime config (never hard-coded); OSM attribution visible; novelty never shown by colour alone; WCAG 2.2 AA.
Quality bar: Google Maps (web) and Apple Maps (web).

## Direction contract

THESIS: The category standard played straight at Google/Apple Maps web craft: a full-bleed map with a floating panel. The one product-specific addition is that novelty ("km you've never been") is first-class route data beside time and distance, never a gimmick.

OWN-WORLD: Near-white floating panels, 12px radius, soft two-layer shadow over a full-bleed map; system UI type (SF Pro / Segoe UI / Roboto) with tabular numerals; one blue accent for primary actions and the fastest route; explore routes in a green with a dashed casing and a hatched "new" badge; neutral greys; pill chips; matching dark theme.

STORY: The visitor searches, sees the fastest route and up to three explore routes compared by minutes, km and new km, picks one and sends it to their phone; coverage and trips show their explored world growing.

FIRST VIEWPORT: Map fills the viewport. A 400px panel floats 16px from the top-left: search field on top, a row of tabs (Directions, Round trip, Discover, Coverage, Trips) and the active tab's content scrolling beneath. Account menu top-right; zoom and locate controls bottom-right; attribution bottom-left. Admin uses a conventional left sidebar with dense tables and charts.

FORM: Category standard (canon), chosen by the user in the safer register; seed key 28268b2d.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
