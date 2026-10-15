'use strict';

const { readSessionToken } = require('../auth/account-access');
const { ownerId } = require('../auth/chatgpt-access');
const { chatGPTService, ChatGPTError } = require('../auth/chatgpt');

const registerChatGPTRoutes = ({ app, accountService, service = chatGPTService, getOwnerId = ownerId, allowedOrigins = [] }) => {
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
      if (req.method !== 'GET') {
        // Explicit configured origins; never trust a caller-supplied Host or an absent Origin.
        const origin = req.headers.origin;
        if (!origin || !allowedOrigins.includes(origin)) {
          return res.status(403).json({ error: 'Open Account settings in Conditions to make this change.' });
        }
      }
      const enabled = user.id === getOwnerId();
      if (!enabled && req.path !== '/api/account/chatgpt') return res.status(403).json({ error: 'Personal ChatGPT access is not enabled for this account.' });
      return await handler(req, res, enabled);
    } catch (error) {
      const safe = error instanceof ChatGPTError;
      return res.status(safe ? error.statusCode : 503).json({
        error: safe ? error.message : 'ChatGPT connection unavailable. Check the server setup and try again.',
        code: safe ? error.code : 'CHATGPT_UNAVAILABLE',
      });
    }
  };
  app.get('/api/account/chatgpt', wrap(async (_req, res, enabled) => {
    res.json({ enabled, ...(enabled ? service.status() : {}) });
  }));
  app.get('/api/account/chatgpt/models', wrap(async (_req, res) => res.json({ models: await service.models() })));
  app.post('/api/account/chatgpt/model', wrap(async (req, res) => {
    if (typeof req.body?.model !== 'string' || req.body.model.length > 120) return res.status(400).json({ error: 'Choose a ChatGPT model.' });
    res.json({ enabled: true, ...await service.selectModel(req.body.model) });
  }));
  app.post('/api/account/chatgpt/disconnect', wrap(async (_req, res) => {
    const result = await service.disconnect();
    res.json({ enabled: true, ...result, message: result.revoked
      ? 'Disconnected ChatGPT.'
      : 'Disconnected locally. Remote revocation was not confirmed; remove Conditions in ChatGPT settings.' });
  }));
};

module.exports = { registerChatGPTRoutes };
