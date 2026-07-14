CREATE TABLE objective_watch_checks (
  id BIGSERIAL PRIMARY KEY,
  watch_id UUID NOT NULL REFERENCES objective_watches(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK (check_type IN ('automatic', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('unchanged', 'changed', 'partial', 'failed')),
  summary JSONB,
  change JSONB,
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX objective_watch_checks_watch_checked_idx
  ON objective_watch_checks (watch_id, checked_at DESC, id DESC);

CREATE INDEX objective_watch_checks_checked_idx
  ON objective_watch_checks (checked_at ASC);
