UPDATE objective_watches watches
SET next_check_at = CASE
      WHEN watches.last_checked_at IS NULL THEN NOW()
      ELSE GREATEST(
        NOW(),
        watches.last_checked_at + make_interval(mins => CASE
          WHEN CASE
            WHEN watches.plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              AND COALESCE(NULLIF(watches.plan->>'alpineStartTime', ''), '12:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            THEN CONCAT(
              watches.plan->>'forecastDate',
              'T',
              COALESCE(NULLIF(watches.plan->>'alpineStartTime', ''), '12:00'),
              ':00Z'
            )::timestamptz
            ELSE NULL
          END <= NOW() + INTERVAL '48 hours'
          THEN LEAST(scheduler.check_interval_minutes, 60)
          ELSE scheduler.check_interval_minutes
        END)
      )
    END,
    updated_at = NOW()
FROM objective_watch_scheduler_state scheduler
WHERE scheduler.id = 1
  AND watches.next_check_at IS NOT NULL
  AND CASE
    WHEN watches.plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN (watches.plan->>'forecastDate')::date
    ELSE NULL
  END >= ((NOW() - INTERVAL '14 hours') AT TIME ZONE 'UTC')::date;
