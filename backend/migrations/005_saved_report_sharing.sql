ALTER TABLE saved_reports
  ADD COLUMN share_token TEXT;

UPDATE saved_reports
SET share_token = encode(gen_random_bytes(18), 'hex')
WHERE share_token IS NULL;

ALTER TABLE saved_reports
  ALTER COLUMN share_token SET NOT NULL,
  ADD CONSTRAINT saved_reports_share_token_format
    CHECK (share_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  ADD CONSTRAINT saved_reports_share_token_unique UNIQUE (share_token);
