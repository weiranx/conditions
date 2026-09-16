'use strict';
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const TOKEN = /^cmcp_[A-Za-z0-9_-]{43}$/u;
const invalid = () => Object.assign(new Error('Invalid or expired authorization. Please reconnect.'), { statusCode: 400, code: 'invalid_grant' });

function createMcpOAuthService({ database, clientId, clientSecret, redirectUris, issuer, frontendOrigin }) {
  const resource = `${issuer}/mcp`;
  const clientForId = async id => {
    if (id === clientId) return {client_id:clientId,redirect_uris:redirectUris,auth_method:'legacy',secret_hash:hash(clientSecret)};
    if (typeof id !== 'string' || !/^cmcp_client_[A-Za-z0-9_-]{43}$/u.test(id)) return null;
    return (await database.query('SELECT * FROM mcp_oauth_clients WHERE client_id=$1',[id])).rows[0] || null;
  };
  const register = async body => {
    const fail = code => { throw Object.assign(new Error(code),{statusCode:400,code}); };
    if (!body || !Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length>5
      || body.redirect_uris.some(uri => typeof uri !== 'string' || !/^https:\/\/chatgpt\.com\/(?:connector\/oauth\/[A-Za-z0-9_-]{1,200}|connector_platform_oauth_redirect)$/u.test(uri))) fail('invalid_redirect_uri');
    const method=body.token_endpoint_auth_method || 'client_secret_basic';
    if (!['none','client_secret_post','client_secret_basic'].includes(method)
      || (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code') || body.grant_types.some(g=>!['authorization_code','refresh_token'].includes(g))))
      || (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length!==1 || body.response_types[0]!=='code'))
      || (body.scope !== undefined && body.scope!=='conditions:read')) fail('invalid_client_metadata');
    const id='cmcp_client_'+random(), secret=method==='none'?null:random();
    const redirects=[...new Set(body.redirect_uris)];
    await database.transaction(async query=>{
      // Bound anonymous registration storage, including across backend processes.
      await query('SELECT pg_advisory_xact_lock(190019)');
      if (Number((await query('SELECT COUNT(*) AS count FROM mcp_oauth_clients')).rows[0].count)>=10000)
        throw Object.assign(new Error('Registration capacity reached'),{statusCode:503,code:'temporarily_unavailable'});
      await query('INSERT INTO mcp_oauth_clients(client_id,secret_hash,auth_method,redirect_uris) VALUES($1,$2,$3,$4::jsonb)',[id,secret?hash(secret):null,method,JSON.stringify(redirects)]);
    });
    return {client_id:id,...(secret?{client_secret:secret,client_secret_expires_at:0}:{}),client_id_issued_at:Math.floor(Date.now()/1000),
      client_name:'ChatGPT',redirect_uris:redirects,token_endpoint_auth_method:method,grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'conditions:read'};
  };
  const validateRequest = async q => {
    const client=await clientForId(q.client_id);
    if (!client || q.response_type !== 'code' || !client.redirect_uris.includes(q.redirect_uri)
      || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(q.code_challenge || '')
      || typeof q.state !== 'string' || q.state.length > 1024 || q.scope !== 'conditions:read'
      || (q.resource !== undefined && q.resource !== resource)) throw invalid();
    return q;
  };
  const authenticateClient = async (body, authorization) => {
    const method=authorization?.startsWith('Basic ')?'client_secret_basic':body?.client_secret!==undefined?'client_secret_post':'none';
    let id = body?.client_id, secret = body?.client_secret;
    if (authorization?.startsWith('Basic ')) {
      try {
        const value = Buffer.from(authorization.slice(6), 'base64').toString();
        const split = value.indexOf(':');
        if (split < 0) return false;
        id = decodeURIComponent(value.slice(0, split)); secret = decodeURIComponent(value.slice(split + 1));
      } catch { return false; }
    }
    if (authorization && method!=='client_secret_basic') return false;
    if (method==='client_secret_basic' && body?.client_id && body.client_id!==id) return false;
    const client=await clientForId(id);
    if (!client || (client.auth_method!=='legacy' && client.auth_method!==method)) return false;
    if (client.auth_method==='legacy' && method==='none') return false;
    return method==='none' || equal(hash(secret),client.secret_hash) ? id : false;
  };
  const start = async query => {
    const q = await validateRequest(query), request = random();
    await database.query('DELETE FROM mcp_oauth_requests WHERE expires_at <= NOW()');
    await database.query(`INSERT INTO mcp_oauth_requests (token_hash,client_id,redirect_uri,state,challenge)
      VALUES ($1,$2,$3,$4,$5)`, [hash(request),q.client_id,q.redirect_uri,q.state,q.code_challenge]);
    return `${frontendOrigin}/connect?request=${request}`;
  };
  const pending = async request => {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(request || '')) throw invalid();
    const result = await database.query('SELECT * FROM mcp_oauth_requests WHERE token_hash=$1 AND expires_at>NOW()', [hash(request)]);
    if (!result.rows[0]) throw invalid();
    return result.rows[0];
  };
  const approve = async (request, userId, sessionToken, allow) => database.transaction(async query => {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(request || '')) throw invalid();
    const session = (await query('SELECT id,expires_at FROM user_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>NOW() FOR UPDATE', [hash(sessionToken),userId])).rows[0];
    if (!session) throw invalid();
    const item = (await query('DELETE FROM mcp_oauth_requests WHERE token_hash=$1 AND expires_at>NOW() RETURNING *', [hash(request)])).rows[0];
    if (!item) throw invalid();
    const target = new URL(item.redirect_uri); target.searchParams.set('state',item.state);
    if (!allow) { target.searchParams.set('error','access_denied'); return target.href; }
    const grant = (await query(`INSERT INTO mcp_oauth_grants (user_id,session_id,client_id,expires_at)
      VALUES ($1,$2,$3,LEAST($4::timestamptz,NOW()+INTERVAL '30 days')) RETURNING id`, [userId,session.id,item.client_id,session.expires_at])).rows[0];
    const code = `cmcp_${random()}`;
    await query(`INSERT INTO mcp_oauth_tokens (token_hash,grant_id,kind,expires_at,metadata)
      VALUES ($1,$2,'code',NOW()+INTERVAL '60 seconds',$3::jsonb)`, [hash(code),grant.id,JSON.stringify({challenge:item.challenge,redirect:item.redirect_uri})]);
    target.searchParams.set('code',code); return target.href;
  });
  const exchange = async (body, authenticatedClientId = clientId) => {
    if (body.resource !== undefined && body.resource !== resource) throw invalid();
    if (!['authorization_code','refresh_token'].includes(body.grant_type)) throw invalid();
    if (body.scope !== undefined && body.scope !== 'conditions:read') throw invalid();
    const kind = body.grant_type === 'authorization_code' ? 'code' : 'refresh';
    const token = kind === 'code' ? body.code : body.refresh_token;
    if (!TOKEN.test(token || '')) throw invalid();
    const result = await database.transaction(async query => {
      // Lock the grant before token rows: serializes refresh rotation and revocation.
      const grant = (await query(`SELECT g.* FROM mcp_oauth_grants g JOIN mcp_oauth_tokens t ON t.grant_id=g.id
        JOIN users u ON u.id=g.user_id JOIN user_sessions s ON s.id=g.session_id
        WHERE t.token_hash=$1 AND g.client_id=$2 AND g.revoked_at IS NULL AND g.expires_at>NOW()
        AND s.expires_at>NOW() AND u.status='active' FOR UPDATE OF g`, [hash(token),authenticatedClientId])).rows[0];
      if (!grant) return null;
      const item = (await query('SELECT *,expires_at>NOW() AS valid FROM mcp_oauth_tokens WHERE token_hash=$1', [hash(token)])).rows[0];
      if (!item || item.kind !== kind) return null;
      if (item.consumed_at) {
        // A reused refresh token may have been stolen. Revoke the entire family.
        if (kind === 'refresh') await query('UPDATE mcp_oauth_grants SET revoked_at=NOW() WHERE id=$1', [grant.id]);
        return null;
      }
      if (!item.valid) return null;
      if (kind === 'code' && (body.redirect_uri !== item.metadata.redirect
        || !/^[A-Za-z0-9._~-]{43,128}$/u.test(body.code_verifier || '')
        || createHash('sha256').update(body.code_verifier).digest('base64url') !== item.metadata.challenge)) return null;
      await query('UPDATE mcp_oauth_tokens SET consumed_at=NOW() WHERE token_hash=$1', [hash(token)]);
      const access = `cmcp_${random()}`, refresh = `cmcp_${random()}`;
      await query(`INSERT INTO mcp_oauth_tokens (token_hash,grant_id,kind,expires_at) VALUES
        ($1,$3,'access',LEAST($4::timestamptz,NOW()+INTERVAL '15 minutes')),($2,$3,'refresh',$4)`, [hash(access),hash(refresh),grant.id,grant.expires_at]);
      return { access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:Math.max(1,Math.min(900,Math.floor((new Date(grant.expires_at)-Date.now())/1000))),scope:'conditions:read' };
    });
    if (!result) throw invalid();
    return result;
  };
  const userForToken = async token => {
    if (!TOKEN.test(token || '')) return null;
    const row = (await database.query(`SELECT u.id,u.email,u.display_name FROM mcp_oauth_tokens t
      JOIN mcp_oauth_grants g ON g.id=t.grant_id JOIN users u ON u.id=g.user_id
      JOIN user_sessions s ON s.id=g.session_id
      WHERE t.token_hash=$1 AND t.kind='access' AND t.expires_at>NOW() AND t.consumed_at IS NULL
      AND g.revoked_at IS NULL AND g.expires_at>NOW()
      AND s.expires_at>NOW() AND u.status='active'`, [hash(token)])).rows[0];
    return row ? {id:row.id,email:row.email,displayName:row.display_name} : null;
  };
  const list = async userId => (await database.query(`SELECT id,client_id,created_at,expires_at FROM mcp_oauth_grants
    WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`, [userId])).rows;
  const revoke = async (id,userId) => database.query('UPDATE mcp_oauth_grants SET revoked_at=NOW() WHERE id=$1 AND user_id=$2', [id,userId]);
  const revokeToken = async (token, authenticatedClientId = clientId) => { if (TOKEN.test(token || '')) await database.query(`UPDATE mcp_oauth_grants SET revoked_at=NOW()
    WHERE client_id=$1 AND id IN (SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash=$2)`, [authenticatedClientId,hash(token)]); };
  return { resource,register,validateRequest,authenticateClient,start,pending,approve,exchange,userForToken,list,revoke,revokeToken };
}
module.exports = { createMcpOAuthService, hash };
