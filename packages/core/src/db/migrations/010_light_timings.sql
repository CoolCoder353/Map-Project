-- Each time a drive went through a set of traffic lights, timed from fixes close enough together
-- (in practice, navigated drives): which way it went, whether it had to stop and for how long.
-- Lights are known by the OSM node the approach meets first (traffic_signals.id); there's no
-- foreign key, as that table is replaced on every map refresh while node ids stay the same.
CREATE TABLE signal_passes (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  signal_id bigint NOT NULL,
  -- The heading it arrived on (0-7, by eighths from north) and the turn it made, e.g. "2right".
  direction text NOT NULL,
  -- 0 a weekday, 1 a weekend day, in the lights' own time zone.
  day_kind smallint NOT NULL CHECK (day_kind IN (0, 1)),
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  stopped boolean NOT NULL,
  wait_s real NOT NULL,
  -- The local date (days since 1970) and seconds past local midnight it reached the lights, and
  -- when they most likely turned green for it (only for a stop near the front of the queue).
  local_day int NOT NULL,
  arrive_s real NOT NULL,
  green_s real,
  observed_at timestamptz NOT NULL
);
CREATE INDEX signal_passes_trip_idx ON signal_passes (trip_id);
CREATE INDEX signal_passes_observed_idx ON signal_passes (observed_at);

-- How long each set of lights usually holds a car going each way, rebuilt nightly where enough
-- passes from enough people agree. Hour 24 is the whole day; direction '*' is every way through.
CREATE TABLE signal_timings (
  signal_id bigint NOT NULL,
  direction text NOT NULL,
  day_kind smallint NOT NULL,
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 24),
  stop_chance real NOT NULL,
  wait_s real NOT NULL,
  -- Waits of the passes that stopped: 10th, 25th, 50th, 75th and 90th percentiles.
  waits real[] NOT NULL,
  passes int NOT NULL,
  -- A fixed cycle, where its changes to green line up from day to day and that predicts held-back days.
  cycle_s real,
  green_s real,
  offset_s real,
  PRIMARY KEY (signal_id, direction, day_kind, hour)
);
