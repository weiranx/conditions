CREATE TABLE account_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_at_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

CREATE INDEX account_identities_user_id_idx
  ON account_identities (user_id);

INSERT INTO account_identities (provider, subject, user_id, email_at_link)
SELECT auth_provider, auth_subject, id, email
FROM users
ON CONFLICT DO NOTHING;
