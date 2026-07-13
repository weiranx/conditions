const loadFeatureFlags = () => {
  jest.resetModules();
  return require('../src/utils/feature-flags');
};

afterEach(() => {
  jest.dontMock('../src/db/app-data-store');
  jest.resetModules();
});

test('product feature flags default to enabled and update independently', async () => {
  const { getFeatureFlagStatus, isFeatureEnabled, updateFeatureFlags } = loadFeatureFlags();

  expect(getFeatureFlagStatus()).toEqual({
    persistent: false,
    flags: {
      tripPlanning: true,
      routeAnalysis: true,
      satelliteImagery: true,
      startTimeComparisons: true,
    },
  });

  await updateFeatureFlags({ satelliteImagery: false });
  expect(isFeatureEnabled('satelliteImagery')).toBe(false);
  expect(isFeatureEnabled('tripPlanning')).toBe(true);
});

test('product feature flags reject unknown or non-boolean values', () => {
  const { updateFeatureFlags } = loadFeatureFlags();

  expect(() => updateFeatureFlags({ unknownFlag: false })).toThrow('Unknown feature flag');
  expect(() => updateFeatureFlags({ tripPlanning: 'off' })).toThrow('tripPlanning must be a boolean');
});

test('product feature flags can be restored to enabled defaults', async () => {
  const { getFeatureFlags, resetFeatureFlags, updateFeatureFlags } = loadFeatureFlags();

  await updateFeatureFlags({ tripPlanning: false, routeAnalysis: false, satelliteImagery: false, startTimeComparisons: false });
  const status = await resetFeatureFlags();

  expect(status.flags).toEqual({
    tripPlanning: true,
    routeAnalysis: true,
    satelliteImagery: true,
    startTimeComparisons: true,
  });
  expect(getFeatureFlags()).toEqual(status.flags);
});

test('product feature flags load from PostgreSQL', async () => {
  const getAdminSetting = jest.fn().mockResolvedValue({
    tripPlanning: false,
    routeAnalysis: true,
    satelliteImagery: true,
    startTimeComparisons: false,
  });
  jest.doMock('../src/db/app-data-store', () => ({
    appDataStore: { configured: true, getAdminSetting, setAdminSetting: jest.fn() },
  }));
  const featureFlagStore = loadFeatureFlags();

  await featureFlagStore.initializeFeatureFlags();

  expect(getAdminSetting).toHaveBeenCalledWith('feature_flags');
  expect(featureFlagStore.getFeatureFlags()).toEqual({
      tripPlanning: false,
      routeAnalysis: true,
      satelliteImagery: true,
      startTimeComparisons: false,
  });
  expect(featureFlagStore.getFeatureFlagStatus().persistent).toBe(true);
});

test('disabled product features fail closed', async () => {
  const { assertFeatureEnabled, updateFeatureFlags } = loadFeatureFlags();
  await updateFeatureFlags({ tripPlanning: false });

  expect(() => assertFeatureEnabled('tripPlanning')).toThrow('This feature is unavailable');
  expect(() => assertFeatureEnabled('routeAnalysis')).not.toThrow();
  expect(() => assertFeatureEnabled('satelliteImagery')).not.toThrow();
});
