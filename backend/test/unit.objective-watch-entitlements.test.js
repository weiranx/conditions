const {
  ObjectiveWatchLimitError,
  ObjectiveWatchPremiumRequiredError,
  resolveObjectiveWatchPolicy,
} = require('../src/auth/objective-watch-entitlements');

test('resolves the Free Objective Watch contract', () => {
  expect(resolveObjectiveWatchPolicy('free')).toEqual({
    tierKey: 'free',
    activeWatchLimit: 1,
    automaticChecks: false,
    emailAlerts: false,
    historyDays: 14,
    manualRefreshCooldownMinutes: 5,
  });
});

test('resolves the Premium Objective Watch contract', () => {
  expect(resolveObjectiveWatchPolicy('premium')).toEqual({
    tierKey: 'premium',
    activeWatchLimit: 10,
    automaticChecks: true,
    emailAlerts: true,
    historyDays: 90,
    manualRefreshCooldownMinutes: 5,
  });
});

test('returns structured limit and upgrade errors', () => {
  const policy = resolveObjectiveWatchPolicy('free');
  expect(new ObjectiveWatchLimitError(policy)).toMatchObject({
    code: 'OBJECTIVE_WATCH_LIMIT_REACHED',
    statusCode: 403,
    policy,
  });
  expect(new ObjectiveWatchPremiumRequiredError('Email alerts', policy)).toMatchObject({
    code: 'OBJECTIVE_WATCH_PREMIUM_REQUIRED',
    statusCode: 403,
    policy,
  });
});
