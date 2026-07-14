'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const {
  AccountValidationError,
  DuplicateEmailError,
  createAccountService,
} = require('../auth/account-service');
const { FREE_ACCOUNT_TIER } = require('../auth/account-tier');
const {
  ACCOUNT_COOKIE_NAME,
  parseCookies,
  readSessionToken,
} = require('../auth/account-access');
const { createGoogleIdentityVerifier } = require('../auth/google-identity');
const { createEmailService } = require('../email/email-service');

const GOOGLE_NONCE_COOKIE_NAME = 'bc_google_nonce';
const GOOGLE_NONCE_TTL_MS = 10 * 60 * 1000;

const registerAccountRoutes = ({
  app,
  database,
  isProduction = process.env.NODE_ENV === 'production',
  service = createAccountService({ database }),
  tierService,
  usageService,
  reportUsageService,
  googleVerifier = createGoogleIdentityVerifier(),
  emailService = createEmailService(),
} = {}) => {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  };
  const accountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Too many account requests. Please wait and try again.' },
  });
  const authAttemptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Too many account attempts. Please wait and try again.' },
  });

  const setSessionCookie = (res, session) => {
    res.cookie(ACCOUNT_COOKIE_NAME, session.token, {
      ...cookieOptions,
      maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()),
    });
  };

  const clearSessionCookie = (res) => res.clearCookie(ACCOUNT_COOKIE_NAME, cookieOptions);
  const clearGoogleNonceCookie = (res) => res.clearCookie(GOOGLE_NONCE_COOKIE_NAME, cookieOptions);
  const setNoStore = (res) => res.setHeader('Cache-Control', 'no-store');
  const getAccountTier = async (req, user) => {
    if (!user) return null;
    if (typeof tierService?.getAccountTier !== 'function') return { ...FREE_ACCOUNT_TIER };
    try {
      return await tierService.getAccountTier(user.id);
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Account tier could not be loaded');
      return { ...FREE_ACCOUNT_TIER };
    }
  };
  const getAIUsage = async (req, user, accountTier) => {
    if (!user || !usageService?.available || typeof usageService.getUserUsage !== 'function') return null;
    try {
      return await usageService.getUserUsage(user.id, accountTier?.key);
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Account AI usage could not be loaded');
      return null;
    }
  };
  const getReportCount = async (req, user) => {
    if (!user || !database?.configured || typeof database.query !== 'function') return null;
    try {
      const result = await database.query(`
        SELECT COUNT(*)::bigint AS report_count
        FROM saved_reports
        WHERE user_id = $1
      `, [user.id]);
      const reportCount = Number(result?.rows?.[0]?.report_count);
      return Number.isSafeInteger(reportCount) && reportCount >= 0 ? reportCount : null;
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Account report count could not be loaded');
      return null;
    }
  };
  const getReportUsage = async (req, user, accountTier) => {
    if (!user || !reportUsageService?.available || typeof reportUsageService.getUserUsage !== 'function') return null;
    try {
      return await reportUsageService.getUserUsage(user.id, accountTier?.key);
    } catch (error) {
      req.log?.warn({ err: error, userId: user.id }, 'Account report usage could not be loaded');
      return null;
    }
  };
  const accountResponse = async (req, user, available = true) => {
    const accountTier = await getAccountTier(req, user);
    const [reportCount, reportUsage] = await Promise.all([
      getReportCount(req, user),
      getReportUsage(req, user, accountTier),
    ]);
    return {
      available,
      authenticated: Boolean(user),
      user,
      accountTier,
      reportCount,
      reportUsage,
      aiUsage: await getAIUsage(req, user, accountTier),
    };
  };

  const handleError = (req, res, error) => {
    if (error instanceof AccountValidationError) {
      return res.status(400).json({ error: error.message, field: error.field });
    }
    if (error instanceof DuplicateEmailError) {
      return res.status(409).json({ error: error.message, field: 'email' });
    }
    if (error?.code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: error.message });
    }
    if (error?.code === 'INVALID_GOOGLE_CREDENTIAL') {
      return res.status(401).json({ error: error.message });
    }
    if (error?.code === 'GOOGLE_ACCOUNT_LINK_REQUIRED') {
      return res.status(409).json({ error: error.message });
    }
    if (error?.code === 'ACCOUNT_DISABLED') {
      return res.status(403).json({ error: error.message });
    }
    if (error?.code === 'GOOGLE_AUTH_UNAVAILABLE') {
      return res.status(503).json({ error: error.message });
    }
    if (error?.code === 'AUTHENTICATION_REQUIRED') {
      return res.status(401).json({ error: error.message });
    }
    if (error?.code === 'INVALID_ACCOUNT_TOKEN') {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'EMAIL_SERVICE_UNAVAILABLE' || error?.code === 'EMAIL_DELIVERY_FAILED') {
      req.log?.warn({ err: error }, 'Account email delivery failed');
      return res.status(503).json({ error: 'Email delivery is temporarily unavailable. Please try again later.' });
    }
    if (error?.code === 'ACCOUNT_DATABASE_UNAVAILABLE') {
      return res.status(503).json({ error: error.message });
    }
    req.log?.error({ err: error }, 'Account request failed');
    return res.status(500).json({ error: 'Account request failed. Please try again.' });
  };

  app.get('/api/auth/session', accountLimiter, async (req, res) => {
    setNoStore(res);
    if (!service.available) {
      return res.json({
        available: false,
        authenticated: false,
        user: null,
        accountTier: null,
        reportCount: null,
        reportUsage: null,
        aiUsage: null,
      });
    }
    try {
      const token = readSessionToken(req);
      const user = await service.getUserForSession(token);
      if (!user && token) clearSessionCookie(res);
      return res.json(await accountResponse(req, user));
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/register', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    try {
      const session = await service.register(req.body);
      setSessionCookie(res, session);
      let verificationEmailSent = false;
      if (session.verification && emailService.available) {
        try {
          await emailService.sendVerificationEmail({
            ...session.verification,
            to: session.user.email,
            displayName: session.user.displayName,
          });
          verificationEmailSent = true;
        } catch (error) {
          req.log?.warn({ err: error }, 'Initial verification email delivery failed');
        }
      }
      return res.status(201).json({
        ...await accountResponse(req, session.user),
        verificationEmailSent,
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/login', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    try {
      const session = await service.login(req.body);
      setSessionCookie(res, session);
      return res.json(await accountResponse(req, session.user));
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.get('/api/auth/google/config', accountLimiter, (req, res) => {
    setNoStore(res);
    if (!service.available || !googleVerifier.available) {
      clearGoogleNonceCookie(res);
      return res.json({ available: false, clientId: null, nonce: null });
    }
    const nonce = crypto.randomBytes(32).toString('base64url');
    res.cookie(GOOGLE_NONCE_COOKIE_NAME, nonce, {
      ...cookieOptions,
      maxAge: GOOGLE_NONCE_TTL_MS,
    });
    return res.json({ available: true, clientId: googleVerifier.clientId, nonce });
  });

  app.post('/api/auth/google', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    try {
      const identity = await googleVerifier.verify(req.body?.credential, {
        nonce: parseCookies(req.headers.cookie)[GOOGLE_NONCE_COOKIE_NAME] || null,
      });
      const session = await service.loginWithGoogle({
        ...identity,
        preferences: req.body?.preferences,
      });
      clearGoogleNonceCookie(res);
      setSessionCookie(res, session);
      return res.json(await accountResponse(req, session.user));
    } catch (error) {
      clearGoogleNonceCookie(res);
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/resend-verification', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    if (!emailService.available) {
      return res.status(503).json({ error: 'Email delivery is not configured for this deployment.' });
    }
    try {
      const result = await service.createEmailVerification(readSessionToken(req));
      if (result.alreadyVerified) {
        return res.json({ ok: true, verified: true, message: 'Your email address is already verified.' });
      }
      await emailService.sendVerificationEmail({
        ...result.verification,
        to: result.user.email,
        displayName: result.user.displayName,
      });
      return res.json({ ok: true, verified: false, message: 'Verification email sent.' });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/verify-email', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    try {
      await service.verifyEmailToken(req.body?.token);
      return res.json({ ok: true, message: 'Your email address has been verified.' });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/forgot-password', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    if (!emailService.available) {
      return res.status(503).json({ error: 'Password reset email is not configured for this deployment.' });
    }
    try {
      const result = await service.createPasswordReset(req.body?.email);
      if (result?.reset) {
        void emailService.sendPasswordResetEmail({
          ...result.reset,
          to: result.email,
          displayName: result.displayName,
        }).catch((error) => {
          req.log?.warn({ err: error }, 'Password reset email delivery failed');
        });
      }
      return res.status(202).json({
        ok: true,
        message: 'If a password account exists for that email, a reset link will arrive shortly.',
      });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/reset-password', accountLimiter, authAttemptLimiter, async (req, res) => {
    setNoStore(res);
    try {
      await service.resetPassword(req.body?.token, req.body?.password);
      clearSessionCookie(res);
      return res.json({ ok: true, message: 'Your password has been reset. Sign in with your new password.' });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.patch('/api/account/preferences', async (req, res) => {
    setNoStore(res);
    try {
      const user = await service.updatePreferences(readSessionToken(req), req.body?.preferences);
      return res.json(await accountResponse(req, user));
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/logout', accountLimiter, async (req, res) => {
    setNoStore(res);
    const token = readSessionToken(req);
    try {
      if (service.available) await service.logout(token);
      clearSessionCookie(res);
      return res.json({
        available: service.available,
        authenticated: false,
        user: null,
        accountTier: null,
        reportCount: null,
        reportUsage: null,
        aiUsage: null,
      });
    } catch (error) {
      clearSessionCookie(res);
      return handleError(req, res, error);
    }
  });

  return service;
};

module.exports = {
  ACCOUNT_COOKIE_NAME,
  GOOGLE_NONCE_COOKIE_NAME,
  parseCookies,
  readSessionToken,
  registerAccountRoutes,
};
