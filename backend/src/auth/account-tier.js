'use strict';

const FREE_ACCOUNT_TIER = Object.freeze({
  key: 'free',
  label: 'Free',
  status: 'active',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

const PREMIUM_ACCOUNT_TIER_KEY = 'premium';
const PREMIUM_ACCOUNT_TIER_LABEL = 'Premium';
const PREMIUM_STATUSES = new Set(['active', 'trialing']);
const ADMIN_TIER_PROVIDER = 'admin';

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const isPremiumPlanKey = (value) => {
  const planKey = normalizeValue(value);
  return planKey === PREMIUM_ACCOUNT_TIER_KEY || planKey.startsWith(`${PREMIUM_ACCOUNT_TIER_KEY}_`);
};

const serializePeriodEnd = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const resolveAccountTier = (subscriptions = [], now = Date.now()) => {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid date is required');

  const isCurrent = (subscription) => {
    if (!PREMIUM_STATUSES.has(normalizeValue(subscription?.status))) return false;
    const currentPeriodEnd = serializePeriodEnd(
      subscription?.current_period_end ?? subscription?.currentPeriodEnd,
    );
    return !currentPeriodEnd || new Date(currentPeriodEnd).getTime() > nowMs;
  };
  const adminOverride = subscriptions.find((subscription) => (
    normalizeValue(subscription?.provider) === ADMIN_TIER_PROVIDER
    && ['free', PREMIUM_ACCOUNT_TIER_KEY].includes(normalizeValue(subscription?.plan_key ?? subscription?.planKey))
    && isCurrent(subscription)
  ));
  if (adminOverride) {
    if (!isPremiumPlanKey(adminOverride.plan_key ?? adminOverride.planKey)) {
      return { ...FREE_ACCOUNT_TIER };
    }
    return {
      key: PREMIUM_ACCOUNT_TIER_KEY,
      label: PREMIUM_ACCOUNT_TIER_LABEL,
      status: normalizeValue(adminOverride.status),
      currentPeriodEnd: serializePeriodEnd(
        adminOverride.current_period_end ?? adminOverride.currentPeriodEnd,
      ),
      cancelAtPeriodEnd: Boolean(
        adminOverride.cancel_at_period_end ?? adminOverride.cancelAtPeriodEnd,
      ),
    };
  }

  const premiumSubscription = subscriptions.find((subscription) => {
    if (!isPremiumPlanKey(subscription?.plan_key ?? subscription?.planKey)) return false;
    return isCurrent(subscription);
  });

  if (!premiumSubscription) return { ...FREE_ACCOUNT_TIER };

  return {
    key: PREMIUM_ACCOUNT_TIER_KEY,
    label: PREMIUM_ACCOUNT_TIER_LABEL,
    status: normalizeValue(premiumSubscription.status),
    currentPeriodEnd: serializePeriodEnd(
      premiumSubscription.current_period_end ?? premiumSubscription.currentPeriodEnd,
    ),
    cancelAtPeriodEnd: Boolean(
      premiumSubscription.cancel_at_period_end ?? premiumSubscription.cancelAtPeriodEnd,
    ),
  };
};

const createAccountTierService = ({ database, now = Date.now } = {}) => {
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const getAccountTier = async (userId) => {
    if (!userId) throw new TypeError('userId is required');
    if (!available) return { ...FREE_ACCOUNT_TIER };

    const result = await database.query(`
      SELECT provider, plan_key, status, current_period_end, cancel_at_period_end
      FROM subscriptions
      WHERE user_id = $1
      ORDER BY CASE WHEN provider = 'admin' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 20
    `, [userId]);

    return resolveAccountTier(result?.rows || [], now());
  };

  return {
    available,
    getAccountTier,
  };
};

module.exports = {
  FREE_ACCOUNT_TIER,
  PREMIUM_ACCOUNT_TIER_KEY,
  createAccountTierService,
  isPremiumPlanKey,
  resolveAccountTier,
};
