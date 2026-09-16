'use strict';
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const TOKEN = /^cmcp_[A-Za-z0-9_-]{43}$/u;
const invalid = () => Object.assign(new Error('Invalid or expired authorization. Please reconnect.'), { statusCode: 400, code: 'invalid_grant' });

function createMcpOAuthService({ database, clientId, clientSecret, redirectUris, issuer, frontendOrigin }) {
  const resource = `${issuer}/mcp`;
  const validateRequest = q => {
    if (q.client_id !== clientId || q.response_type !== 'code' || !redirectUris.includes(q.redirect_uri)
      || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(q.code_challenge || '')
      || typeof q.state !== 'string' || q.state.length > 1024 || q.scope !== 'conditions:read'
      || (q.resource !== undefined && q.resource !== resource)) throw invalid();
    return q;
  };
  const authenticateClient = (body, authorization) => {
    let id = body?.client_id, secret = body?.client_secret;
    if (authorization?.startsWith('Basic ')) {
      try {
        const value = Buffer.from(authorization.slice(6), 'base64').toString();
        const split = value.indexOf(':');
        if (split < 0) return false;
        id = decodeURIComponent(value.slice(0, split)); secret = decodeURIComponent(value.slice(split + 1));
      } catch { return false; }
    }
    return id === clientId && equal(secret, clientSecret);
  };
  const start = async query => {
    const q = validateRequest(query), request = random();
    await database.query('DELETE FROM mcp_oauth_requests WHERE expires_at <= NOW()');
    await database.query(`INSERT INTO mcp_oauth_requests (token_hash,client_id,redirect_uri,state,challenge)
      VALUES ($1,$2,$3,$4,$5)`, [hash(request),clientId,q.redirect_uri,q.state,q.code_challenge]);
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
      VALUES ($1,$2,$3,LEAST($4::timestamptz,NOW()+INTERVAL '30 days')) RETURNING id`, [userId,session.id,clientId,session.expires_at])).rows[0];
    const code = `cmcp_${random()}`;
    await query(`INSERT INTO mcp_oauth_tokens (token_hash,grant_id,kind,expires_at,metadata)
      VALUES ($1,$2,'code',NOW()+INTERVAL '60 seconds',$3::jsonb)`, [hash(code),grant.id,JSON.stringify({challenge:item.challenge,redirect:item.redirect_uri})]);
    target.searchParams.set('code',code); return target.href;
  });
  const exchange = async body => {
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
        AND s.expires_at>NOW() AND u.status='active' FOR UPDATE OF g`, [hash(token),clientId])).rows[0];
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
      AND g.revoked_at IS NULL AND g.expires_at>NOW() AND g.client_id=$2
      AND s.expires_at>NOW() AND u.status='active'`, [hash(token),clientId])).rows[0];
    return row ? {id:row.id,email:row.email,displayName:row.display_name} : null;
  };
  const list = async userId => (await database.query(`SELECT id,client_id,created_at,expires_at FROM mcp_oauth_grants
    WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`, [userId])).rows;
  const revoke = async (id,userId) => database.query('UPDATE mcp_oauth_grants SET revoked_at=NOW() WHERE id=$1 AND user_id=$2', [id,userId]);
  const revokeToken = async token => { if (TOKEN.test(token || '')) await database.query(`UPDATE mcp_oauth_grants SET revoked_at=NOW()
    WHERE client_id=$1 AND id IN (SELECT grant_id FROM mcp_oauth_tokens WHERE token_hash=$2)`, [clientId,hash(token)]); };
  return { resource,validateRequest,authenticateClient,start,pending,approve,exchange,userForToken,list,revoke,revokeToken };
}
module.exports = { createMcpOAuthService, hash };
