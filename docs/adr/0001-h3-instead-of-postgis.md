# ADR 0001: H3 cells as the spatial index instead of PostGIS/osm2pgsql

**Status:** accepted (2026-09-17). Amends the design spec's "Search" and "DB" choices.

## Context
The spec proposed PostgreSQL + PostGIS, with osm2pgsql importing places/POIs. Everything the app
queries spatially is already keyed by H3 cells: visited coverage (res 9), explore areas (res 7), and
coverage aggregation at lower resolutions.

## Decision
- App tables store plain `lon`/`lat` doubles plus precomputed H3 parent cells (`r9`, `r7`, `r5`) as
  `bigint`, indexed with B-trees. Spatial lookups become `WHERE r7 = ANY($cells)` followed by exact
  distance / point-in-polygon filtering in Node.
- OSM places, streets, addresses and POIs are extracted with `osmium tags-filter` + `osmium export`
  (GeoJSON sequence) and loaded by a Node importer (`apps/worker/src/pipeline/import-places.ts`).
- Search uses `pg_trgm` similarity on names plus distance ranking; no PostGIS required.

## Consequences
- One fewer extension/tool (no PostGIS, no osm2pgsql container); the database runs on stock
  `postgres:17` and on PGlite for fast local tests.
- Polygon features (parks, beaches) are reduced to a representative point at import.
- If richer geometry queries are ever needed, PostGIS can be added without changing existing tables.
