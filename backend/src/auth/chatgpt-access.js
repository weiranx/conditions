'use strict';

const { readSessionToken } = require('./account-access');
const { chatGPTService, runWithChatGPT } = require('./chatgpt');

// Background watches, MCP, admin actions and anonymous requests never inherit the owner's plan.
const FOREGROUND_PATHS = new Set([
  '/api/safety', '/api/start-time-scenarios', '/api/day-over-day', '/api/trip-forecasts', '/api/itineraries/check',
  '/api/ai-brief', '/api/ai-brief/opening', '/api/report-chat', '/api/route-suggestions',
  '/api/route-analysis', '/api/snow-vision', '/api/plan-parse', '/api/trip-debrief',
  '/api/forecast-discussion/summary', '/api/healthz', '/api/health',
]);
const ownerId = () => {
  const id = process.env.CHATGPT_OWNER_USER_ID || '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
};

const createChatGPTMiddleware = ({ getAccountService, service = chatGPTService, getOwnerId = ownerId }) => async (req, res, next) => {
  if (!getOwnerId() || !FOREGROUND_PATHS.has(req.path.replace(/\/+$/, '')) || req.headers.authorization) return next();
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  const session = readSessionToken(req);
  if (!session) return next();
  try {
    const accountService = getAccountService();
    if (!accountService?.available) return next();
    const user = await accountService.getUserForSession(session);
    if (user?.id !== getOwnerId()) return next();
    const subscription = { userId: user.id, service, alive: true };
    // Late continuations cannot start subscription requests after the browser disconnects.
    res.once('close', () => { subscription.alive = false; });
    res.once('finish', () => { subscription.alive = false; });
    req.chatgptUser = user;
    return runWithChatGPT(subscription, next);
  } catch {
    return res.status(503).json({ error: 'Could not verify personal ChatGPT access. Try again.', code: 'CHATGPT_ACCOUNT_UNAVAILABLE' });
  }
};

module.exports = { ownerId, createChatGPTMiddleware };
