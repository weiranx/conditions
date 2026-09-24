'use strict';
const { describeCallback } = require('../auth/mcp-clients');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createMcpOAuthService } = require('../auth/mcp-oauth');
const { readSessionToken } = require('../auth/account-access');
const allowedReadPath = path => path === '/api/auth/mcp/identity' || path === '/api/search' || path === '/api/safety'
  || path === '/api/start-time-scenarios' || path === '/api/day-over-day' || path === '/api/route-suggestions'
  || path === '/api/account/reports' || /^\/api\/account\/reports\/[0-9a-f-]{36}$/iu.test(path)
  || path === '/api/account/objective-watches';
// Report sections the app computes by POST. They store nothing for the user,
// but they count against the account's AI and multi-day usage like the app does.
const REPORT_COMPUTE_PATHS = new Set(['/api/ai-brief', '/api/route-analysis', '/api/snow-vision', '/api/trip-forecasts']);
const allowedMcpRequest = (method, path) => (method === 'GET' && allowedReadPath(path))
  || (method === 'POST' && REPORT_COMPUTE_PATHS.has(path));
function registerMcpOAuthRoutes({ app, database, accountService, env = process.env, service }) {
  const issuer = env.MCP_PUBLIC_URL, frontendOrigin = env.MCP_FRONTEND_ORIGIN;
  if (!issuer && !service) return;
  const clientId = env.MCP_OAUTH_CLIENT_ID, clientSecret = env.MCP_OAUTH_CLIENT_SECRET;
  const redirectUris = (env.MCP_OAUTH_REDIRECT_URIS || '').split(',').map(s=>s.trim()).filter(Boolean);
  for (const origin of [issuer,frontendOrigin]) {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin || u.username || u.password) throw new Error('MCP origins must be exact HTTPS origins.');
  }
  if (!clientId || !clientSecret || clientSecret.length < 32 || !redirectUris.length) throw new Error('MCP OAuth client settings are incomplete.');
  for (const uri of redirectUris) { const u = new URL(uri); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('Invalid MCP callback.'); }
  const auth = service || createMcpOAuthService({database,clientId,clientSecret,redirectUris,issuer,frontendOrigin});
  const noStore = (_req,res,next) => { res.set('Cache-Control','no-store'); next(); };
  app.use('/api/auth/mcp', noStore, rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false}));
  const wrap = handler => async (req,res,next) => {
    try { await handler(req,res,next); }
    catch (error) { res.status(error.statusCode || 503).json({error:error.code || 'temporarily_unavailable'}); }
  };
  const requireBrowser = wrap(async (req,res,next) => {
    if (req.method !== 'GET' && req.headers.origin !== frontendOrigin) return res.status(403).json({error:'untrusted_origin'});
    const user = await accountService.getUserForSession(readSessionToken(req));
    if (!user) return res.status(401).json({error:'Sign in to Conditions to continue.'});
    req.oauthUser = user; next();
  });
  app.get('/api/auth/mcp/metadata', noStore, (_req,res)=>res.json({issuer,
    authorization_endpoint:`${issuer}/api/auth/mcp/authorize`,token_endpoint:`${issuer}/api/auth/mcp/token`,
    registration_endpoint:`${issuer}/api/auth/mcp/register`,
    revocation_endpoint:`${issuer}/api/auth/mcp/revoke`,response_types_supported:['code'],
    grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
    token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],scopes_supported:['conditions:read']}));
  app.post('/api/auth/mcp/register',rateLimit({windowMs:3600000,limit:20,standardHeaders:true,legacyHeaders:false}),wrap(async(req,res)=>res.status(201).json(await auth.register(req.body))));
  app.get('/api/auth/mcp/authorize',wrap(async(req,res)=>res.redirect(303,await auth.start(req.query))));
  app.get('/api/auth/mcp/request/:request',requireBrowser,wrap(async(req,res)=>{
    const pending=await auth.pending(req.params.request);
    const client=describeCallback(pending.redirect_uri);
    if (!client) return res.status(400).json({error:'invalid_redirect_uri'});
    res.json({...client,scope:'conditions:read',userId:req.oauthUser.id});
  }));
  app.post('/api/auth/mcp/approve',requireBrowser,wrap(async(req,res)=>{
    if (typeof req.body?.allow !== 'boolean' || req.body.userId !== req.oauthUser.id) return res.status(409).json({error:'Account changed. Reload and review the connection.'});
    res.json({redirect:await auth.approve(req.body.request,req.oauthUser.id,readSessionToken(req),req.body.allow)});
  }));
  app.get('/api/auth/mcp/connections',requireBrowser,wrap(async(req,res)=>res.json({connections:await auth.list(req.oauthUser.id)})));
  app.post('/api/auth/mcp/disconnect',requireBrowser,wrap(async(req,res)=>{
    if (!/^[0-9a-f-]{36}$/iu.test(req.body?.id || '') || req.body.userId !== req.oauthUser.id) return res.status(400).json({error:'invalid_request'});
    await auth.revoke(req.body.id,req.oauthUser.id); res.json({ok:true});
  }));
  const clientAuth = wrap(async(req,res,next) => {
    const id=await auth.authenticateClient(req.body,req.headers.authorization);
    if (!id) return res.status(401).json({error:'invalid_client'});
    req.oauthClientId=id; next();
  });
  app.post('/api/auth/mcp/token',express.urlencoded({extended:false,limit:'8kb'}),clientAuth,wrap(async(req,res)=>res.json(await auth.exchange(req.body,req.oauthClientId))));
  app.post('/api/auth/mcp/revoke',express.urlencoded({extended:false,limit:'8kb'}),clientAuth,wrap(async(req,res)=>{await auth.revokeToken(req.body.token,req.oauthClientId);res.json({});}));
  // OAuth bearer credentials never grant writes or access to arbitrary API routes.
  app.use(wrap(async(req,res,next)=>{
    if (!req.headers.authorization?.startsWith('Bearer cmcp_')) return next();
    if (!allowedMcpRequest(req.method, req.path)) return res.status(403).json({error:'insufficient_scope'});
    const token = req.headers.authorization.slice(7);
    const user = await auth.userForToken(token);
    if (!user) return res.status(401).json({error:'invalid_token'});
    req.mcpUser = user; next();
  }));
  app.get('/api/auth/mcp/identity', (req,res)=> req.mcpUser ? res.json({userId:req.mcpUser.id}) : res.status(401).json({error:'invalid_token'}));
  return auth;
}
module.exports = { registerMcpOAuthRoutes, allowedReadPath, allowedMcpRequest };
