-- OAuth credentials are independent of browser cookies and stored only as hashes.
CREATE TABLE mcp_oauth_requests (
  token_hash CHAR(64) PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);
CREATE TABLE mcp_oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX mcp_oauth_grants_user ON mcp_oauth_grants(user_id);
CREATE TABLE mcp_oauth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX mcp_oauth_tokens_grant ON mcp_oauth_tokens(grant_id);
