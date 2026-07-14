CREATE TABLE feature_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  anonymous_id UUID,
  feature_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((user_id IS NOT NULL) <> (anonymous_id IS NOT NULL)),
  UNIQUE (feature_key, idempotency_key)
);

CREATE INDEX feature_usage_events_user_feature_created_idx
  ON feature_usage_events (user_id, feature_key, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX feature_usage_events_anonymous_feature_created_idx
  ON feature_usage_events (anonymous_id, feature_key, created_at DESC)
  WHERE anonymous_id IS NOT NULL;
