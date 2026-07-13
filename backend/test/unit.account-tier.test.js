const {
  FREE_ACCOUNT_TIER,
  createAccountTierService,
  isPremiumPlanKey,
  resolveAccountTier,
} = require('../src/auth/account-tier');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const NOW = '2026-07-13T08:00:00.000Z';

test('recognizes supported premium plan keys', () => {
  expect(isPremiumPlanKey('premium')).toBe(true);
  expect(isPremiumPlanKey('PREMIUM_ANNUAL')).toBe(true);
  expect(isPremiumPlanKey('free')).toBe(false);
  expect(isPremiumPlanKey('premiumish')).toBe(false);
});

test('defaults accounts without a current premium subscription to Free', () => {
  expect(resolveAccountTier([], NOW)).toEqual(FREE_ACCOUNT_TIER);
  expect(resolveAccountTier([
    { plan_key: 'premium', status: 'canceled', current_period_end: '2026-08-01T00:00:00.000Z' },
    { plan_key: 'premium', status: 'active', current_period_end: '2026-07-01T00:00:00.000Z' },
  ], NOW)).toEqual(FREE_ACCOUNT_TIER);
});

test('resolves active and trialing premium subscriptions through their current period', () => {
  expect(resolveAccountTier([{
    plan_key: 'premium_monthly',
    status: 'active',
    current_period_end: new Date('2026-08-01T00:00:00.000Z'),
    cancel_at_period_end: true,
  }], NOW)).toEqual({
    key: 'premium',
    label: 'Premium',
    status: 'active',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: true,
  });
  expect(resolveAccountTier([{ planKey: 'premium', status: 'trialing' }], NOW))
    .toMatchObject({ key: 'premium', status: 'trialing' });
});

test('uses an active administrator tier override ahead of billing subscriptions', () => {
  const paidSubscription = {
    provider: 'stripe',
    plan_key: 'premium_monthly',
    status: 'active',
    current_period_end: '2026-08-01T00:00:00.000Z',
  };
  expect(resolveAccountTier([
    { provider: 'admin', plan_key: 'free', status: 'active' },
    paidSubscription,
  ], NOW)).toEqual(FREE_ACCOUNT_TIER);
  expect(resolveAccountTier([
    { provider: 'admin', plan_key: 'premium', status: 'active' },
  ], NOW)).toMatchObject({ key: 'premium', status: 'active' });
});

test('loads subscription state for one account from the database', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{
      plan_key: 'premium_annual',
      status: 'active',
      current_period_end: '2027-01-01T00:00:00.000Z',
      cancel_at_period_end: false,
    }],
  });
  const service = createAccountTierService({
    database: { configured: true, query },
    now: () => Date.parse(NOW),
  });

  await expect(service.getAccountTier(USER_ID)).resolves.toMatchObject({ key: 'premium' });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM subscriptions'), [USER_ID]);
  expect(query.mock.calls[0][0]).toContain("provider = 'admin'");
});

test('uses Free when subscription storage is not configured', async () => {
  const service = createAccountTierService({ database: { configured: false } });

  await expect(service.getAccountTier(USER_ID)).resolves.toEqual(FREE_ACCOUNT_TIER);
});
