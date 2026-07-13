'use strict';

const rateLimit = require('express-rate-limit');
const {
  AccountValidationError,
  DuplicateEmailError,
  createAccountService,
} = require('../auth/account-service');
const {
  ACCOUNT_COOKIE_NAME,
  parseCookies,
  readSessionToken,
} = require('../auth/account-access');

const registerAccountRoutes = ({
  app,
  database,
  isProduction = process.env.NODE_ENV === 'production',
  service = createAccountService({ database }),
} = {}) => {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  };
  const authLimiter = rateLimit({
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
  const setNoStore = (res) => res.setHeader('Cache-Control', 'no-store');

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
    if (error?.code === 'AUTHENTICATION_REQUIRED') {
      return res.status(401).json({ error: error.message });
    }
    if (error?.code === 'ACCOUNT_DATABASE_UNAVAILABLE') {
      return res.status(503).json({ error: error.message });
    }
    req.log?.error({ err: error }, 'Account request failed');
    return res.status(500).json({ error: 'Account request failed. Please try again.' });
  };

  app.get('/api/auth/session', async (req, res) => {
    setNoStore(res);
    if (!service.available) {
      return res.json({ available: false, authenticated: false, user: null });
    }
    try {
      const token = readSessionToken(req);
      const user = await service.getUserForSession(token);
      if (!user && token) clearSessionCookie(res);
      return res.json({ available: true, authenticated: Boolean(user), user });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    setNoStore(res);
    try {
      const session = await service.register(req.body);
      setSessionCookie(res, session);
      return res.status(201).json({ available: true, authenticated: true, user: session.user });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    setNoStore(res);
    try {
      const session = await service.login(req.body);
      setSessionCookie(res, session);
      return res.json({ available: true, authenticated: true, user: session.user });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.patch('/api/account/preferences', async (req, res) => {
    setNoStore(res);
    try {
      const user = await service.updatePreferences(readSessionToken(req), req.body?.preferences);
      return res.json({ available: true, authenticated: true, user });
    } catch (error) {
      return handleError(req, res, error);
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    setNoStore(res);
    const token = readSessionToken(req);
    try {
      if (service.available) await service.logout(token);
      clearSessionCookie(res);
      return res.json({ available: service.available, authenticated: false, user: null });
    } catch (error) {
      clearSessionCookie(res);
      return handleError(req, res, error);
    }
  });

  return service;
};

module.exports = {
  ACCOUNT_COOKIE_NAME,
  parseCookies,
  readSessionToken,
  registerAccountRoutes,
};
