'use strict';

const {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} = require('./password');
const {
  MAX_FREE_MONTHLY_USAGE_LIMIT,
  getMonthlyWindow,
} = require('./monthly-usage-limit');
const { MAX_MONTHLY_TOKEN_LIMIT } = require('./ai-usage-limit');

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
const ADMIN_USER_STATUSES = new Set(['active', 'suspended']);
const ADMIN_ACCOUNT_TIERS = new Set(['free', 'premium']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

class GoogleAccountLinkError extends Error {
  constructor() {
    super('This email is already connected to another sign-in. Use the existing sign-in method.');
    this.name = 'GoogleAccountLinkError';
    this.code = 'GOOGLE_ACCOUNT_LINK_REQUIRED';
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

const asNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const asOptionalPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

const serializeAdminUser = (row) => ({
  id: row.id,
  email: row.email || null,
  displayName: row.display_name || row.email || 'Unnamed account',
  authProvider: row.auth_provider,
  authMethods: Array.isArray(row.auth_methods) && row.auth_methods.length
    ? row.auth_methods
    : [row.auth_provider].filter(Boolean),
  tier: row.account_tier === 'premium' ? 'premium' : 'free',
  status: row.status,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  lastActivityAt: row.last_activity_at instanceof Date ? row.last_activity_at.toISOString() : row.last_activity_at || null,
  activeSessions: asNonNegativeNumber(row.active_sessions),
  savedReports: asNonNegativeNumber(row.saved_reports),
  aiCalls: asNonNegativeNumber(row.ai_calls),
  aiTokens: asNonNegativeNumber(row.ai_tokens),
  aiTokenLimitOverride: asOptionalPositiveNumber(row.ai_token_limit_override),
  reportUsageLimitOverride: asOptionalPositiveNumber(row.report_usage_limit_override),
});

const createAdminAccountError = (message, code) => Object.assign(new Error(message), { code });

const validateAdminUserId = (value) => {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) {
    throw createAdminAccountError('Choose a valid account.', 'INVALID_ACCOUNT_ID');
  }
  return id;
};

const validateAdminUserStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (!ADMIN_USER_STATUSES.has(status)) {
    throw createAdminAccountError('Status must be active or suspended.', 'INVALID_ACCOUNT_STATUS');
  }
  return status;
};

const validateAdminAccountTier = (value) => {
  const tier = String(value || '').trim().toLowerCase();
  if (!ADMIN_ACCOUNT_TIERS.has(tier)) {
    throw createAdminAccountError('Tier must be free or premium.', 'INVALID_ACCOUNT_TIER');
  }
  return tier;
};

const validateAdminAIUsageLimit = (value) => {
  if (value === null) return null;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_MONTHLY_TOKEN_LIMIT) {
    throw createAdminAccountError(
      `Monthly AI token limit must be between 1 and ${MAX_MONTHLY_TOKEN_LIMIT.toLocaleString()}.`,
      'INVALID_AI_USAGE_LIMIT',
    );
  }
  return Math.round(limit);
};

const validateAdminReportUsageLimit = (value) => {
  if (value === null) return null;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_FREE_MONTHLY_USAGE_LIMIT) {
    throw createAdminAccountError(
      `Monthly generated report limit must be between 1 and ${MAX_FREE_MONTHLY_USAGE_LIMIT.toLocaleString()}.`,
      'INVALID_USAGE_LIMIT',
    );
  }
  return Math.round(limit);
};

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

