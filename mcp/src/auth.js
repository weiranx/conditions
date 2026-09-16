// Account authorization is owned by the Conditions backend. This service neither
// stores browser sessions nor issues shared owner credentials.
export function installAuth(app, config) {
  const resource = `${config.publicUrl}/mcp`;
  app.get('/.well-known/oauth-protected-resource', (_req,res)=>res.json({resource,authorization_servers:[config.publicUrl],scopes_supported:['conditions:read']}));
  return async (req,res,next) => {
    const token = /^Bearer (cmcp_[A-Za-z0-9_-]{43})$/u.exec(req.headers.authorization || '')?.[1];
    const unauthorized = () => res.status(401).set('WWW-Authenticate',`Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`).json({error:'unauthorized'});
    if (!token) return unauthorized();
    try {
      const response = await (config.fetchImpl || fetch)(`${config.baseUrl}/api/auth/mcp/identity`,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403) return unauthorized();
      if (!response.ok) return res.status(503).json({error:'account_verification_unavailable'});
      const identity = await response.json();
      if (typeof identity.userId !== 'string') return res.status(503).json({error:'account_verification_unavailable'});
      req.conditionsToken = token; req.conditionsUserId = identity.userId; next();
    } catch { res.status(503).json({error:'account_verification_unavailable'}); }
  };
}
