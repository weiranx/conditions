'use strict';

const crypto = require('node:crypto');
const { FREE_ACCOUNT_TIER } = require('../auth/account-tier');
const { parseCookies, readSessionToken } = require('../auth/account-access');

// Who is running a multi-day check (day comparison or itinerary), for the
// shared multi_day_forecast allowance. Guests are counted by a cookie.
const GUEST_MULTI_DAY_COOKIE_NAME = 'bc_trip_guest';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const accountUnavailable = (res) => res.status(503).json({
  error: 'Account verification is temporarily unavailable. Please try again.',
  code: 'ACCOUNT_VERIFICATION_UNAVAILABLE',
});

/**
 * Resolve the signed-in user and tier, or the guest id (setting its cookie).
 * Returns null after sending a 503 when the session cannot be checked.
 */
const resolveMultiDayCaller = async ({ req, res, accountService, tierService, isProduction }) => {
  // An MCP bearer was already verified by the MCP OAuth middleware.
  let user = req.mcpUser || null;
  const sessionToken = readSessionToken(req);
  if (!user && sessionToken && (!accountService?.available || typeof accountService.getUserForSession !== 'function')) {
    accountUnavailable(res);
    return null;
  }
  if (!user && accountService?.available && typeof accountService.getUserForSession === 'function') {
    try {
      user = await accountService.getUserForSession(sessionToken);
    } catch (error) {
      req.log?.warn({ err: error }, 'Multi-day account session could not be loaded');
      accountUnavailable(res);
      return null;
    }
  }

  let accountTier = { ...FREE_ACCOUNT_TIER };
  let anonymousId = null;
  if (user && typeof tierService?.getAccountTier === 'function') {
    try {
      accountTier = await tierService.getAccountTier(user.id);
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Multi-day account tier could not be loaded');
    }
  } else if (!user) {
    const storedAnonymousId = parseCookies(req.headers.cookie)[GUEST_MULTI_DAY_COOKIE_NAME];
    anonymousId = UUID_PATTERN.test(String(storedAnonymousId || ''))
      ? storedAnonymousId
      : crypto.randomUUID();
    if (anonymousId !== storedAnonymousId) {
      res.cookie(GUEST_MULTI_DAY_COOKIE_NAME, anonymousId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }
  }
  return { user, accountTier, anonymousId };
};

const usageServiceReady = (usageService) => Boolean(
  usageService?.available && typeof usageService.reserve === 'function' && typeof usageService.finish === 'function',
);

const sendUsageUnavailable = (res) => res.status(503).json({
  error: 'Multi-day forecast usage is temporarily unavailable. Please try again later.',
  code: 'MULTI_DAY_USAGE_UNAVAILABLE',
});

const addUtcDays = (isoDate, days) => {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

module.exports = {
  GUEST_MULTI_DAY_COOKIE_NAME,
  addUtcDays,
  resolveMultiDayCaller,
  sendUsageUnavailable,
  usageServiceReady,
};
