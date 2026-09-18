-- Where each place is (suburb, state, postcode), what kind of business it is, its brand and
-- opening hours, plus a point index so search can look nearest-first.
ALTER TABLE places
  ADD COLUMN suburb text,
  ADD COLUMN state text,
  ADD COLUMN postcode text,
  ADD COLUMN poi_type text, -- OSM key=value, e.g. shop=supermarket
  ADD COLUMN brand text,
  ADD COLUMN opening_hours text;

CREATE INDEX places_point_idx ON places USING gist (point(lon, lat));
CREATE INDEX places_brand_trgm_idx ON places USING gin (brand gin_trgm_ops) WHERE brand IS NOT NULL;
CREATE INDEX places_poi_type_idx ON places (poi_type) WHERE poi_type IS NOT NULL;
