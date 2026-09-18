-- Bug reports and ideas from users, collected when an admin switches feedback on.
CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deleting an account (after the 7-day window) removes its reports too.
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bug', 'idea', 'other')),
  message text NOT NULL,
  context jsonb NOT NULL,
  screenshot bytea,
  screenshot_type text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'in_progress', 'done', 'wont_fix')),
  admin_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_status_created_idx ON feedback (status, created_at DESC);
CREATE INDEX feedback_user_created_idx ON feedback (user_id, created_at DESC);
