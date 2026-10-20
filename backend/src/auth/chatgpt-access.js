'use strict';

const { readSessionToken } = require('./account-access');
const { runWithChatGPT } = require('./chatgpt');
const { chatGPTAccounts } = require('./chatgpt-accounts');

// Background watches, MCP, admin actions and anonymous requests never inherit the owner's plan.
const FOREGROUND_PATHS = new Set([
  '/api/safety', '/api/start-time-scenarios', '/api/day-over-day', '/api/trip-forecasts', '/api/itineraries/check',
  '/api/ai-brief', '/api/ai-brief/opening', '/api/report-chat', '/api/route-suggestions',
  '/api/route-analysis', '/api/snow-vision', '/api/plan-parse', '/api/trip-debrief',
  '/api/forecast-discussion/summary', '/api/healthz', '/api/health',
]);
const createChatGPTMiddleware = ({ getAccountService, accounts = chatGPTAccounts }) => async (req, res, next) => {
  if (!accounts.isEnabled() || !FOREGROUND_PATHS.has(req.path.replace(/\/+$/, '')) || req.headers.authorization) return next();
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  const session = readSessionToken(req);
  if (!session) return next();
  try {
    const accountService = getAccountService();
    if (!accountService?.available) return next();
    const user = await accountService.getUserForSession(session);
    const service = user && accounts.serviceForUser(user.id);
    // Making connection setup available does not opt an account into subscription billing.
    // Expired sessions stay on this path and never fall back to API billing; a disconnected one uses the app's providers.
    if (!service || !service.routesRequests()) return next();
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

module.exports = { createChatGPTMiddleware };
