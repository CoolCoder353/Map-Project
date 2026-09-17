# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small invited group of friends who like exploring (driving and walking/hiking in Australia). On the website they are mostly **planning at a desk**: plotting A→B trips and loops, browsing places they have never been, reviewing their coverage and trip history, and sending routes to their Android phone. Phone-browser use is secondary.

A second audience is the operators (`dev` and `admin` roles) who use `/admin` to monitor the service and manage accounts, data and invites.

## Product Purpose

A self-hosted maps app that remembers where you have travelled and steers you toward areas you have never visited, while always offering the fastest route for when there is no time for a detour. Success: friends regularly choose routes and destinations that expand their explored area, and can see that coverage grow.

## Positioning

Every route and suggestion is measured against *your own* travel history: explore routes are ranked by kilometres through hexagons you have never entered, within a time budget you set, shown side by side with the fastest route. All routing, tiles and search run on the operator's own server; no third-party map APIs.

## Operating Context

- Web app for planning; Android app (separate) for navigation and background tracking (off by default, user-toggleable).
- Coverage is tracked on an H3 hexagon grid (~0.1 km² cells) shared across travel modes.
- Invite-only sign-up with email and password.
- Admin dashboard lives inside the web app under `/admin`, role-gated; views of other users' data are audited; deletions are soft with a 7-day undo.

## Capabilities and Constraints

- Travel modes: car and foot (walking/hiking). No transit, no cycling.
- Features: search, fastest route, explore route A→B with time budget, round-trip generator, discover destinations in unexplored areas, coverage ("fog of war") map with stats, trip history with replay, send route to phone, settings, data export, account deletion.
- Online only.
- **The app name and the copy voice are admin-configurable in the dashboard** (defaults: name "Wayfinder", voice "plain and friendly"; alternatives "playful explorer" and "minimal and technical"). UI must never hard-code the product name.
- Map data: OpenStreetMap; attribution must be shown.

## Brand Commitments

- Default name "Wayfinder" (configurable). Default voice: plain and friendly — clear, calm, a little warm ("4.2 km you've never been"). Admin surfaces stay factual regardless of voice.

## Evidence on Hand

No logos, imagery, testimonials or metrics exist. Do not fabricate any.

## Product Principles

1. The fastest route is always one glance away; exploring is an invitation, never a detour forced on someone.
2. Show novelty in the user's own terms: new kilometres, new area, extra minutes.
3. Personal location history is sensitive: make tracking state, deletion and export obvious; operators see only what they need and every look is logged.
4. Planning at a desk deserves density and precision, not a stretched phone UI.

## Accessibility & Inclusion

Aim for WCAG 2.2 AA: keyboard-operable planner and dashboard, sufficient contrast on map overlays, never encode route type or coverage by colour alone.
