const { appDataStore } = require('../db/app-data-store');
const { logger } = require('./logger');

const FEATURE_FLAG_KEYS = ['tripPlanning', 'routeAnalysis', 'satelliteImagery', 'startTimeComparisons'];
const FEATURE_FLAG_KEY_SET = new Set(FEATURE_FLAG_KEYS);
const DEFAULT_FEATURE_FLAGS = Object.freeze(Object.fromEntries(
  FEATURE_FLAG_KEYS.map((flag) => [flag, true]),
));

let featureFlags = { ...DEFAULT_FEATURE_FLAGS };

const validateFeatureFlagUpdates = (updates) => {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    const error = new TypeError('flags must be an object');
    error.code = 'INVALID_FEATURE_FLAGS';
    throw error;
  }
  const entries = Object.entries(updates);
  if (entries.length === 0) {
    const error = new TypeError('Provide at least one feature flag');
    error.code = 'INVALID_FEATURE_FLAGS';
    throw error;
  }
  entries.forEach(([flag, value]) => {
    if (!FEATURE_FLAG_KEY_SET.has(flag)) {
      const error = new TypeError(`Unknown feature flag: ${flag}`);
      error.code = 'INVALID_FEATURE_FLAGS';
      throw error;
    }
    if (typeof value !== 'boolean') {
      const error = new TypeError(`${flag} must be a boolean`);
      error.code = 'INVALID_FEATURE_FLAGS';
      throw error;
    }
  });
};

const initializeFeatureFlags = async () => {
  const persisted = await appDataStore.getAdminSetting('feature_flags');
  if (!persisted) return;
  if (typeof persisted !== 'object' || Array.isArray(persisted)) {
    logger.error('Ignoring invalid PostgreSQL feature flag settings');
    return;
  }
  const loaded = { ...DEFAULT_FEATURE_FLAGS };
  FEATURE_FLAG_KEYS.forEach((flag) => {
    if (typeof persisted[flag] === 'boolean') loaded[flag] = persisted[flag];
    else if (persisted[flag] !== undefined) {
      logger.warn({ flag }, 'Ignoring invalid PostgreSQL feature flag value');
    }
  });
  featureFlags = loaded;
  logger.info({ flags: featureFlags }, 'Loaded product feature flags from PostgreSQL');
};

const getFeatureFlags = () => ({ ...featureFlags });

const getFeatureFlagStatus = () => ({
  persistent: appDataStore.configured,
  flags: getFeatureFlags(),
});

const isFeatureEnabled = (flag) => FEATURE_FLAG_KEY_SET.has(flag) && featureFlags[flag];

const assertFeatureEnabled = (flag) => {
  if (!FEATURE_FLAG_KEY_SET.has(flag)) {
    throw new TypeError(`Unknown feature flag: ${flag}`);
  }
  if (featureFlags[flag]) return;
  const error = new Error('This feature is unavailable');
  error.code = 'FEATURE_DISABLED';
  error.statusCode = 503;
  throw error;
};

const updateFeatureFlags = (updates) => {
  validateFeatureFlagUpdates(updates);
  const previous = featureFlags;
  const next = { ...featureFlags, ...updates };
  return appDataStore.setAdminSetting('feature_flags', next)
    .then(() => {
      featureFlags = next;
      logger.warn({ previous, current: featureFlags }, 'Product feature flags changed by administrator');
      return getFeatureFlagStatus();
    })
    .catch((error) => {
      logger.error({ err: error }, 'Failed to persist product feature flags to PostgreSQL');
      const persistenceError = new Error('Feature flags could not be saved');
      persistenceError.code = 'FEATURE_FLAGS_PERSIST_FAILED';
      persistenceError.cause = error;
      throw persistenceError;
    });
};

const resetFeatureFlags = () => updateFeatureFlags(DEFAULT_FEATURE_FLAGS);

module.exports = {
  assertFeatureEnabled,
  getFeatureFlags,
  getFeatureFlagStatus,
  initializeFeatureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
  updateFeatureFlags,
};
