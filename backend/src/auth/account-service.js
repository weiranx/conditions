'use strict';

const {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} = require('./password');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ACTIVITIES = new Set([
  'backcountry',
  'hiking',
  'scrambling',
  'alpine-climbing',
  'snow-climbing',
  'ski-touring',
  'trail-running',
]);
const THEMES = new Set(['light', 'dark', 'system']);
const TEMPERATURE_UNITS = new Set(['f', 'c']);
const ELEVATION_UNITS = new Set(['ft', 'm']);
const WIND_SPEED_UNITS = new Set(['mph', 'kph']);
const TIME_STYLES = new Set(['ampm', '24h']);

class AccountValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'AccountValidationError';
    this.field = field;
  }
}

class DuplicateEmailError extends Error {
  constructor() {
    super('An account already exists for this email address.');
    this.name = 'DuplicateEmailError';
  }
}

const characterCount = (value) => Array.from(value).length;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizeDisplayName = (value) => String(value || '').trim().replace(/\s+/gu, ' ');

const validateEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new AccountValidationError('Enter a valid email address.', 'email');
  }
  return email;
};

const validateDisplayName = (value) => {
  const displayName = normalizeDisplayName(value);
  const length = characterCount(displayName);
  if (!displayName || length > 80 || CONTROL_CHAR_PATTERN.test(displayName)) {
    throw new AccountValidationError('Enter a name between 1 and 80 characters.', 'displayName');
  }
  return displayName;
};

const validatePassword = (value) => {
  if (typeof value !== 'string') {
    throw new AccountValidationError('Enter a password.', 'password');
  }
  const length = characterCount(value);
  if (length < 12 || length > 128) {
    throw new AccountValidationError('Use a password between 12 and 128 characters.', 'password');
  }
  return value;
};

const validatePreferenceEnum = (preferences, field, allowed) => {
  const value = preferences[field];
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new AccountValidationError(`Choose a valid ${field}.`, `preferences.${field}`);
  }
  return value;
};

const validatePreferenceNumber = (preferences, field, minimum, maximum, { integer = false } = {}) => {
  const value = preferences[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AccountValidationError(
      `${field} must be between ${minimum} and ${maximum}.`,
      `preferences.${field}`,
    );
  }
  return integer ? Math.round(value) : Math.round(value * 100) / 100;
};

const validateAccountPreferences = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccountValidationError('Provide valid account preferences.', 'preferences');
  }
  const preferences = value;
  if (typeof preferences.defaultStartTime !== 'string' || !TIME_PATTERN.test(preferences.defaultStartTime)) {
    throw new AccountValidationError('Choose a valid default start time.', 'preferences.defaultStartTime');
  }

  return {
    defaultActivity: validatePreferenceEnum(preferences, 'defaultActivity', ACTIVITIES),
    defaultStartTime: preferences.defaultStartTime,
    themeMode: validatePreferenceEnum(preferences, 'themeMode', THEMES),
    temperatureUnit: validatePreferenceEnum(preferences, 'temperatureUnit', TEMPERATURE_UNITS),
    elevationUnit: validatePreferenceEnum(preferences, 'elevationUnit', ELEVATION_UNITS),
    windSpeedUnit: validatePreferenceEnum(preferences, 'windSpeedUnit', WIND_SPEED_UNITS),
    timeStyle: validatePreferenceEnum(preferences, 'timeStyle', TIME_STYLES),
    maxWindGustMph: validatePreferenceNumber(preferences, 'maxWindGustMph', 10, 80),
    maxPrecipChance: validatePreferenceNumber(preferences, 'maxPrecipChance', 0, 100, { integer: true }),
    minFeelsLikeF: validatePreferenceNumber(preferences, 'minFeelsLikeF', -40, 60),
    maxFeelsLikeF: validatePreferenceNumber(preferences, 'maxFeelsLikeF', 70, 120),
    travelWindowHours: validatePreferenceNumber(preferences, 'travelWindowHours', 1, 24, { integer: true }),
    runnerPaceMinutesPerMile: validatePreferenceNumber(
      preferences,
      'runnerPaceMinutesPerMile',
      5,
      90,
      { integer: true },
    ),
    runnerAscentMinutesPer1000Ft: validatePreferenceNumber(
      preferences,
      'runnerAscentMinutesPer1000Ft',
      0,
      120,
      { integer: true },
    ),
    runnerStopBufferMinutes: validatePreferenceNumber(
      preferences,
      'runnerStopBufferMinutes',
      0,
      240,
      { integer: true },
    ),
  };
};

const normalizeStoredPreferences = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const serializeUser = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  preferences: normalizeStoredPreferences(row.preferences),
});

const createDatabaseUnavailableError = () => {
  const error = new Error('Accounts are temporarily unavailable.');
  error.code = 'ACCOUNT_DATABASE_UNAVAILABLE';
  return error;
};

const parseSessionTtlMs = (value) => {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 && days <= 365
    ? Math.round(days * 24 * 60 * 60 * 1000)
    : DEFAULT_SESSION_TTL_MS;
};

