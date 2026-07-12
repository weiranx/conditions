const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');

const FEATURE_FLAG_KEYS = ['tripPlanning', 'satelliteImagery', 'startTimeComparisons'];
const FEATURE_FLAG_KEY_SET = new Set(FEATURE_FLAG_KEYS);
const DEFAULT_FEATURE_FLAGS = Object.freeze(Object.fromEntries(
  FEATURE_FLAG_KEYS.map((flag) => [flag, true]),
));
const FEATURE_FLAGS_FILE = process.env.FEATURE_FLAGS_FILE
  ? path.resolve(process.env.FEATURE_FLAGS_FILE)
  : process.env.NODE_ENV === 'test'
    ? null
    : path.resolve(__dirname, '../../data/feature-flags.json');

let featureFlags = { ...DEFAULT_FEATURE_FLAGS };

const loadPersistedFeatureFlags = () => {
  if (!FEATURE_FLAGS_FILE || !fs.existsSync(FEATURE_FLAGS_FILE)) return;
  try {
    const persisted = JSON.parse(fs.readFileSync(FEATURE_FLAGS_FILE, 'utf8'));
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
      throw new TypeError('Persisted feature flags must be an object');
    }
    FEATURE_FLAG_KEYS.forEach((flag) => {
      if (typeof persisted[flag] === 'boolean') {
        featureFlags[flag] = persisted[flag];
      } else if (persisted[flag] !== undefined) {
        logger.warn({ file: FEATURE_FLAGS_FILE, flag }, 'Ignoring invalid persisted feature flag value');
      }
    });
    logger.info({ file: FEATURE_FLAGS_FILE, flags: featureFlags }, 'Loaded persisted product feature flags');
  } catch (error) {
    logger.error({ err: error, file: FEATURE_FLAGS_FILE }, 'Failed to load feature flags; using defaults');
  }
};

const persistFeatureFlags = () => {
  if (!FEATURE_FLAGS_FILE) return;
  const tempFile = `${FEATURE_FLAGS_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FEATURE_FLAGS_FILE), { recursive: true });
    fs.writeFileSync(
      tempFile,
      `${JSON.stringify(featureFlags, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    fs.renameSync(tempFile, FEATURE_FLAGS_FILE);
  } catch (error) {
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      // Preserve the original write failure.
    }
    throw error;
  }
};

loadPersistedFeatureFlags();

const getFeatureFlags = () => ({ ...featureFlags });

const getFeatureFlagStatus = () => ({
  persistent: Boolean(FEATURE_FLAGS_FILE),
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

  const previous = featureFlags;
  featureFlags = { ...featureFlags, ...updates };
  try {
    persistFeatureFlags();
  } catch (error) {
    featureFlags = previous;
    logger.error({ err: error, file: FEATURE_FLAGS_FILE }, 'Failed to persist product feature flags');
    const persistenceError = new Error('Feature flags could not be saved');
    persistenceError.code = 'FEATURE_FLAGS_PERSIST_FAILED';
    persistenceError.cause = error;
    throw persistenceError;
  }
  logger.warn({ previous, current: featureFlags }, 'Product feature flags changed by administrator');
  return getFeatureFlagStatus();
};

module.exports = {
  assertFeatureEnabled,
  getFeatureFlags,
  getFeatureFlagStatus,
  isFeatureEnabled,
  updateFeatureFlags,
};
