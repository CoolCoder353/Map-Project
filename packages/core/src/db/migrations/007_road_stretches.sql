-- A road can be travelled in separate stretches: one end on Monday, the other on Friday. Keep
-- every stretch, [[[lon, lat], ...], ...]. Keeping only the longest one left gaps on the map
-- where people had driven. Null on rows from before: their one stretch is in geometry, which
-- keeps the longest stretch.
ALTER TABLE visited_ways ADD COLUMN pieces jsonb;
