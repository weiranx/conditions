'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_RUNTIME_ENV_FILE = path.resolve(__dirname, '../../data/runtime-env.json');

const RUNTIME_ENV_DEFINITIONS = Object.freeze([
  { key: 'REQUEST_TIMEOUT_MS', label: 'External request timeout', category: 'Backend', description: 'Maximum time for upstream weather and data requests.', type: 'integer', min: 1000, max: 120000 },
  { key: 'AVALANCHE_MAP_LAYER_TTL_MS', label: 'Avalanche map cache TTL', category: 'Backend', description: 'How long the avalanche map layer remains cached.', type: 'integer', min: 60000, max: 86400000 },
  { key: 'SNOTEL_STATION_CACHE_TTL_MS', label: 'SNOTEL station cache TTL', category: 'Backend', description: 'How long the SNOTEL station catalog remains cached.', type: 'integer', min: 60000, max: 604800000 },
  { key: 'RATE_LIMIT_WINDOW_MS', label: 'Rate-limit window', category: 'Backend', description: 'Length of the public API rate-limit window.', type: 'integer', min: 1000, max: 86400000 },
  { key: 'RATE_LIMIT_MAX_REQUESTS', label: 'Requests per rate-limit window', category: 'Backend', description: 'Maximum requests accepted from one client in a window.', type: 'integer', min: 1, max: 100000 },
  { key: 'DEBUG_AVY', label: 'Avalanche debug logging', category: 'Backend', description: 'Emit detailed avalanche-pipeline logs.', type: 'boolean' },
  { key: 'LOG_LEVEL', label: 'Log level', category: 'Backend', description: 'Minimum backend log level.', type: 'enum', options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] },

  { key: 'AI_PRIMARY_TIMEOUT_MS', label: 'Primary AI timeout', category: 'AI', description: 'Maximum duration for primary-model requests.', type: 'integer', min: 1000, max: 120000 },
  { key: 'AI_FAST_TIMEOUT_MS', label: 'Fast AI timeout', category: 'AI', description: 'Maximum duration for latency-sensitive model requests.', type: 'integer', min: 1000, max: 120000 },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', category: 'Credentials', description: 'Credential used for OpenAI model requests.', type: 'secret' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', category: 'Credentials', description: 'Credential used for Anthropic model requests.', type: 'secret' },

  { key: 'ACCOUNT_SESSION_DAYS', label: 'Account session lifetime', category: 'Accounts', description: 'Days before an account session expires.', type: 'integer', min: 1, max: 365 },
  { key: 'FREE_MONTHLY_MULTI_DAY_LIMIT', label: 'Free multi-day monthly limit', category: 'Accounts', description: 'Monthly multi-day forecast runs for Free accounts.', type: 'integer', min: 1, max: 1000 },
  { key: 'GUEST_MULTI_DAY_LIMIT', label: 'Guest multi-day limit', category: 'Accounts', description: 'Total multi-day forecast runs for an anonymous browser.', type: 'integer', min: 1, max: 1000 },
  { key: 'GOOGLE_CLIENT_ID', label: 'Google client ID', category: 'Accounts', description: 'Public OAuth client identifier used for Google sign-in.', type: 'text', maxLength: 500 },
  { key: 'RESEND_API_KEY', label: 'Resend API key', category: 'Credentials', description: 'Credential used for account and Objective Watch email.', type: 'secret' },
  { key: 'EMAIL_FROM', label: 'Email from address', category: 'Accounts', description: 'Sender name and address for transactional email.', type: 'text', maxLength: 500 },
  { key: 'APP_BASE_URL', label: 'Application base URL', category: 'Accounts', description: 'Public web origin used in email action links.', type: 'url' },

  { key: 'OBJECTIVE_WATCH_CONCURRENCY', label: 'Objective Watch concurrency', category: 'Objective Watch', description: 'Maximum watches evaluated at the same time.', type: 'integer', min: 1, max: 50 },
  { key: 'OBJECTIVE_WATCH_BATCH_SIZE', label: 'Objective Watch batch size', category: 'Objective Watch', description: 'Maximum watches selected by one checker run.', type: 'integer', min: 1, max: 10000 },
  { key: 'OBJECTIVE_WATCH_CRON_SECRET', label: 'Scheduler credential', category: 'Objective Watch', description: 'Protected credential used by the host cron to trigger automatic checks. Configure it in /opt/summitsafe/.env, then deploy to install the cron.', type: 'secret', editable: false },

  { key: 'NPS_API_KEY', label: 'National Park Service API key', category: 'Credentials', description: 'Enables nearby park alerts and closures.', type: 'secret' },
  { key: 'AIRNOW_API_KEY', label: 'AirNow API key', category: 'Credentials', description: 'Enables EPA AirNow observations.', type: 'secret' },
  { key: 'NASA_FIRMS_MAP_KEY', label: 'NASA FIRMS map key', category: 'Credentials', description: 'Enables active-fire detection data.', type: 'secret' },
  { key: 'SENTINEL_HUB_CLIENT_ID', label: 'Sentinel Hub client ID', category: 'Credentials', description: 'OAuth client identifier for Sentinel imagery.', type: 'secret' },
  { key: 'SENTINEL_HUB_CLIENT_SECRET', label: 'Sentinel Hub client secret', category: 'Credentials', description: 'OAuth client secret for Sentinel imagery.', type: 'secret' },

  { key: 'DATABASE_POOL_MAX', label: 'Database pool size', category: 'Database', description: 'Maximum PostgreSQL connections held by the backend.', type: 'integer', min: 1, max: 100 },
  { key: 'DATABASE_CONNECT_TIMEOUT_MS', label: 'Database connect timeout', category: 'Database', description: 'Maximum wait to establish a PostgreSQL connection.', type: 'integer', min: 100, max: 120000 },
  { key: 'DATABASE_IDLE_TIMEOUT_MS', label: 'Database idle timeout', category: 'Database', description: 'How long an idle PostgreSQL client stays in the pool.', type: 'integer', min: 1000, max: 600000 },
  { key: 'DATABASE_STATEMENT_TIMEOUT_MS', label: 'Database statement timeout', category: 'Database', description: 'Maximum duration allowed for a PostgreSQL statement.', type: 'integer', min: 100, max: 600000 },
]);

