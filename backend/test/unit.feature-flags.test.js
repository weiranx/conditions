const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalSettingsFile = process.env.FEATURE_FLAGS_FILE;

const loadFeatureFlags = (settingsFile) => {
  if (settingsFile) process.env.FEATURE_FLAGS_FILE = settingsFile;
  else delete process.env.FEATURE_FLAGS_FILE;
  jest.resetModules();
  return require('../src/utils/feature-flags');
};

afterEach(() => {
  if (originalSettingsFile === undefined) delete process.env.FEATURE_FLAGS_FILE;
  else process.env.FEATURE_FLAGS_FILE = originalSettingsFile;
  jest.resetModules();
});

test('product feature flags default to enabled and update independently', () => {
  const { getFeatureFlagStatus, isFeatureEnabled, updateFeatureFlags } = loadFeatureFlags();

  expect(getFeatureFlagStatus()).toEqual({
    persistent: false,
    flags: {
      tripPlanning: true,
      satelliteImagery: true,
      startTimeComparisons: true,
    },
  });

  updateFeatureFlags({ satelliteImagery: false });
  expect(isFeatureEnabled('satelliteImagery')).toBe(false);
  expect(isFeatureEnabled('tripPlanning')).toBe(true);
});

test('product feature flags reject unknown or non-boolean values', () => {
  const { updateFeatureFlags } = loadFeatureFlags();

  expect(() => updateFeatureFlags({ unknownFlag: false })).toThrow('Unknown feature flag');
  expect(() => updateFeatureFlags({ tripPlanning: 'off' })).toThrow('tripPlanning must be a boolean');
});

test('product feature flags persist across module reloads', () => {
  const settingsFile = path.join(os.tmpdir(), `conditions-feature-flags-${process.pid}-${Date.now()}.json`);
  try {
    const first = loadFeatureFlags(settingsFile);
    first.updateFeatureFlags({ tripPlanning: false, startTimeComparisons: false });

    expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).toEqual({
      tripPlanning: false,
      satelliteImagery: true,
      startTimeComparisons: false,
    });
    expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o600);

    const reloaded = loadFeatureFlags(settingsFile);
    expect(reloaded.getFeatureFlags()).toEqual({
      tripPlanning: false,
      satelliteImagery: true,
      startTimeComparisons: false,
    });
  } finally {
    fs.rmSync(settingsFile, { force: true });
  }
});

test('disabled product features fail closed', () => {
  const { assertFeatureEnabled, updateFeatureFlags } = loadFeatureFlags();
  updateFeatureFlags({ tripPlanning: false });

  expect(() => assertFeatureEnabled('tripPlanning')).toThrow('This feature is unavailable');
  expect(() => assertFeatureEnabled('satelliteImagery')).not.toThrow();
});
