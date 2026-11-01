-- What the map knows about roads beyond the routing graph, rebuilt with each map data refresh:
-- traffic lights, and the speed-limit rules a graph can't hold (school zones, electronic signs).
CREATE TABLE traffic_signals (
  -- The OSM node id.
  id bigint PRIMARY KEY,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  kind text NOT NULL CHECK (kind IN ('signals', 'crossing', 'ramp_meter'))
);
CREATE INDEX traffic_signals_point_idx ON traffic_signals USING gist (point(lon, lat));

CREATE TABLE way_speed_rules (
  way_id bigint PRIMARY KEY,
  -- OSM maxspeed:conditional, e.g. "40 @ (Mo-Fr 07:00-09:00,14:00-16:00)".
  conditional text,
  -- The limit is shown on electronic signs that change (maxspeed:variable, maxspeed=signals).
  variable boolean NOT NULL DEFAULT false,
  -- Where the way is, for the time of day its rules go by.
  state text
);

-- How fast trips actually went along each road, one row per road per matched trip.
CREATE TABLE road_speed_samples (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  way_id bigint NOT NULL,
  -- 0 a weekday, 1 a weekend day, in the road's own time zone.
  day_kind smallint NOT NULL CHECK (day_kind IN (0, 1)),
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  kmh real NOT NULL,
  length_m real NOT NULL,
  observed_at timestamptz NOT NULL
);
CREATE INDEX road_speed_samples_trip_idx ON road_speed_samples (trip_id);
CREATE INDEX road_speed_samples_observed_idx ON road_speed_samples (observed_at);

-- The typical speed on a road, rebuilt nightly from the samples where enough trips agree. Hour 24
-- is the whole day, for an hour with too few trips of its own.
CREATE TABLE road_speeds (
  way_id bigint NOT NULL,
  day_kind smallint NOT NULL,
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 24),
  kmh real NOT NULL,
  trips int NOT NULL,
  PRIMARY KEY (way_id, day_kind, hour)
);

-- Reports of a wrong speed limit, with where it was shown.
ALTER TABLE feedback DROP CONSTRAINT feedback_type_check;
ALTER TABLE feedback ADD CONSTRAINT feedback_type_check CHECK (type IN ('bug', 'idea', 'other', 'speed_limit'));
ALTER TABLE feedback ADD COLUMN speed_limit jsonb;