const DEFINITION_BY_KEY = new Map(RUNTIME_ENV_DEFINITIONS.map((definition) => [definition.key, definition]));

const defaultFilePath = (env = process.env) => (
  String(env.RUNTIME_ENV_FILE || '').trim() || DEFAULT_RUNTIME_ENV_FILE
);

const snapshotBaseValues = (env) => Object.fromEntries(
  RUNTIME_ENV_DEFINITIONS.map(({ key }) => [key, env[key] === undefined ? null : String(env[key])]),
);

const createValidationError = (message) => {
  const error = new TypeError(message);
  error.code = 'INVALID_RUNTIME_ENV';
  return error;
};

const normalizeRuntimeEnvValue = (definition, rawValue) => {
  if (rawValue === null) return null;
  if (!['string', 'number', 'boolean'].includes(typeof rawValue)) {
    throw createValidationError(`${definition.key} must be a string, number, boolean, or null.`);
  }
  const value = String(rawValue).trim();
  if (!value) throw createValidationError(`${definition.key} cannot be empty; reset the override instead.`);

  if (definition.type === 'integer') {
    if (!/^\d+$/u.test(value)) throw createValidationError(`${definition.key} must be a whole number.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < definition.min || parsed > definition.max) {
      throw createValidationError(`${definition.key} must be between ${definition.min} and ${definition.max}.`);
    }
    return String(parsed);
  }
  if (definition.type === 'boolean') {
    const normalized = value.toLowerCase();
    if (!['true', 'false'].includes(normalized)) throw createValidationError(`${definition.key} must be true or false.`);
    return normalized;
  }
  if (definition.type === 'enum') {
    const normalized = value.toLowerCase();
    if (!definition.options.includes(normalized)) {
      throw createValidationError(`${definition.key} must be one of: ${definition.options.join(', ')}.`);
    }
    return normalized;
  }
  if (definition.type === 'url') {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw createValidationError(`${definition.key} must be a valid HTTP or HTTPS URL.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw createValidationError(`${definition.key} must be a valid HTTP or HTTPS URL.`);
    }
    return value.replace(/\/$/u, '');
  }
  const maximumLength = definition.maxLength || (definition.type === 'secret' ? 4096 : 1000);
  if (value.length > maximumLength) throw createValidationError(`${definition.key} is too long.`);
  return value;
};

