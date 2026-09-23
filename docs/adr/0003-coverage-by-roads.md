# 0003 — Coverage by roads travelled, not hexagons

**Status:** accepted, 2026-09-23 (supersedes part of [0001](0001-h3-instead-of-postgis.md))

## Context

A user put it plainly: *"The coverage should be based on roads i've been on not hexigons."* Hexagons (ADR 0001) were chosen because they are cheap to index without PostGIS, but they answer a different question. A res-9 hexagon is about 350 m across, so driving one street marks the whole block as explored, including streets never touched.

## Decision

What people see is roads. Trips are snapped to the road network with GraphHopper's map matching (`/match`), and the OSM ways they covered are stored per person, along with the travelled piece of each way so it can be drawn:

- **`visited_ways`**: `(user_id, way_id)` with the travelled geometry, its length, when it was first and last travelled, and the modes. A longer stretch of a way replaces a shorter one.
- **Way ids, not edge ids.** GraphHopper's internal edge ids change on every rebuild; `osm_way_id` (a new encoded value in `graph.encoded_values`) does not.
- **Novelty by road.** Routes are scored by asking the routing engine which ways each stretch uses, instead of sampling every 50 m and looking up hexagons.
- **Stats in kilometres** of road travelled, and roads first travelled this week or month.
- **Per trip**, `new_roads` counts the roads that trip was the first to travel, which is what a
  trip shows in the list and on its own page. Trips are matched oldest first, so the credit goes
  to the trip that actually got there first.
- **A trip that grows is matched again.** Background uploads arrive in batches and extend a trip
  that is still being recorded, so its old match is dropped and the whole trip is re-snapped.

**Hexagons stay as an internal index.** The routing engine can only be told to avoid *areas* (a polygon in a custom model), not a list of roads, so explore still builds its "already visited" polygon and picks via areas from res-7 cells. Nobody sees them.

## Consequences

- Coverage means something exact: a street is covered only if it was driven or walked.
- Off-road travel (bush walking, beaches) can't be matched. Those trips keep their raw line for replay and count no road kilometres — hexagons used to count them. This is the real loss.
- Coverage depends on the routing graph: a trip recorded outside the graph's region can't be matched.
- Map matching is one call per trip, run after trip processing, outside its transaction. Rebuilding coverage re-matches every trip.
- Old trips need reprocessing to appear (the coverage-rebuild job does this).
