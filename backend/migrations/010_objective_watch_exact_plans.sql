WITH valid_plans AS (
  SELECT
    id,
    TO_CHAR(ROUND((plan->>'lat')::numeric, 4), 'FM999999990.0000') AS lat,
    TO_CHAR(ROUND((plan->>'lon')::numeric, 4), 'FM999999990.0000') AS lon,
    plan->>'forecastDate' AS forecast_date,
    plan->>'alpineStartTime' AS alpine_start_time,
    ((plan->>'travelWindowHours')::numeric)::integer AS travel_window_hours
  FROM objective_watches
  WHERE plan->>'lat' ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND plan->>'lon' ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND plan->>'forecastDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND plan->>'alpineStartTime' ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
    AND plan->>'travelWindowHours' ~ '^[0-9]+$'
    AND (plan->>'travelWindowHours')::numeric BETWEEN 1 AND 24
)
UPDATE objective_watches AS watches
SET fingerprint = CONCAT_WS(
  ':',
  valid_plans.lat,
  valid_plans.lon,
  valid_plans.forecast_date,
  valid_plans.alpine_start_time,
  valid_plans.travel_window_hours
)
FROM valid_plans
WHERE watches.id = valid_plans.id;

COMMENT ON COLUMN objective_watches.fingerprint IS
  'Normalized coordinates, forecast date, start time, and travel window for one exact watched plan.';