const readOverridesSync = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, rawValue]) => {
      const definition = DEFINITION_BY_KEY.get(key);
      if (!definition || definition.editable === false) return [];
      try {
        const value = normalizeRuntimeEnvValue(definition, rawValue);
        return value === null ? [] : [[key, value]];
      } catch {
        return [];
      }
    }));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    return {};
  }
};

let startupState = null;
let defaultService = null;

const loadRuntimeEnvOverridesSync = ({ env = process.env, filePath = defaultFilePath(env) } = {}) => {
  const baseValues = snapshotBaseValues(env);
  const overrides = readOverridesSync(filePath);
  Object.entries(overrides).forEach(([key, value]) => {
    env[key] = value;
  });
  startupState = { env, filePath, baseValues, overrides };
  defaultService = null;
  return { filePath, count: Object.keys(overrides).length };
};

const createRuntimeEnvService = ({
  env = startupState?.env || process.env,
  filePath = startupState?.filePath || defaultFilePath(env),
  baseValues = startupState?.baseValues || snapshotBaseValues(env),
  initialOverrides = startupState?.overrides || readOverridesSync(filePath),
  fileSystem = fsPromises,
} = {}) => {
  let overrides = Object.fromEntries(Object.entries(initialOverrides).filter(([key]) => {
    const definition = DEFINITION_BY_KEY.get(key);
    return Boolean(definition && definition.editable !== false);
  }));

  const getStatus = () => ({
    persistent: true,
    restartRequired: true,
    entries: RUNTIME_ENV_DEFINITIONS.map((definition) => {
      const overridden = Object.hasOwn(overrides, definition.key);
      const effectiveValue = overridden ? overrides[definition.key] : baseValues[definition.key];
      return {
        key: definition.key,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        type: definition.type,
        options: definition.options || null,
        min: definition.min ?? null,
        max: definition.max ?? null,
        secret: definition.type === 'secret',
        editable: definition.editable !== false,
        configured: Boolean(effectiveValue),
        value: definition.type === 'secret' ? null : effectiveValue,
        source: overridden ? 'admin override' : effectiveValue ? 'deployment environment' : 'not configured',
        overridden,
        restartRequired: true,
      };
    }),
  });

  const persist = async (nextOverrides) => {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fileSystem.mkdir(directory, { recursive: true });
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(nextOverrides, null, 2)}\n`, { mode: 0o600 });
    await fileSystem.rename(temporaryPath, filePath);
  };

  const update = async (values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw createValidationError('values must be an object.');
    }
    const entries = Object.entries(values);
    if (entries.length === 0) throw createValidationError('Provide at least one environment variable.');
    if (entries.length > 20) throw createValidationError('Update no more than 20 environment variables at once.');

    const normalized = entries.map(([key, rawValue]) => {
      const definition = DEFINITION_BY_KEY.get(key);
      if (!definition) throw createValidationError(`Environment variable is not editable: ${key}.`);
      if (definition.editable === false) throw createValidationError(`Environment variable is deployment-managed: ${key}.`);
      return [key, normalizeRuntimeEnvValue(definition, rawValue)];
    });
    const nextOverrides = { ...overrides };
    normalized.forEach(([key, value]) => {
      if (value === null) delete nextOverrides[key];
      else nextOverrides[key] = value;
    });

    try {
      await persist(nextOverrides);
    } catch (error) {
      const persistError = new Error('Runtime environment settings could not be saved.');
      persistError.code = 'RUNTIME_ENV_PERSIST_FAILED';
      persistError.cause = error;
      throw persistError;
    }

    overrides = nextOverrides;
    normalized.forEach(([key]) => {
      const value = Object.hasOwn(overrides, key) ? overrides[key] : baseValues[key];
      if (value === null || value === undefined) delete env[key];
      else env[key] = value;
    });
    return getStatus();
  };

  return { getStatus, update };
};

const getDefaultService = () => {
  if (!defaultService) defaultService = createRuntimeEnvService();
  return defaultService;
};

const runtimeEnvService = {
  getStatus: () => getDefaultService().getStatus(),
  update: (values) => getDefaultService().update(values),
};

module.exports = {
  DEFAULT_RUNTIME_ENV_FILE,
  RUNTIME_ENV_DEFINITIONS,
  createRuntimeEnvService,
  loadRuntimeEnvOverridesSync,
  normalizeRuntimeEnvValue,
  runtimeEnvService,
};
