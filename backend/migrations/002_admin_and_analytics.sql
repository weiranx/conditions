CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE report_activity_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  legacy_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX report_activity_events_occurred_idx
  ON report_activity_events (occurred_at DESC, id DESC);

CREATE TABLE admin_audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_network TEXT,
  details JSONB,
  legacy_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_events_occurred_idx
  ON admin_audit_events (occurred_at DESC, id DESC);

CREATE TABLE legacy_data_imports (
  source TEXT NOT NULL,
  checksum TEXT NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0 CHECK (rows_imported >= 0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, checksum)
);
