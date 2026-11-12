-- The lanes leading up to a junction, from OSM turn:lanes, rebuilt with each map data refresh like
-- way_speed_rules. Each direction is the tag's value as mapped ("left|through|through;right"), in
-- the way's own direction (forward) or against it (backward). The way's line is kept to tell which
-- of the two a route is going and that a turn is at the end of it.
CREATE TABLE way_lanes (
  way_id bigint PRIMARY KEY,
  forward text,
  backward text,
  coords jsonb NOT NULL
);

-- Speed limit signs from the Queensland Government's survey of state and local roads (2019-20,
-- CC BY 4.0), and the limits it recorded on roads with no sign. Imported once by the admin
-- refresh CLI: the survey isn't updated. Used only where the map has no limit of its own.
CREATE TABLE speed_signs (
  -- The survey's own number for the sign, e.g. "190805-G1-412".
  id text PRIMARY KEY,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  kmh smallint NOT NULL CHECK (kmh BETWEEN 5 AND 130),
  -- Which way traffic facing it is going, degrees from north by eighths.
  bearing smallint NOT NULL CHECK (bearing BETWEEN 0 AND 359),
  -- A road with no sign, where the survey noted the limit that applies by law.
  unsigned boolean NOT NULL DEFAULT false,
  surveyed_on date
);
CREATE INDEX speed_signs_point_idx ON speed_signs USING gist (point(lon, lat));

-- The limit the map gave a road when a drive went along it, and where, so drives that keep going
-- much faster or slower than it can point at a limit that may be wrong.
ALTER TABLE road_speed_samples ADD COLUMN limit_kmh smallint;
ALTER TABLE road_speed_samples ADD COLUMN lon double precision;
ALTER TABLE road_speed_samples ADD COLUMN lat double precision;

-- Roads whose limit drives suggest is wrong, rebuilt nightly with road_speeds for an admin to check.
CREATE TABLE limit_checks (
  way_id bigint PRIMARY KEY,
  limit_kmh smallint NOT NULL,
  -- The typical speed of the drives along it, all day.
  typical_kmh real NOT NULL,
  trips int NOT NULL,
  people int NOT NULL,
  lon double precision NOT NULL,
  lat double precision NOT NULL
);

-- A business's phone and website, and when someone last checked its details on the ground (OSM
-- check_date), so stale details can say so.
ALTER TABLE places ADD COLUMN phone text;
ALTER TABLE places ADD COLUMN website text;
-- Text, YYYY-MM-DD as mapped: a date column comes back as a Date in the server's time zone.
ALTER TABLE places ADD COLUMN checked_on text;
