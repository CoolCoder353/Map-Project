-- Wayfinder initial schema. H3 cells are stored as bigint (see docs/adr/0001).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('user', 'dev', 'admin');
CREATE TYPE travel_mode AS ENUM ('car', 'foot');
CREATE TYPE track_source AS ENUM ('background', 'navigation');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  settings jsonb NOT NULL DEFAULT '{"trackingEnabled": false, "defaultMode": "car", "exploreBudgetMin": 15}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_deleted_at_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE invite_codes (
  code text PRIMARY KEY,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  used_by uuid REFERENCES users (id) ON DELETE SET NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  note text,
  role_on_signup user_role NOT NULL DEFAULT 'user'
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE track_batches (
  batch_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  source track_source NOT NULL,
  mode travel_mode,
  navigation_session_id uuid,
  point_count int NOT NULL
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode travel_mode NOT NULL,
  source track_source NOT NULL,
  navigation_session_id uuid,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  distance_m double precision NOT NULL DEFAULT 0,
  point_count int NOT NULL DEFAULT 0,
  new_cells int NOT NULL DEFAULT 0,
  -- Simplified [[lon, lat], ...] for display
  geometry jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX trips_user_started_idx ON trips (user_id, started_at DESC);
CREATE INDEX trips_deleted_at_idx ON trips (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE track_points (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trip_id uuid REFERENCES trips (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  source track_source NOT NULL,
  mode travel_mode,
  navigation_session_id uuid,
  ts timestamptz NOT NULL,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  accuracy_m real,
  speed_mps real,
  heading_deg real
);
CREATE INDEX track_points_trip_ts_idx ON track_points (trip_id, ts);
CREATE INDEX track_points_unassigned_idx ON track_points (user_id, ts) WHERE trip_id IS NULL;

CREATE TABLE visited_cells (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cell bigint NOT NULL,
  r7 bigint NOT NULL,
  r5 bigint NOT NULL,
  first_visited_at timestamptz NOT NULL,
  last_visited_at timestamptz NOT NULL,
  visit_count int NOT NULL DEFAULT 1,
  -- bit 1 = car, bit 2 = foot
  modes smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, cell)
);
CREATE INDEX visited_cells_r7_idx ON visited_cells (user_id, r7);
CREATE INDEX visited_cells_r5_idx ON visited_cells (user_id, r5);
CREATE INDEX visited_cells_first_idx ON visited_cells (user_id, first_visited_at);

CREATE TABLE planned_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  route jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planned_routes_user_idx ON planned_routes (user_id, created_at DESC);

CREATE TABLE places (
  id text PRIMARY KEY, -- e.g. "n123", "w456"
  name text NOT NULL,
  kind text NOT NULL, -- city, town, suburb, street, address, poi
  category text, -- POI category for discover, NULL otherwise
  description text NOT NULL DEFAULT '',
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  r9 bigint NOT NULL,
  r7 bigint NOT NULL,
  importance real NOT NULL DEFAULT 0
);
CREATE INDEX places_name_trgm_idx ON places USING gin (name gin_trgm_ops);
CREATE INDEX places_r7_idx ON places (r7);
CREATE INDEX places_r9_idx ON places (r9);
CREATE INDEX places_category_r7_idx ON places (category, r7) WHERE category IS NOT NULL;

CREATE TABLE route_requests (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  kind text NOT NULL,
  mode travel_mode NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX route_requests_created_idx ON route_requests (created_at);

-- Admin audit trail: append-only (enforced by trigger).
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}',
  ip text
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_id, created_at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE metrics_minute (
  bucket_start timestamptz NOT NULL,
  metric text NOT NULL,
  label text NOT NULL DEFAULT '',
  count int NOT NULL,
  error_count int NOT NULL DEFAULT 0,
  sum_ms double precision NOT NULL DEFAULT 0,
  p50_ms double precision,
  p95_ms double precision,
  max_ms double precision,
  -- log-scale histogram bins (see core/lib/metrics.ts) so buckets can be merged
  histogram int[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (bucket_start, metric, label)
);

CREATE TABLE metrics_daily (
  day date NOT NULL,
  metric text NOT NULL,
  label text NOT NULL DEFAULT '',
  count int NOT NULL,
  error_count int NOT NULL DEFAULT 0,
  sum_ms double precision NOT NULL DEFAULT 0,
  p50_ms double precision,
  p95_ms double precision,
  max_ms double precision,
  histogram int[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, metric, label)
);

CREATE TABLE error_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL,
  source text NOT NULL,
  message text NOT NULL,
  stack text,
  request_id text,
  user_id uuid
);
CREATE INDEX error_events_created_idx ON error_events (created_at DESC);

CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  osm_data_date text,
  log_tail text NOT NULL DEFAULT '',
  requested_by uuid
);
CREATE INDEX pipeline_runs_started_idx ON pipeline_runs (started_at DESC);

CREATE TABLE system_samples (
  ts timestamptz PRIMARY KEY,
  cpu_pct real NOT NULL,
  mem_used_bytes bigint NOT NULL,
  mem_total_bytes bigint NOT NULL,
  disk_used_bytes bigint NOT NULL,
  disk_total_bytes bigint NOT NULL,
  db_up boolean NOT NULL,
  graphhopper_up boolean NOT NULL,
  queue_depth int NOT NULL
);

CREATE TABLE app_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
