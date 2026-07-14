ALTER TABLE objective_watches
  ADD COLUMN last_checked_at TIMESTAMPTZ,
  ADD COLUMN next_check_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN last_snapshot JSONB,
  ADD COLUMN last_change JSONB,
  ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX objective_watches_next_check_idx
  ON objective_watches (next_check_at ASC)
  WHERE next_check_at IS NOT NULL;

CREATE TABLE objective_watch_events (
  id BIGSERIAL PRIMARY KEY,
  watch_id UUID NOT NULL REFERENCES objective_watches(id) ON DELETE CASCADE,
  change_key CHAR(64) NOT NULL,
  change JSONB NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (notification_status IN ('not_requested', 'pending', 'sent', 'failed')),
  notification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (notification_attempts >= 0),
  notification_error TEXT,
  notified_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watch_id, change_key)
);

CREATE INDEX objective_watch_events_watch_checked_idx
  ON objective_watch_events (watch_id, checked_at DESC);

CREATE INDEX objective_watch_events_pending_idx
  ON objective_watch_events (notification_status, notification_attempts, created_at)
  WHERE notification_status IN ('pending', 'failed');
