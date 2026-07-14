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
      terrainWindow: true,
      objectiveWatch: true,
      gpxImport: true,
      reportHistory: true,
      reportSharing: true,
      hourlyWeatherCharts: true,
      elevationForecast: true,
      heatRiskDetails: true,
      fireRiskDetails: true,
      snowpackDetails: true,
      fieldObservations: true,
      airQualityDetails: true,
      gearRecommendations: true,
      windLoadingDetails: true,
      daylightTimeline: true,
      scoreBreakdown: true,
      weatherContextDetails: true,
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

  await updateFeatureFlags({
    tripPlanning: false,
    routeAnalysis: false,
    satelliteImagery: false,
    startTimeComparisons: false,
    terrainWindow: false,
    objectiveWatch: false,
    gpxImport: false,
    reportHistory: false,
    reportSharing: false,
    hourlyWeatherCharts: false,
    elevationForecast: false,
    heatRiskDetails: false,
    fireRiskDetails: false,
    snowpackDetails: false,
    fieldObservations: false,
    airQualityDetails: false,
    gearRecommendations: false,
    windLoadingDetails: false,
    daylightTimeline: false,
    scoreBreakdown: false,
    weatherContextDetails: false,
  });
  const status = await resetFeatureFlags();

  expect(status.flags).toEqual({
    tripPlanning: true,
    routeAnalysis: true,
    satelliteImagery: true,
    startTimeComparisons: true,
    terrainWindow: true,
    objectiveWatch: true,
    gpxImport: true,
    reportHistory: true,
    reportSharing: true,
    hourlyWeatherCharts: true,
    elevationForecast: true,
    heatRiskDetails: true,
    fireRiskDetails: true,
    snowpackDetails: true,
    fieldObservations: true,
    airQualityDetails: true,
    gearRecommendations: true,
    windLoadingDetails: true,
    daylightTimeline: true,
    scoreBreakdown: true,
    weatherContextDetails: true,
  });
  expect(getFeatureFlags()).toEqual(status.flags);
});

test('product feature flags load from PostgreSQL', async () => {
  const getAdminSetting = jest.fn().mockResolvedValue({
    tripPlanning: false,
    routeAnalysis: true,
    satelliteImagery: true,
    startTimeComparisons: false,
    terrainWindow: false,
    objectiveWatch: true,
    gpxImport: false,
    reportHistory: true,
    reportSharing: false,
    hourlyWeatherCharts: false,
    elevationForecast: true,
    heatRiskDetails: false,
    fireRiskDetails: true,
    snowpackDetails: false,
    fieldObservations: true,
    airQualityDetails: false,
    gearRecommendations: true,
    windLoadingDetails: false,
    daylightTimeline: true,
    scoreBreakdown: false,
    weatherContextDetails: true,
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
      terrainWindow: false,
      objectiveWatch: true,
      gpxImport: false,
      reportHistory: true,
      reportSharing: false,
      hourlyWeatherCharts: false,
      elevationForecast: true,
      heatRiskDetails: false,
      fireRiskDetails: true,
      snowpackDetails: false,
      fieldObservations: true,
      airQualityDetails: false,
      gearRecommendations: true,
      windLoadingDetails: false,
      daylightTimeline: true,
      scoreBreakdown: false,
      weatherContextDetails: true,
  });
  expect(featureFlagStore.getFeatureFlagStatus().persistent).toBe(true);
});

test('disabled product features fail closed', async () => {
  const { assertFeatureEnabled, updateFeatureFlags } = loadFeatureFlags();
  await updateFeatureFlags({ tripPlanning: false });

  expect(() => assertFeatureEnabled('tripPlanning')).toThrow('This feature is unavailable');
  expect(() => assertFeatureEnabled('routeAnalysis')).not.toThrow();
  expect(() => assertFeatureEnabled('satelliteImagery')).not.toThrow();
  expect(() => assertFeatureEnabled('terrainWindow')).not.toThrow();
  expect(() => assertFeatureEnabled('objectiveWatch')).not.toThrow();
  expect(() => assertFeatureEnabled('gpxImport')).not.toThrow();
  expect(() => assertFeatureEnabled('reportHistory')).not.toThrow();
  expect(() => assertFeatureEnabled('reportSharing')).not.toThrow();
  expect(() => assertFeatureEnabled('hourlyWeatherCharts')).not.toThrow();
  expect(() => assertFeatureEnabled('elevationForecast')).not.toThrow();
  expect(() => assertFeatureEnabled('heatRiskDetails')).not.toThrow();
  expect(() => assertFeatureEnabled('fireRiskDetails')).not.toThrow();
  expect(() => assertFeatureEnabled('snowpackDetails')).not.toThrow();
  expect(() => assertFeatureEnabled('fieldObservations')).not.toThrow();
  expect(() => assertFeatureEnabled('airQualityDetails')).not.toThrow();
  expect(() => assertFeatureEnabled('gearRecommendations')).not.toThrow();
  expect(() => assertFeatureEnabled('windLoadingDetails')).not.toThrow();
  expect(() => assertFeatureEnabled('daylightTimeline')).not.toThrow();
  expect(() => assertFeatureEnabled('scoreBreakdown')).not.toThrow();
  expect(() => assertFeatureEnabled('weatherContextDetails')).not.toThrow();
});
