'use strict';

const FREE_ACTIVE_WATCH_LIMIT = 1;
const PREMIUM_ACTIVE_WATCH_LIMIT = 10;
const FREE_HISTORY_DAYS = 14;
const PREMIUM_HISTORY_DAYS = 90;
const MANUAL_REFRESH_COOLDOWN_MINUTES = 5;

const resolveObjectiveWatchPolicy = (tierKey) => {
  const premium = tierKey === 'premium';
  return {
    tierKey: premium ? 'premium' : 'free',
    activeWatchLimit: premium ? PREMIUM_ACTIVE_WATCH_LIMIT : FREE_ACTIVE_WATCH_LIMIT,
    automaticChecks: premium,
    emailAlerts: premium,
    historyDays: premium ? PREMIUM_HISTORY_DAYS : FREE_HISTORY_DAYS,
    manualRefreshCooldownMinutes: MANUAL_REFRESH_COOLDOWN_MINUTES,
  };
};

class ObjectiveWatchLimitError extends Error {
  constructor(policy) {
    super(`${policy.tierKey === 'premium' ? 'Premium' : 'Free'} includes up to ${policy.activeWatchLimit} active objective ${policy.activeWatchLimit === 1 ? 'watch' : 'watches'}. Stop a watch before adding another.`);
    this.name = 'ObjectiveWatchLimitError';
    this.code = 'OBJECTIVE_WATCH_LIMIT_REACHED';
    this.statusCode = 403;
    this.policy = policy;
  }
}

class ObjectiveWatchPremiumRequiredError extends Error {
  constructor(feature, policy) {
    super(`${feature} requires Premium. Free includes one manually refreshed objective watch.`);
    this.name = 'ObjectiveWatchPremiumRequiredError';
    this.code = 'OBJECTIVE_WATCH_PREMIUM_REQUIRED';
    this.statusCode = 403;
    this.policy = policy;
  }
}

module.exports = {
  FREE_ACTIVE_WATCH_LIMIT,
  FREE_HISTORY_DAYS,
  MANUAL_REFRESH_COOLDOWN_MINUTES,
  ObjectiveWatchLimitError,
  ObjectiveWatchPremiumRequiredError,
  PREMIUM_ACTIVE_WATCH_LIMIT,
  PREMIUM_HISTORY_DAYS,
  resolveObjectiveWatchPolicy,
};
