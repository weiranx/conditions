'use strict';

const EXPECTED_INTERVAL_MINUTES = 60;
const STALE_AFTER_MINUTES = 90;
const STALE_AFTER_MS = STALE_AFTER_MINUTES * 60 * 1000;
const DEFAULT_CHECK_INTERVAL_MINUTES = 180;
const MIN_CHECK_INTERVAL_MINUTES = 60;
const MAX_CHECK_INTERVAL_MINUTES = 1440;

const timestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const deriveSchedulerStatus = ({ row, secretConfigured, running = false, now = Date.now() }) => {
  const enabled = row?.enabled !== false;
  const lastHeartbeatAt = timestamp(row?.last_heartbeat_at);
  const heartbeatAgeMs = lastHeartbeatAt ? Math.max(0, now - new Date(lastHeartbeatAt).getTime()) : null;
  let health = 'healthy';
  let message = 'The hourly scheduler heartbeat is current.';

  if (!enabled) {
    health = 'stopped';
    message = 'Automatic Objective Watch checks are stopped by an administrator.';
  } else if (!secretConfigured) {
    health = 'not_configured';
    message = 'OBJECTIVE_WATCH_CRON_SECRET is missing from the deployment environment.';
  } else if (running) {
    health = 'running';
    message = 'An Objective Watch check run is currently in progress.';
  } else if (!lastHeartbeatAt || row?.last_status === 'waiting') {
    health = 'waiting';
    message = 'Waiting for the first hourly scheduler heartbeat.';
  } else if (heartbeatAgeMs > STALE_AFTER_MS) {
    health = 'unhealthy';
    message = 'The hourly scheduler heartbeat is overdue.';
  } else if (row?.last_status === 'failed') {
    health = 'failed';
    message = row?.last_error || 'The latest Objective Watch check run failed.';
  }

  return {
    enabled,
    configured: Boolean(secretConfigured),
    running: Boolean(running),
    health,
    message,
    lastHeartbeatAt,
    lastStartedAt: timestamp(row?.last_started_at),
    lastCompletedAt: timestamp(row?.last_completed_at),
    lastStatus: String(row?.last_status || 'waiting'),
    lastError: row?.last_error ? String(row.last_error) : null,
    lastSummary: row?.last_summary && typeof row.last_summary === 'object' ? row.last_summary : null,
    checkIntervalMinutes: Number(row?.check_interval_minutes) || DEFAULT_CHECK_INTERVAL_MINUTES,
    expectedIntervalMinutes: EXPECTED_INTERVAL_MINUTES,
    staleAfterMinutes: STALE_AFTER_MINUTES,
    updatedAt: timestamp(row?.updated_at),
  };
};

