# 0002 — Place search without a geocoding service

**Status:** accepted, 2026-09-18

## Context

Search suggestions must say where each place is ("Main Street · Queanbeyan NSW 2620"), favour places near the trip's start, and find businesses by name, brand or kind ("petrol"). Everything runs on the one server: no geocoding API, and no PostGIS (ADR 0001).

## Decision

**Where a place is** is worked out once, at import time:
- OSM administrative boundaries (states at admin level 4, localities at levels 9 and 10) are loaded into an in-memory grid index in the worker.
- Each place is tested point-in-polygon. State lookups are cached per ~2 km square, except squares a state border passes through.
- A SQL pass on the staging table fills the rest: the nearest settlement as the suburb, the suburb's majority postcode, and removal of settlements mapped twice.

**Search** (`placeService.searchPlaces`) combines candidate pools, then ranks them in Node:
- Exact and prefix name or brand matches at any distance, through a B-tree on `lower(name)` (`text_pattern_ops`). The matches are materialised before sorting by distance: otherwise the planner walks the point index nearest-first and scans the whole table for rare names.
- Typo-tolerant trigram matches among the 30,000 places nearest the origin. Trigram index scans don't work here: "Street" shares trigrams with about 600k names.
- Trigram matches on settlement names nationwide (a partial index), so "canbera" finds Canberra.
- For category words ("servo", "chemist"), the nearest places of those OSM types.

The score is text match plus a distance pull scaled by match quality (exact > prefix > fuzzy). Duplicates within 300 m are collapsed, because OSM often maps a shop as a point and as its building. Queries take 80–140 ms on the full Australia data.

**Opening hours** are evaluated per request with the `opening_hours` library, in the state's time zone.

## Consequences

- Suburb, state and postcode only change when places are re-imported (`refresh-cli.js places`, about 7 minutes).
- Postcodes are missing where OSM has no addresses in a suburb.
- With no origin at all (a phone without location and no start point), search falls back to a nationwide trigram scan, which is slower for common words.
- `opening_hours` is **LGPL-3.0**. It is an unmodified dependency of the server only and is never bundled into the web or Android apps. Its licence text ships in `node_modules` with the server image. Replacing it would mean writing a parser for the OSM opening-hours syntax.
