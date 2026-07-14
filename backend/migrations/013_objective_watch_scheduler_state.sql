CREATE TABLE objective_watch_scheduler_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  check_interval_minutes INTEGER NOT NULL DEFAULT 180
    CHECK (check_interval_minutes BETWEEN 60 AND 1440 AND check_interval_minutes % 60 = 0),
  last_heartbeat_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'waiting',
  last_error TEXT,
  last_summary JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO objective_watch_scheduler_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
