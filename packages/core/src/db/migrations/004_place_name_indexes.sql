-- Exact and prefix name/brand lookups (any distance) and typo-tolerant settlement names
-- nationwide. Trigram search over every name is too slow for common words like "Street".
CREATE INDEX places_lower_name_idx ON places (lower(name) text_pattern_ops);
CREATE INDEX places_lower_brand_idx ON places (lower(brand) text_pattern_ops) WHERE brand IS NOT NULL;
CREATE INDEX places_settlement_trgm_idx ON places USING gin (name gin_trgm_ops) WHERE kind IN ('city', 'town', 'suburb');
