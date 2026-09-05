-- Stable account-history paging uses creation time so AI edits do not move reports between pages.
CREATE INDEX IF NOT EXISTS saved_reports_user_created_id_idx
  ON saved_reports (user_id, created_at DESC, id DESC);