const createAccountService = ({
  database,
  sessionTtlMs = parseSessionTtlMs(process.env.ACCOUNT_SESSION_DAYS),
  now = () => Date.now(),
} = {}) => {
  const available = Boolean(database?.configured && typeof database.query === 'function');

  const ensureAvailable = () => {
    if (!available) throw createDatabaseUnavailableError();
  };

  const createSession = async (userId) => {
    const token = createSessionToken();
    const expiresAt = new Date(now() + sessionTtlMs);
    await database.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hashSessionToken(token), expiresAt],
    );
    return { token, expiresAt };
  };

  const register = async ({
    email: rawEmail,
    displayName: rawDisplayName,
    password: rawPassword,
    preferences: rawPreferences,
  } = {}) => {
    ensureAvailable();
    const email = validateEmail(rawEmail);
    const displayName = validateDisplayName(rawDisplayName);
    const password = validatePassword(rawPassword);
    const preferences = rawPreferences === undefined ? {} : validateAccountPreferences(rawPreferences);
    const passwordHash = await hashPassword(password);
    const token = createSessionToken();
    const expiresAt = new Date(now() + sessionTtlMs);

    try {
      const result = await database.query(
        `WITH new_user AS (
           INSERT INTO users (auth_provider, auth_subject, email, display_name, preferences)
           VALUES ('password', $1, $1, $2, $3::jsonb)
           RETURNING id, email, display_name, created_at, preferences
         ), new_credentials AS (
           INSERT INTO account_credentials (user_id, password_hash)
           SELECT id, $4 FROM new_user
           RETURNING user_id
         ), new_session AS (
           INSERT INTO user_sessions (user_id, token_hash, expires_at)
           SELECT id, $5, $6 FROM new_user
           RETURNING user_id
         )
         SELECT new_user.id, new_user.email, new_user.display_name, new_user.created_at, new_user.preferences
         FROM new_user
         JOIN new_credentials ON new_credentials.user_id = new_user.id
         JOIN new_session ON new_session.user_id = new_user.id`,
        [email, displayName, JSON.stringify(preferences), passwordHash, hashSessionToken(token), expiresAt],
      );
      return { user: serializeUser(result.rows[0]), token, expiresAt };
    } catch (error) {
      if (error?.code === '23505') throw new DuplicateEmailError();
      throw error;
    }
  };

  const login = async ({ email: rawEmail, password: rawPassword } = {}) => {
    ensureAvailable();
    const email = validateEmail(rawEmail);
    const password = validatePassword(rawPassword);
    const result = await database.query(
      `SELECT users.id, users.email, users.display_name, users.created_at, users.preferences,
              account_credentials.password_hash
       FROM users
       JOIN account_credentials ON account_credentials.user_id = users.id
       WHERE users.auth_provider = 'password'
         AND LOWER(users.email) = $1
         AND users.status = 'active'
       LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    const passwordMatches = row
      ? await verifyPassword(password, row.password_hash)
      : await hashPassword(password).then(() => false);
    if (!row || !passwordMatches) {
      const error = new Error('Email or password is incorrect.');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }
    const session = await createSession(row.id);
    return { user: serializeUser(row), ...session };
  };

  const getUserForSession = async (token) => {
    ensureAvailable();
    if (!token) return null;
    const result = await database.query(
      `SELECT users.id, users.email, users.display_name, users.created_at, users.preferences
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = $1
         AND user_sessions.expires_at > NOW()
         AND users.status = 'active'
       LIMIT 1`,
      [hashSessionToken(token)],
    );
    return result.rows[0] ? serializeUser(result.rows[0]) : null;
  };

  const logout = async (token) => {
    ensureAvailable();
    if (!token) return;
    await database.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
  };

  const updatePreferences = async (token, rawPreferences) => {
    ensureAvailable();
    if (!token) {
      const error = new Error('Sign in to save account preferences.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    const preferences = validateAccountPreferences(rawPreferences);
    const result = await database.query(
      `UPDATE users
       SET preferences = $2::jsonb,
           updated_at = NOW()
       FROM user_sessions
       WHERE users.id = user_sessions.user_id
         AND user_sessions.token_hash = $1
         AND user_sessions.expires_at > NOW()
         AND users.status = 'active'
       RETURNING users.id, users.email, users.display_name, users.created_at, users.preferences`,
      [hashSessionToken(token), JSON.stringify(preferences)],
    );
    if (!result.rows[0]) {
      const error = new Error('Your session has expired. Sign in again.');
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    return serializeUser(result.rows[0]);
  };

  return {
    available,
    sessionTtlMs,
    getUserForSession,
    login,
    logout,
    register,
    updatePreferences,
  };
};

module.exports = {
  AccountValidationError,
  DEFAULT_SESSION_TTL_MS,
  DuplicateEmailError,
  createAccountService,
  normalizeDisplayName,
  normalizeEmail,
  parseSessionTtlMs,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateAccountPreferences,
};
