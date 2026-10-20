'use strict';

const { createHash, randomUUID } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { readSessionToken } = require('../auth/account-access');
const { chatGPTAccounts } = require('../auth/chatgpt-accounts');
const { ChatGPTError } = require('../auth/chatgpt');

const registerChatGPTRoutes = ({ app, accountService, accounts = chatGPTAccounts, allowedOrigins = [] }) => {
  const pending = new Map();
  const redirectUri = 'http://127.0.0.1:1455/auth/callback';
  const transactionKey = (req, user) => createHash('sha256').update(`${user.id}:${readSessionToken(req)}`).digest('hex');
  const prune = () => {
    for (const [key, value] of pending) if (value.attempt.expiresAt <= Date.now()) pending.delete(key);
  };
  const describeSignIn = (value) => value ? { id: value.id, authorizationUrl: value.url, expiresAt: value.attempt.expiresAt } : null;
  const expired = () => new ChatGPTError('Sign-in expired or already finished. Choose Continue with ChatGPT again.', 'CHATGPT_SIGNIN_EXPIRED', 410);
  app.use('/api/account/chatgpt/signin', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please wait and try again.' },
  }));
  const authorize = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    if (!accountService?.available) { res.status(503).json({ error: 'Account service unavailable.' }); return null; }
    const user = await accountService.getUserForSession(readSessionToken(req));
    if (!user) { res.status(401).json({ error: 'Sign in to Conditions first.' }); return null; }
    return user;
  };
  const wrap = (handler) => async (req, res) => {
    try {
      const user = await authorize(req, res);
      if (!user) return;
      prune();
      if (req.method !== 'GET') {
        // Explicit configured origins; never trust a caller-supplied Host or an absent Origin.
        const origin = req.headers.origin;
        if (!origin || !allowedOrigins.includes(origin)) {
          return res.status(403).json({ error: 'Open Account settings in Conditions to make this change.' });
        }
      }
      const service = accounts.serviceForUser(user.id);
      if (!service && req.path !== '/api/account/chatgpt') return res.status(403).json({ error: 'Personal ChatGPT access is not enabled for this account.' });
      return await handler(req, res, service, user);
    } catch (error) {
      const safe = error instanceof ChatGPTError;
      return res.status(safe ? error.statusCode : 503).json({
        error: safe ? error.message : 'ChatGPT connection unavailable. Check the server setup and try again.',
        code: safe ? error.code : 'CHATGPT_UNAVAILABLE',
      });
    }
  };
  app.get('/api/account/chatgpt', wrap(async (req, res, service, user) => {
    res.json({ enabled: Boolean(service), ...(service ? service.status() : {}), signIn: service ? describeSignIn(pending.get(transactionKey(req, user))) : null });
  }));
  app.post('/api/account/chatgpt/signin/start', wrap(async (req, res, service, user) => {
    if (req.body?.newAccount !== undefined && typeof req.body.newAccount !== 'boolean') {
      return res.status(400).json({ error: 'Invalid sign-in request.' });
    }
    const key = transactionKey(req, user);
    pending.delete(key);
    if (pending.size >= 200) throw new ChatGPTError('Sign-in is busy. Try again shortly.', 'CHATGPT_SIGNIN_BUSY', 429);
    const result = await service.begin({ redirectUri, newAccount: req.body?.newAccount === true });
    const value = { ...result, id: randomUUID() };
    pending.set(key, value);
    res.json({ signIn: describeSignIn(value) });
  }));
  app.post('/api/account/chatgpt/signin/complete', wrap(async (req, res, service, user) => {
    const key = transactionKey(req, user);
    const value = pending.get(key);
    if (!value || req.body?.signInId !== value.id) throw expired();
    const text = req.body?.callbackUrl;
    let callback;
    try {
      if (typeof text !== 'string' || text.length > 8192) throw new Error('Invalid URL');
      callback = new URL(text.trim());
      if (`${callback.origin}${callback.pathname}` !== redirectUri || callback.username || callback.password || callback.hash) throw new Error('Invalid callback');
      for (const field of ['code', 'state', 'client_id', 'error']) {
        if (callback.searchParams.getAll(field).length > 1) throw new Error('Duplicate parameter');
      }
    } catch {
      return res.status(400).json({ error: 'Paste the complete return address from the ChatGPT sign-in tab, beginning with http://127.0.0.1:1455/auth/callback.' });
    }
    // Consume before exchange, including errors. A stale tab cannot consume a newer attempt.
    pending.delete(key);
    res.json({ enabled: true, ...await service.complete(value.attempt, callback), signIn: null });
  }));
  app.post('/api/account/chatgpt/signin/cancel', wrap(async (req, res, _service, user) => {
    const key = transactionKey(req, user);
    if (pending.get(key)?.id === req.body?.signInId) pending.delete(key);
    res.json({ canceled: true });
  }));
  app.post('/api/account/chatgpt/account', wrap(async (req, res, service, user) => {
    if (typeof req.body?.clientId !== 'string' || req.body.clientId.length > 200) return res.status(400).json({ error: 'Choose a saved ChatGPT account.' });
    pending.delete(transactionKey(req, user));
    res.json({ enabled: true, ...await service.selectAccount(req.body.clientId), signIn: null });
  }));
  app.get('/api/account/chatgpt/models', wrap(async (_req, res, service) => res.json({ models: await service.models() })));
  app.post('/api/account/chatgpt/model', wrap(async (req, res, service) => {
    if (typeof req.body?.model !== 'string' || req.body.model.length > 120) return res.status(400).json({ error: 'Choose a ChatGPT model.' });
    res.json({ enabled: true, ...await service.selectModel(req.body.model) });
  }));
  app.post('/api/account/chatgpt/disconnect', wrap(async (req, res, service, user) => {
    pending.delete(transactionKey(req, user));
    const result = await service.disconnect();
    res.json({ enabled: true, ...result, message: result.revoked
      ? 'Disconnected ChatGPT. AI requests now use the configured server provider and Conditions API allowance.'
      : 'Disconnected locally. AI requests now use the configured server provider and Conditions API allowance. Remote revocation was not confirmed; remove Conditions in ChatGPT settings.' });
  }));
};

module.exports = { registerChatGPTRoutes };
