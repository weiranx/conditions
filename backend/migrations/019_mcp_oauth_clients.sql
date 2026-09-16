-- Dynamically registered clients never receive access without user consent.
CREATE TABLE mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  secret_hash CHAR(64),
  auth_method TEXT NOT NULL CHECK (auth_method IN ('none','client_secret_post','client_secret_basic')),
  redirect_uris JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
