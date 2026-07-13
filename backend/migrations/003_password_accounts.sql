CREATE TABLE account_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX user_sessions_user_created_idx
  ON user_sessions (user_id, created_at DESC);

CREATE INDEX user_sessions_expires_idx
  ON user_sessions (expires_at);

ALTER TABLE users
  ADD CONSTRAINT users_password_email_required
  CHECK (auth_provider <> 'password' OR email IS NOT NULL);
