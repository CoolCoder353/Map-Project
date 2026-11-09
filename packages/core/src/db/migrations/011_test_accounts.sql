-- Accounts used to test the apps: an admin's second account, or the device harness's. Their drives
-- still make trips and coverage for that account, but don't count towards what is learned from
-- everyone's drives (road speeds, waits at lights), so testing never changes anyone's routes.
ALTER TABLE users ADD COLUMN test_account boolean NOT NULL DEFAULT false;
