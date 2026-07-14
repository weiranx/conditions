ALTER TABLE objective_watch_scheduler_state
  DROP CONSTRAINT IF EXISTS objective_watch_scheduler_state_check_interval_minutes_check;

ALTER TABLE objective_watch_scheduler_state
  ADD CONSTRAINT objective_watch_scheduler_state_check_interval_minutes_check
  CHECK (check_interval_minutes BETWEEN 5 AND 1440 AND check_interval_minutes % 5 = 0);
