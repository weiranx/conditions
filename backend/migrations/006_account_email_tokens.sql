ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Google only returns identities whose email claim it has verified. Preserve
-- that trust for existing Google accounts when the column is introduced.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, NOW())
WHERE auth_provider = 'google'
   OR EXISTS (
     SELECT 1
     FROM account_identities
     WHERE account_identities.user_id = users.id
       AND account_identities.provider = 'google'
   );

CREATE TABLE account_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX account_action_tokens_user_purpose_created_idx
  ON account_action_tokens (user_id, purpose, created_at DESC);

CREATE INDEX account_action_tokens_expires_idx
  ON account_action_tokens (expires_at)
  WHERE consumed_at IS NULL;
