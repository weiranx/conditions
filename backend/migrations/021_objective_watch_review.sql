ALTER TABLE objective_watches
  ADD COLUMN reference_signals JSONB,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN objective_watches.reference_signals IS
  'Condition signals that later checks are compared with. Each signal advances only when a change to it is reported, so gradual drift still adds up to a reported change. NULL compares with the latest snapshot, else the baseline report.';

COMMENT ON COLUMN objective_watches.reviewed_at IS
  'When the account holder last marked this watch''s changes reviewed. Change events created later still need review; NULL means none have been reviewed.';

-- Changes now record whether conditions got worse, better, or both. Derive it
-- for stored events from their reason keys, which name every improvement.
WITH directions AS (
  SELECT events.id,
         COUNT(*) FILTER (WHERE improvement) AS better_count,
         COUNT(*) FILTER (WHERE NOT improvement) AS worse_count
  FROM objective_watch_events events
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(events.change->'reasons') = 'array' THEN events.change->'reasons' ELSE '[]'::jsonb END
  ) AS reasons(reason)
  CROSS JOIN LATERAL (
    SELECT RIGHT(COALESCE(reason->>'key', ''), 12) = '_improvement'
      OR COALESCE(reason->>'key', '') IN ('closure_lifted', 'weather_alert_cleared') AS improvement
  ) AS classified
  WHERE jsonb_typeof(events.change) = 'object'
    AND NOT events.change ? 'direction'
  GROUP BY events.id
)
UPDATE objective_watch_events events
SET change = jsonb_set(events.change, '{direction}', to_jsonb(CASE
  WHEN directions.worse_count > 0 AND directions.better_count > 0 THEN 'mixed'
  WHEN directions.better_count > 0 THEN 'better'
  ELSE 'worse'
END::text))
FROM directions
WHERE events.id = directions.id;
