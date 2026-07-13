CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (auth_provider, auth_subject)
);

CREATE UNIQUE INDEX users_email_lower_unique
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  provider_subscription_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_status_period_end_idx ON subscriptions (status, current_period_end);

CREATE TABLE entitlements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  source TEXT NOT NULL,
  valid_until TIMESTAMPTZ,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  request_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cost_usd_micros BIGINT NOT NULL DEFAULT 0 CHECK (cost_usd_micros >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_usage_events_user_created_idx ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX ai_usage_events_created_idx ON ai_usage_events (created_at DESC);

CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX saved_reports_user_updated_idx ON saved_reports (user_id, updated_at DESC);

CREATE TABLE billing_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE product_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  anonymous_id TEXT,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX product_events_name_created_idx ON product_events (event_name, created_at DESC);
CREATE INDEX product_events_user_created_idx ON product_events (user_id, created_at DESC);
