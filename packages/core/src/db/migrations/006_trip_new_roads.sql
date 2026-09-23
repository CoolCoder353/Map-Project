-- Coverage is counted in roads, so a trip reports how many roads it was the first to reach.
-- The hexagon count stays as the internal index that steers explore, and is no longer shown.
ALTER TABLE trips ADD COLUMN new_roads integer NOT NULL DEFAULT 0;
