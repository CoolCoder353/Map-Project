-- Places a person saves under a name of their own ("Home", "Work"), offered first when a search
-- starts with that name. Removed with the account.
CREATE TABLE saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT '',
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One place per name for each person, whatever the capitals: saving "home" again moves Home.
CREATE UNIQUE INDEX saved_places_user_name_idx ON saved_places (user_id, lower(name));