const validateGoogleSubject = (value) => {
  const subject = String(value || '').trim();
  if (!subject || subject.length > 255 || CONTROL_CHAR_PATTERN.test(subject)) {
    throw new AccountValidationError('Google account identity is invalid.', 'credential');
  }
  return subject;
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

  const loginWithGoogle = async ({
    subject: rawSubject,
    email: rawEmail,
    displayName: rawDisplayName,
    emailAuthoritative = false,
    preferences: rawPreferences,
  } = {}) => {
    ensureAvailable();
    const subject = validateGoogleSubject(rawSubject);
    const email = validateEmail(rawEmail);
    const displayName = validateDisplayName(rawDisplayName);
    const preferences = rawPreferences === undefined ? {} : validateAccountPreferences(rawPreferences);
    const token = createSessionToken();
    const expiresAt = new Date(now() + sessionTtlMs);
    const runTransaction = typeof database.transaction === 'function'
      ? database.transaction.bind(database)
      : async (callback) => callback(database.query.bind(database));

    const persistGoogleLogin = async (query) => {
      const identityResult = await query(
        `SELECT DISTINCT users.id, users.email, users.display_name, users.created_at, users.preferences, users.status
         FROM users
         LEFT JOIN account_identities
           ON account_identities.user_id = users.id
          AND account_identities.provider = 'google'
          AND account_identities.subject = $1
         WHERE (
             account_identities.user_id IS NOT NULL
             OR (users.auth_provider = 'google' AND users.auth_subject = $1)
           )
         LIMIT 1`,
        [subject],
      );
      let row = identityResult.rows[0] || null;

      if (row && row.status !== 'active') {
        const error = new Error('This account is unavailable.');
        error.code = 'ACCOUNT_DISABLED';
        throw error;
      }

      if (!row) {
        const emailResult = await query(
          `SELECT users.id, users.email, users.display_name, users.created_at, users.preferences, users.status,
                  account_identities.subject AS google_subject
           FROM users
           LEFT JOIN account_identities
             ON account_identities.user_id = users.id
            AND account_identities.provider = 'google'
           WHERE LOWER(users.email) = $1
           LIMIT 1
           FOR UPDATE OF users`,
          [email],
        );
        row = emailResult.rows[0] || null;

        if (row && row.status !== 'active') {
          const error = new Error('This account is unavailable.');
          error.code = 'ACCOUNT_DISABLED';
          throw error;
        }
        if (row && (!emailAuthoritative || (row.google_subject && row.google_subject !== subject))) {
          throw new GoogleAccountLinkError();
        }
        if (!row) {
          const insertResult = await query(
            `INSERT INTO users (auth_provider, auth_subject, email, display_name, preferences)
             VALUES ('google', $1, $2, $3, $4::jsonb)
             RETURNING id, email, display_name, created_at, preferences`,
            [subject, email, displayName, JSON.stringify(preferences)],
          );
          row = insertResult.rows[0];
        }
      }

      await query(
        `INSERT INTO account_identities (provider, subject, user_id, email_at_link)
         VALUES ('google', $1, $2, $3)
         ON CONFLICT (provider, subject) DO NOTHING`,
        [subject, row.id, email],
      );
      await query(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [row.id, hashSessionToken(token), expiresAt],
      );

      return { user: serializeUser(row), token, expiresAt };
    };

    try {
      return await runTransaction(persistGoogleLogin);
    } catch (error) {
      if (error?.code === '23505') {
        return runTransaction(persistGoogleLogin);
      }
      throw error;
    }
  };

  const runInTransaction = (callback) => (
    typeof database?.transaction === 'function'
      ? database.transaction(callback)
      : callback(database.query.bind(database))
  );

  const listUsers = async ({ limit: rawLimit = 500 } = {}) => {
    ensureAvailable();
    const parsedLimit = Number(rawLimit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(500, Math.max(1, Math.round(parsedLimit)))
      : 500;
    const result = await database.query(
      `WITH user_directory AS (
         SELECT users.id,
                users.email,
                users.display_name,
                users.auth_provider,
                ARRAY(
                  SELECT DISTINCT provider
                  FROM (
                    SELECT users.auth_provider AS provider
                    UNION ALL
                    SELECT account_identities.provider
                    FROM account_identities
                    WHERE account_identities.user_id = users.id
                  ) linked_auth_methods
                  WHERE provider IS NOT NULL
                  ORDER BY provider
                ) AS auth_methods,
                COALESCE(
                  (
                    SELECT CASE WHEN plan_key = 'premium' THEN 'premium' ELSE 'free' END
                    FROM subscriptions
                    WHERE user_id = users.id
                      AND provider = 'admin'
                      AND status IN ('active', 'trialing')
                      AND (current_period_end IS NULL OR current_period_end > NOW())
                    ORDER BY updated_at DESC
                    LIMIT 1
                  ),
                  CASE WHEN EXISTS (
                    SELECT 1
                    FROM subscriptions
                    WHERE user_id = users.id
                      AND (plan_key = 'premium' OR LEFT(plan_key, 8) = 'premium_')
                      AND status IN ('active', 'trialing')
                      AND (current_period_end IS NULL OR current_period_end > NOW())
                  ) THEN 'premium' ELSE 'free' END
                ) AS account_tier,
                users.status,
                users.created_at,
                users.updated_at,
                GREATEST(
                  users.created_at,
                  session_activity.last_session_at,
                  report_activity.last_report_at,
                  ai_activity.last_ai_at
                ) AS last_activity_at,
                COALESCE(session_activity.active_sessions, 0) AS active_sessions,
                COALESCE(report_activity.saved_reports, 0) AS saved_reports,
                COALESCE(ai_activity.ai_calls, 0) AS ai_calls,
                COALESCE(ai_activity.ai_tokens, 0) AS ai_tokens,
                usage_limit.ai_token_limit_override,
                report_usage_limit.report_usage_limit_override
         FROM users
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE expires_at > NOW()) AS active_sessions,
                  MAX(created_at) AS last_session_at
           FROM user_sessions
           WHERE user_id = users.id
         ) session_activity ON TRUE
         LEFT JOIN LATERAL (
           SELECT limits ->> 'monthlyUsageLimit' AS report_usage_limit_override,
                  limits ->> 'resetAt' AS usage_reset_at
           FROM entitlements
           WHERE user_id = users.id
             AND feature_key = 'report_usage'
             AND (valid_until IS NULL OR valid_until > NOW())
           LIMIT 1
         ) report_usage_limit ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE created_at >= GREATEST(
                      DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                      COALESCE(
                        NULLIF(report_usage_limit.usage_reset_at, '')::timestamptz,
                        DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                      )
                    )
                  ) AS saved_reports,
                  MAX(updated_at) AS last_report_at
           FROM saved_reports
           WHERE user_id = users.id
         ) report_activity ON TRUE
         LEFT JOIN LATERAL (
           SELECT limits ->> 'monthlyTokenLimit' AS ai_token_limit_override,
                  limits ->> 'resetAt' AS usage_reset_at
           FROM entitlements
           WHERE user_id = users.id
             AND feature_key = 'ai_usage'
             AND (valid_until IS NULL OR valid_until > NOW())
           LIMIT 1
         ) usage_limit ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE status = 'success'
                      AND created_at >= GREATEST(
                      DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                      COALESCE(
                        NULLIF(usage_limit.usage_reset_at, '')::timestamptz,
                        DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                      )
                    )
                  ) AS ai_calls,
                  COALESCE(SUM(total_tokens) FILTER (
                    WHERE created_at >= GREATEST(
                      DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                      COALESCE(
                        NULLIF(usage_limit.usage_reset_at, '')::timestamptz,
                        DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                      )
                    )
                  ), 0) AS ai_tokens,
                  MAX(created_at) AS last_ai_at
           FROM ai_usage_events
           WHERE user_id = users.id
         ) ai_activity ON TRUE
       )
       SELECT user_directory.*,
              COUNT(*) OVER() AS total_count,
              COUNT(*) FILTER (WHERE status = 'active') OVER() AS active_count,
              COUNT(*) FILTER (WHERE status = 'suspended') OVER() AS suspended_count,
              COUNT(*) FILTER (WHERE account_tier = 'free') OVER() AS free_count,
              COUNT(*) FILTER (WHERE account_tier = 'premium') OVER() AS premium_count,
              COALESCE(SUM(active_sessions) OVER(), 0) AS total_active_sessions
       FROM user_directory
       ORDER BY created_at DESC, id
       LIMIT $1`,
      [limit],
    );
    return {
      users: result.rows.map(serializeAdminUser),
      total: result.rows.length ? asNonNegativeNumber(result.rows[0].total_count) : 0,
      summary: {
        active: result.rows.length ? asNonNegativeNumber(result.rows[0].active_count) : 0,
        suspended: result.rows.length ? asNonNegativeNumber(result.rows[0].suspended_count) : 0,
        free: result.rows.length ? asNonNegativeNumber(result.rows[0].free_count) : 0,
        premium: result.rows.length ? asNonNegativeNumber(result.rows[0].premium_count) : 0,
        activeSessions: result.rows.length ? asNonNegativeNumber(result.rows[0].total_active_sessions) : 0,
      },
      limit,
    };
  };

  const updateUserStatus = async ({ userId: rawUserId, status: rawStatus, actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    const status = validateAdminUserStatus(rawStatus);
    if (userId === actorUserId) {
      throw createAdminAccountError('The owner account cannot be suspended from the admin console.', 'ADMIN_SELF_MODIFICATION');
    }

    return runInTransaction(async (query) => {
      const result = await query(
        `UPDATE users
         SET status = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, display_name, auth_provider, status, created_at, updated_at`,
        [userId, status],
      );
      if (!result.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }
      let revokedSessions = 0;
      if (status === 'suspended') {
        const revoked = await query('DELETE FROM user_sessions WHERE user_id = $1 RETURNING id', [userId]);
        revokedSessions = asNonNegativeNumber(revoked.rowCount ?? revoked.rows?.length);
      }
      return {
        user: serializeAdminUser(result.rows[0]),
        revokedSessions,
      };
    });
  };

  const updateUserTier = async ({ userId: rawUserId, tier: rawTier, actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    const tier = validateAdminAccountTier(rawTier);

    return runInTransaction(async (query) => {
      const account = await query(
        `SELECT id, email, display_name, auth_provider, status, created_at, updated_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if (!account.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }

      await query(
        `INSERT INTO subscriptions (
           user_id,
           provider,
           provider_subscription_id,
           plan_key,
           status,
           current_period_start,
           current_period_end,
           cancel_at_period_end,
           metadata
         )
         VALUES ($1, 'admin', $2, $3, 'active', NOW(), NULL, FALSE, $4::jsonb)
         ON CONFLICT (provider, provider_subscription_id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             plan_key = EXCLUDED.plan_key,
             status = 'active',
             current_period_start = NOW(),
             current_period_end = NULL,
             cancel_at_period_end = FALSE,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()`,
        [
          userId,
          `admin-user-tier:${userId}`,
          tier,
          JSON.stringify({ source: 'admin', actorUserId }),
        ],
      );

      return {
        user: serializeAdminUser({ ...account.rows[0], account_tier: tier }),
        tier,
      };
    });
  };

  const updateUserUsageLimit = async ({
    userId: rawUserId,
    limit: rawLimit,
    actorUserId: rawActorUserId,
  } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    const limit = validateAdminAIUsageLimit(rawLimit);

    return runInTransaction(async (query) => {
      const account = await query(
        `SELECT id, email, display_name, auth_provider, status, created_at, updated_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if (!account.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }

      if (limit === null) {
        await query(
          `UPDATE entitlements
           SET limits = limits - 'monthlyTokenLimit' - 'monthlyUsageLimit' - 'limitActorUserId',
               updated_at = NOW()
           WHERE user_id = $1
             AND feature_key = 'ai_usage'`,
          [userId],
        );
      } else {
        await query(
          `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
           VALUES ($1, 'ai_usage', 'admin', $2::jsonb, NOW())
           ON CONFLICT (user_id, feature_key) DO UPDATE
           SET source = 'admin',
               valid_until = NULL,
               limits = (entitlements.limits - 'monthlyUsageLimit') || EXCLUDED.limits,
               updated_at = NOW()`,
          [userId, JSON.stringify({ monthlyTokenLimit: limit, limitActorUserId: actorUserId })],
        );
      }

      return {
        user: serializeAdminUser({
          ...account.rows[0],
          ai_token_limit_override: limit,
        }),
        limit,
      };
    });
  };

  const updateUserReportUsageLimit = async ({
    userId: rawUserId,
    limit: rawLimit,
    actorUserId: rawActorUserId,
  } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    const limit = validateAdminReportUsageLimit(rawLimit);

    return runInTransaction(async (query) => {
      const account = await query(
        `SELECT id, email, display_name, auth_provider, status, created_at, updated_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if (!account.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }

      if (limit === null) {
        await query(
          `UPDATE entitlements
           SET limits = limits - 'monthlyUsageLimit' - 'limitActorUserId',
               updated_at = NOW()
           WHERE user_id = $1
             AND feature_key = 'report_usage'`,
          [userId],
        );
      } else {
        await query(
          `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
           VALUES ($1, 'report_usage', 'admin', $2::jsonb, NOW())
           ON CONFLICT (user_id, feature_key) DO UPDATE
           SET source = 'admin',
               valid_until = NULL,
               limits = entitlements.limits || EXCLUDED.limits,
               updated_at = NOW()`,
          [userId, JSON.stringify({ monthlyUsageLimit: limit, limitActorUserId: actorUserId })],
        );
      }

      return {
        user: serializeAdminUser({
          ...account.rows[0],
          report_usage_limit_override: limit,
        }),
        limit,
      };
    });
  };

  const resetAllUserUsageLimits = async ({ actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    validateAdminUserId(rawActorUserId);
    return runInTransaction(async (query) => {
      const resetAI = await query(
        `UPDATE entitlements
         SET limits = limits - 'monthlyTokenLimit' - 'monthlyUsageLimit' - 'limitActorUserId',
             updated_at = NOW()
         WHERE feature_key = 'ai_usage'
           AND (limits ? 'monthlyTokenLimit' OR limits ? 'monthlyUsageLimit')
         RETURNING user_id`,
      );
      const resetReports = await query(
        `UPDATE entitlements
         SET limits = limits - 'monthlyUsageLimit' - 'limitActorUserId',
             updated_at = NOW()
         WHERE feature_key = 'report_usage'
           AND limits ? 'monthlyUsageLimit'
         RETURNING user_id`,
      );
      return {
        resetAIAccounts: asNonNegativeNumber(resetAI.rowCount ?? resetAI.rows?.length),
        resetReportAccounts: asNonNegativeNumber(resetReports.rowCount ?? resetReports.rows?.length),
      };
    });
  };

  const resetUserUsage = async ({ userId: rawUserId, actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    const resetAt = new Date(now()).toISOString();
    const window = getMonthlyWindow(resetAt);

    return runInTransaction(async (query) => {
      const account = await query(
        `SELECT id, email, display_name, auth_provider, status, created_at, updated_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if (!account.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }
      await query(
        `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
         VALUES ($1, 'ai_usage', 'admin', $2::jsonb, NOW())
         ON CONFLICT (user_id, feature_key) DO UPDATE
         SET source = 'admin',
             valid_until = NULL,
             limits = entitlements.limits || EXCLUDED.limits,
             updated_at = NOW()`,
        [userId, JSON.stringify({ resetAt, resetActorUserId: actorUserId })],
      );
      await query(
        `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
         VALUES ($1, 'report_usage', 'admin', $2::jsonb, NOW())
         ON CONFLICT (user_id, feature_key) DO UPDATE
         SET source = 'admin',
             valid_until = NULL,
             limits = entitlements.limits || EXCLUDED.limits,
             updated_at = NOW()`,
        [userId, JSON.stringify({ resetAt, resetActorUserId: actorUserId })],
      );
      return {
        user: serializeAdminUser(account.rows[0]),
        resetAI: true,
        resetReports: true,
        ...window,
      };
    });
  };

  const resetAllUserUsage = async ({ actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    const actorUserId = validateAdminUserId(rawActorUserId);
    const resetAt = new Date(now()).toISOString();
    const window = getMonthlyWindow(resetAt);
    return runInTransaction(async (query) => {
      const resetAI = await query(
        `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
         SELECT id, 'ai_usage', 'admin', $1::jsonb, NOW()
         FROM users
         ON CONFLICT (user_id, feature_key) DO UPDATE
         SET source = 'admin',
             valid_until = NULL,
             limits = entitlements.limits || EXCLUDED.limits,
             updated_at = NOW()
         RETURNING user_id`,
        [JSON.stringify({ resetAt, resetActorUserId: actorUserId })],
      );
      const resetReports = await query(
        `INSERT INTO entitlements (user_id, feature_key, source, limits, updated_at)
         SELECT id, 'report_usage', 'admin', $1::jsonb, NOW()
         FROM users
         ON CONFLICT (user_id, feature_key) DO UPDATE
         SET source = 'admin',
             valid_until = NULL,
             limits = entitlements.limits || EXCLUDED.limits,
             updated_at = NOW()
         RETURNING user_id`,
        [JSON.stringify({ resetAt, resetActorUserId: actorUserId })],
      );
      return {
        resetAIAccounts: asNonNegativeNumber(resetAI.rowCount ?? resetAI.rows?.length),
        resetReportAccounts: asNonNegativeNumber(resetReports.rowCount ?? resetReports.rows?.length),
        ...window,
      };
    });
  };

  const revokeUserSessions = async ({ userId: rawUserId, actorUserId: rawActorUserId } = {}) => {
    ensureAvailable();
    const userId = validateAdminUserId(rawUserId);
    const actorUserId = validateAdminUserId(rawActorUserId);
    if (userId === actorUserId) {
      throw createAdminAccountError('The owner account cannot be signed out from the admin console.', 'ADMIN_SELF_MODIFICATION');
    }

    return runInTransaction(async (query) => {
      const account = await query(
        `SELECT id, email, display_name, auth_provider, status, created_at, updated_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if (!account.rows[0]) {
        throw createAdminAccountError('Account not found.', 'ACCOUNT_NOT_FOUND');
      }
      const revoked = await query('DELETE FROM user_sessions WHERE user_id = $1 RETURNING id', [userId]);
      return {
        user: serializeAdminUser(account.rows[0]),
        revokedSessions: asNonNegativeNumber(revoked.rowCount ?? revoked.rows?.length),
      };
    });
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
    listUsers,
    login,
    loginWithGoogle,
    logout,
    resetAllUserUsage,
    resetAllUserUsageLimits,
    resetUserUsage,
    register,
    revokeUserSessions,
    updatePreferences,
    updateUserTier,
    updateUserReportUsageLimit,
    updateUserUsageLimit,
    updateUserStatus,
  };
};

module.exports = {
  AccountValidationError,
  DEFAULT_SESSION_TTL_MS,
  DuplicateEmailError,
  GoogleAccountLinkError,
  createAccountService,
  normalizeDisplayName,
  normalizeEmail,
  parseSessionTtlMs,
  validateDisplayName,
  validateEmail,
  validateGoogleSubject,
  validatePassword,
  validateAccountPreferences,
};
