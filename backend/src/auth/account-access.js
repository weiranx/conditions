'use strict';

const { FREE_ACCOUNT_TIER } = require('./account-tier');

const ACCOUNT_COOKIE_NAME = 'bc_session';
const ACCOUNT_REQUIRED_MESSAGE = 'Sign in or create an account to use AI features.';

const parseCookies = (header) => {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  });
  return cookies;
};

const readSessionToken = (req) => (
  parseCookies(req?.headers?.cookie)[ACCOUNT_COOKIE_NAME] || null
);

const denyUnconfiguredAccountAccess = async (_req, res) => {
  res.status(500).json({
    error: 'AI account access is not configured.',
    code: 'AI_ACCOUNT_ACCESS_NOT_CONFIGURED',
  });
  return false;
};

const createAccountAccessGuard = ({ service, tierService, usageService } = {}) => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!service?.available || typeof service.getUserForSession !== 'function') {
    res.status(503).json({
      error: 'Accounts are temporarily unavailable. Please try again later.',
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
    });
    return false;
  }

  try {
    const user = await service.getUserForSession(readSessionToken(req));
    if (!user) {
      res.status(401).json({
        error: ACCOUNT_REQUIRED_MESSAGE,
        code: 'ACCOUNT_REQUIRED',
      });
      return false;
    }
    if (!usageService?.available || typeof usageService.assertUserCanGenerate !== 'function') {
      res.status(503).json({
        error: 'AI usage is temporarily unavailable. Please try again later.',
        code: 'AI_USAGE_UNAVAILABLE',
      });
      return false;
    }
    let accountTier = { ...FREE_ACCOUNT_TIER };
    if (typeof tierService?.getAccountTier === 'function') {
      try {
        accountTier = await tierService.getAccountTier(user.id);
      } catch (error) {
        req.log?.warn({ err: error, userId: user.id }, 'AI account tier could not be loaded');
      }
    }
    req.aiUsage = await usageService.assertUserCanGenerate(user.id, accountTier.key);
    req.accountTier = accountTier;
    req.accountUser = user;
    return true;
  } catch (error) {
    if (error?.code === 'AI_USAGE_LIMIT_REACHED') {
      res.status(429).json({
        error: error.message,
        code: error.code,
        aiUsage: error.usage,
      });
      return false;
    }
    if (error?.code === 'AI_USAGE_UNAVAILABLE') {
      req.log?.error({ err: error }, 'AI usage verification failed');
      res.status(503).json({
        error: error.message,
        code: error.code,
      });
      return false;
    }
    req.log?.error({ err: error }, 'AI account verification failed');
    res.status(503).json({
      error: 'Account verification is temporarily unavailable. Please try again.',
      code: 'ACCOUNT_VERIFICATION_UNAVAILABLE',
    });
    return false;
  }
};

module.exports = {
  ACCOUNT_COOKIE_NAME,
  ACCOUNT_REQUIRED_MESSAGE,
  createAccountAccessGuard,
  denyUnconfiguredAccountAccess,
  parseCookies,
  readSessionToken,
};
