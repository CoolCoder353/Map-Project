-- Coverage by roads travelled rather than hexagons: which OSM ways each person has been along,
-- and the piece of each way they covered, so it can be drawn. Hexagons stay as an internal index
-- for steering explore (the routing engine can only avoid areas, not individual roads).
CREATE TABLE visited_ways (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  way_id bigint NOT NULL,
  -- The travelled part of the way, [[lon, lat], ...], and its length.
  geometry jsonb NOT NULL,
  length_m double precision NOT NULL,
  first_visited_at timestamptz NOT NULL,
  last_visited_at timestamptz NOT NULL,
  -- bit 1 = car, bit 2 = foot
  modes smallint NOT NULL DEFAULT 0,
  min_lon double precision NOT NULL,
  min_lat double precision NOT NULL,
  max_lon double precision NOT NULL,
  max_lat double precision NOT NULL,
  PRIMARY KEY (user_id, way_id)
);
CREATE INDEX visited_ways_bbox_idx ON visited_ways USING gist (box(point(min_lon, min_lat), point(max_lon, max_lat)));
CREATE INDEX visited_ways_user_first_idx ON visited_ways (user_id, first_visited_at DESC);

-- Trips keep the road-matched line as well as the raw one: matching fails off-road (bush walks),
-- and then the raw line is all there is.
ALTER TABLE trips ADD COLUMN matched_geometry jsonb, ADD COLUMN matched_m double precision NOT NULL DEFAULT 0;