const createObjectiveWatchScheduler = ({
  database,
  secretConfigured = () => Boolean(String(process.env.OBJECTIVE_WATCH_CRON_SECRET || '').trim()),
  now = Date.now,
} = {}) => {
  let running = false;

  const ensureAvailable = () => {
    if (!database?.configured || typeof database.query !== 'function') {
      const error = new Error('Objective Watch scheduler state requires PostgreSQL.');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }
  };

  const queryState = async () => {
    ensureAvailable();
    const result = await database.query(`
      SELECT enabled, check_interval_minutes, last_heartbeat_at, last_started_at, last_completed_at,
             last_status, last_error, last_summary, updated_at
      FROM objective_watch_scheduler_state
      WHERE id = 1
    `);
    if (!result.rows[0]) throw new Error('Objective Watch scheduler state is missing.');
    return result.rows[0];
  };

  const getStatus = async () => deriveSchedulerStatus({
    row: await queryState(),
    secretConfigured: secretConfigured(),
    running,
    now: now(),
  });

  const setEnabled = async (enabled) => {
    ensureAvailable();
    const result = await database.query(`
      UPDATE objective_watch_scheduler_state
      SET enabled = $1,
          last_status = CASE WHEN $1 THEN 'waiting' ELSE 'stopped' END,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = 1
      RETURNING enabled, check_interval_minutes, last_heartbeat_at, last_started_at, last_completed_at,
                last_status, last_error, last_summary, updated_at
    `, [enabled]);
    return deriveSchedulerStatus({
      row: result.rows[0],
      secretConfigured: secretConfigured(),
      running,
      now: now(),
    });
  };

  const setCheckInterval = async (minutes) => {
    ensureAvailable();
    const parsed = Number(minutes);
    if (!Number.isInteger(parsed)
      || parsed < MIN_CHECK_INTERVAL_MINUTES
      || parsed > MAX_CHECK_INTERVAL_MINUTES
      || parsed % 60 !== 0) {
      throw new RangeError('Objective Watch check interval must be a whole number of hours from 1 to 24.');
    }
    const result = await database.query(`
      UPDATE objective_watch_scheduler_state
      SET check_interval_minutes = $1, updated_at = NOW()
      WHERE id = 1
      RETURNING enabled, check_interval_minutes, last_heartbeat_at, last_started_at, last_completed_at,
                last_status, last_error, last_summary, updated_at
    `, [parsed]);
    return deriveSchedulerStatus({
      row: result.rows[0],
      secretConfigured: secretConfigured(),
      running,
      now: now(),
    });
  };

  const getCheckIntervalMinutes = async () => {
    const row = await queryState();
    return Number(row.check_interval_minutes) || DEFAULT_CHECK_INTERVAL_MINUTES;
  };

  const recordHeartbeat = async () => {
    ensureAvailable();
    const result = await database.query(`
      UPDATE objective_watch_scheduler_state
      SET last_heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = 1
      RETURNING enabled
    `);
    return { enabled: result.rows[0]?.enabled !== false };
  };

  const recordStarted = async () => {
    ensureAvailable();
    running = true;
    try {
      await database.query(`
        UPDATE objective_watch_scheduler_state
        SET last_started_at = NOW(), last_status = 'running', last_error = NULL, updated_at = NOW()
        WHERE id = 1
      `);
    } catch (error) {
      running = false;
      throw error;
    }
  };

  const recordCompleted = async (summary) => {
    ensureAvailable();
    try {
      await database.query(`
        UPDATE objective_watch_scheduler_state
        SET last_completed_at = NOW(), last_status = 'succeeded', last_error = NULL,
            last_summary = $1::jsonb, updated_at = NOW()
        WHERE id = 1
      `, [JSON.stringify(summary || {})]);
    } finally {
      running = false;
    }
  };

  const recordFailed = async (error) => {
    ensureAvailable();
    try {
      await database.query(`
        UPDATE objective_watch_scheduler_state
        SET last_completed_at = NOW(), last_status = 'failed', last_error = $1, updated_at = NOW()
        WHERE id = 1
      `, [String(error?.message || 'Objective Watch cron failed.').slice(0, 500)]);
    } finally {
      running = false;
    }
  };

  const recordSkipped = async (reason) => {
    ensureAvailable();
    await database.query(`
      UPDATE objective_watch_scheduler_state
      SET last_completed_at = NOW(), last_status = $1, last_error = NULL, updated_at = NOW()
      WHERE id = 1
    `, [String(reason || 'skipped').slice(0, 80)]);
  };

  return {
    getStatus,
    getCheckIntervalMinutes,
    recordCompleted,
    recordFailed,
    recordHeartbeat,
    recordSkipped,
    recordStarted,
    setEnabled,
    setCheckInterval,
  };
};

module.exports = {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  EXPECTED_INTERVAL_MINUTES,
  MAX_CHECK_INTERVAL_MINUTES,
  MIN_CHECK_INTERVAL_MINUTES,
  STALE_AFTER_MINUTES,
  createObjectiveWatchScheduler,
  deriveSchedulerStatus,
};
