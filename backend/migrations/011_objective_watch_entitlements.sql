WITH watch_tiers AS (
  SELECT
    watches.id,
    COALESCE((
      SELECT CASE
        WHEN LOWER(account_subscription.plan_key) = 'premium'
          OR LEFT(LOWER(account_subscription.plan_key), 8) = 'premium_'
        THEN 'premium'
        ELSE 'free'
      END
      FROM subscriptions account_subscription
      WHERE account_subscription.user_id = watches.user_id
        AND LOWER(account_subscription.status) IN ('active', 'trialing')
        AND (account_subscription.current_period_end IS NULL OR account_subscription.current_period_end > NOW())
        AND (
          (LOWER(account_subscription.provider) = 'admin' AND LOWER(account_subscription.plan_key) IN ('free', 'premium'))
          OR LOWER(account_subscription.plan_key) = 'premium'
          OR LEFT(LOWER(account_subscription.plan_key), 8) = 'premium_'
        )
      ORDER BY CASE WHEN LOWER(account_subscription.provider) = 'admin' THEN 0 ELSE 1 END,
               account_subscription.updated_at DESC
      LIMIT 1
    ), 'free') AS tier_key
  FROM objective_watches watches
)
UPDATE objective_watches watches
SET next_check_at = NULL,
    notifications_enabled = FALSE
FROM watch_tiers
WHERE watches.id = watch_tiers.id
  AND watch_tiers.tier_key = 'free';
