CREATE TABLE objective_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  plan JSONB NOT NULL,
  baseline_report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX objective_watches_user_updated_idx
  ON objective_watches (user_id, updated_at DESC);
