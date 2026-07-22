ALTER TABLE objective_watches
  ADD COLUMN last_attempted_at TIMESTAMPTZ,
  ADD COLUMN check_claimed_at TIMESTAMPTZ,
  ADD COLUMN check_claim_token UUID,
  ADD CONSTRAINT objective_watches_check_claim_state_check
    CHECK ((check_claimed_at IS NULL) = (check_claim_token IS NULL));

UPDATE objective_watches
SET last_attempted_at = GREATEST(
  last_checked_at,
  (
    SELECT MAX(checks.checked_at)
    FROM objective_watch_checks checks
    WHERE checks.watch_id = objective_watches.id
  )
)
WHERE last_checked_at IS NOT NULL
   OR EXISTS (
     SELECT 1
     FROM objective_watch_checks checks
     WHERE checks.watch_id = objective_watches.id
   );

CREATE INDEX objective_watches_check_claim_idx
  ON objective_watches (check_claimed_at ASC)
  WHERE check_claim_token IS NOT NULL;

COMMENT ON COLUMN objective_watches.last_attempted_at IS
  'Most recent automatic or manual check attempt, including failed attempts; used for manual refresh cooldowns.';

COMMENT ON COLUMN objective_watches.check_claimed_at IS
  'Start time for the current expiring Objective Watch check lease.';

COMMENT ON COLUMN objective_watches.check_claim_token IS
  'Token owning the current Objective Watch check lease; cleared when processing finishes.';
