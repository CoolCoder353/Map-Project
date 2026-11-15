-- Search among everything that isn't a street address. With G-NAF every house has an address, so
-- they outnumber all other places many times over: walking the point index nearest-first past
-- them took over half a second on Queensland, and a misspelt name matched thousands of them.
-- Queries that don't start with a number never want an address, and use these instead.
CREATE INDEX IF NOT EXISTS places_named_point_idx ON places USING gist (point(lon, lat)) WHERE kind <> 'address';
CREATE INDEX IF NOT EXISTS places_named_trgm_idx ON places USING gin (name gin_trgm_ops) WHERE kind <> 'address';

-- "12 Smith Cleveland", a name and then a suburb with no comma, is looked for as each split of
-- its words. The suburb narrows it far more than "12" does, which matches every address with a 12.
CREATE INDEX IF NOT EXISTS places_lower_suburb_idx ON places (lower(suburb));
