-- Where a navigated trip was going, as the phone named it ("Woolworths"), so Trips can say "To
-- Woolworths" rather than the nearest place to where the trip happened to end (R2-P5). The phone
-- sends it with each batch of the trip; the trip takes it when it is made.
ALTER TABLE track_batches ADD COLUMN destination_name text;
ALTER TABLE trips ADD COLUMN destination_name text;
