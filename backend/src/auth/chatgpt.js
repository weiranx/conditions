'use strict';

const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { ChatGPTStore, ChatGPTProfileStore } = require('./chatgpt-store');

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;
const context = new AsyncLocalStorage();
const currentChatGPT = () => context.getStore() || null;
const runWithChatGPT = (value, callback) => context.run(value, callback);
const chatGPTCacheKey = (key) => {
  const subscription = currentChatGPT();
  if (!subscription) return key;
  const connection = subscription.service.status();
  return JSON.stringify(['chatgpt', subscription.userId,
    connection.accounts?.find((account) => account.active)?.clientId || null, connection.model || null, key]);
};

class ChatGPTError extends Error {
  constructor(message, code = 'CHATGPT_UNAVAILABLE', statusCode = 503) {
    super(message);
    this.name = 'ChatGPTError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
const needsSignIn = () => new ChatGPTError('Reconnect ChatGPT in Account settings.', 'CHATGPT_REAUTHENTICATION_REQUIRED', 401);
const hasPlan = (record) => record?.scopes?.includes(DIRECT_SCOPE) && record.scopes.includes('resource.invoke');
const scopesFrom = (value) => typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
const activeRecord = (value) => value.registrations.find((record) => record.client_id === value.activeClientId);
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const createChatGPTService = ({ store = new ChatGPTProfileStore(new ChatGPTStore()), fetcher = globalThis.fetch, verifyIdentity, identityKeySet } = {}) => {
  let jwks = identityKeySet;
  const verify = verifyIdentity || (async (token, clientId, nonce) => {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    jwks ||= createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER, audience: clientId, algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw needsSignIn();
    return payload;
  });
  const request = async (url, init = {}) => {
    try {
      return await fetcher(url, { ...init, signal: init.signal || AbortSignal.timeout(15000), redirect: 'error' });
    } catch {
      throw new ChatGPTError('Could not reach OpenAI. Check the connection and try again.');
    }
  };
  const tokenRequest = async (body) => {
    const response = await request(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, resource: RESOURCE }),
    });
    let result;
    try { result = await response.json(); } catch { throw new ChatGPTError('OpenAI returned an invalid token response.'); }
    if (!response.ok) {
      if (['invalid_grant', 'invalid_client'].includes(result?.error)) throw needsSignIn();
      throw new ChatGPTError('ChatGPT authorization is temporarily unavailable. Try again later.');
    }
    if (typeof result.access_token !== 'string' || !result.access_token
      || typeof result.refresh_token !== 'string' || !result.refresh_token
      || String(result.token_type).toLowerCase() !== 'bearer'
      || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
      throw new ChatGPTError('OpenAI returned an incomplete token response. Sign in again.');
    }
    return result;
  };
  const applyTokens = (record, tokens) => {
    record.access_token = tokens.access_token;
    record.refresh_token = tokens.refresh_token;
    if (tokens.id_token) record.id_token = tokens.id_token;
    if (typeof tokens.scope === 'string') record.scopes = scopesFrom(tokens.scope);
    record.expiresAt = Date.now() + tokens.expires_in * 1000;
    record.reauthenticationRequired = false;
  };
  const status = () => {
    try {
      const record = activeRecord(store.read());
      let state = 'disconnected';
      if (record?.reauthenticationRequired) state = 'reauthentication_required';
      else if (record?.access_token && record?.refresh_token) state = hasPlan(record) ? 'connected' : 'permission_required';
      return {
        state, connected: state === 'connected', email: record?.email || null,
        model: record?.model || null,
        accounts: store.read().registrations.map((r) => ({ clientId: r.client_id, email: r.email, active: r.client_id === record?.client_id })),
      };
    } catch {
      return { state: 'unavailable', connected: false, email: null, model: null, accounts: [] };
    }
  };
  const begin = async ({ redirectUri, newAccount = false }) => {
    const callback = new URL(redirectUri);
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/auth/callback') {
      throw new Error('ChatGPT sign-in requires http://127.0.0.1:<port>/auth/callback.');
    }
    await store.update(() => {});
    const value = store.read();
    const selected = newAccount ? null : activeRecord(value);
    const attempt = {
      state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(64).toString('base64url'), redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
      clientId: selected?.client_id || null, subject: selected?.subject || null,
    };
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: attempt.clientId || 'dynamic_agent_client',
      ...(!attempt.clientId ? { agent_name_hint: 'Conditions' } : {}),
      ext_agent_host_id: value.hostId, response_type: 'code', redirect_uri: redirectUri,
      scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
      ...(selected?.email ? { login_hint: selected.email } : {}),
      // Do not include an ID-token hint in terminal output or URLs handled by the app.
    }).toString();
    return { attempt, url: url.href };
  };
  const complete = async (attempt, callback) => {
    if (attempt.used || Date.now() >= attempt.expiresAt || !sameSecret(callback.searchParams.get('state'), attempt.state)) {
      throw new ChatGPTError('Sign-in expired or could not be verified. Start again.', 'CHATGPT_INVALID_STATE', 400);
    }
    attempt.used = true;
    if (callback.searchParams.has('error')) throw new ChatGPTError('ChatGPT sign-in was canceled. Start again to connect.', 'CHATGPT_ACCESS_DENIED', 400);
    const clientId = callback.searchParams.get('client_id') || attempt.clientId;
    const code = callback.searchParams.get('code');
    if (!clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || !code || code.length > 4096
      || (attempt.clientId && attempt.clientId !== clientId)) {
      throw new ChatGPTError('ChatGPT registration was incomplete or changed. Start again.', 'CHATGPT_INVALID_CALLBACK', 400);
    }
    const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri });
    let identity;
    try { identity = await verify(tokens.id_token, clientId, attempt.nonce); } catch { throw needsSignIn(); }
    if (!identity.sub || (attempt.subject && attempt.subject !== identity.sub)) throw needsSignIn();
    // The OAuth response's grant, never the callback or an ID token, enables plan usage.
    if (typeof tokens.scope !== 'string') throw new ChatGPTError('OpenAI did not return granted permissions. Sign in again.');
    await store.update((value) => {
      let record = value.registrations.find((r) => r.client_id === clientId);
      if (record && record.subject !== identity.sub) throw needsSignIn();
      if (!record) { record = { client_id: clientId, subject: identity.sub, issuer: ISSUER }; value.registrations.push(record); }
      record.email = identity.email || null;
      applyTokens(record, tokens);
      value.activeClientId = clientId;
    });
    return status();
  };
  const accessToken = async () => {
    // Refreshes and all mutations share a filesystem lock, including separate CLI processes.
    let authError;
    const token = await store.update(async (value) => {
      const record = activeRecord(value);
      if (!record?.access_token || !record.refresh_token || record.reauthenticationRequired) throw needsSignIn();
      if (!hasPlan(record)) throw new ChatGPTError('Authorize ChatGPT plan usage when connecting.', 'CHATGPT_PERMISSION_REQUIRED', 403);
      if (!Number.isFinite(record.expiresAt) || record.expiresAt - Date.now() < 60000) {
        try {
          const tokens = await tokenRequest({ grant_type: 'refresh_token', client_id: record.client_id, refresh_token: record.refresh_token });
          // An ID token returned by refresh is retained only after signature/identity verification.
          if (tokens.id_token) {
            const identity = await verify(tokens.id_token, record.client_id, undefined);
            if (identity.sub !== record.subject) throw needsSignIn();
          }
          applyTokens(record, tokens);
        } catch (error) {
          if (error.code !== 'CHATGPT_REAUTHENTICATION_REQUIRED') throw error;
          delete record.access_token; delete record.refresh_token; delete record.id_token;
          record.reauthenticationRequired = true;
          authError = error;
          return null;
        }
      }
      if (!hasPlan(record)) {
        authError = new ChatGPTError('ChatGPT plan usage permission was removed. Reconnect ChatGPT.', 'CHATGPT_PERMISSION_REQUIRED', 403);
        return null;
      }
      return record.access_token;
    });
    if (authError) throw authError;
    return token;
  };
  const apiError = (response) => {
    if (response.status === 401) return needsSignIn();
    if (response.status === 403) return new ChatGPTError('Your ChatGPT plan does not allow this request. Review app access in ChatGPT settings.', 'CHATGPT_PERMISSION_REQUIRED', 403);
    if (response.status === 429) return new ChatGPTError('ChatGPT usage limit reached. Review usage in ChatGPT settings and try later.', 'CHATGPT_LIMIT_REACHED', 429);
    return new ChatGPTError('ChatGPT could not complete this request. Try again later.');
  };
  const authenticatedFetch = async (url, init = {}) => {
    const token = await accessToken();
    const response = await request(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw apiError(response);
    return response;
  };
  const models = async () => {
    const response = await authenticatedFetch(`${RESOURCE}/models`);
    const result = await response.json();
    if (!Array.isArray(result.models)) throw new ChatGPTError('ChatGPT returned an invalid model catalog.');
    return result.models.filter((m) => m.visibility === 'list' && typeof m.slug === 'string' && /^[A-Za-z0-9._:/-]{1,120}$/.test(m.slug))
      .map((m) => ({ id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug }));
  };
  const selectModel = async (model) => {
    const catalog = await models();
    if (!catalog.some((m) => m.id === model)) throw new ChatGPTError('Choose a model available to this ChatGPT account.', 'CHATGPT_INVALID_MODEL', 400);
    await store.update((value) => { activeRecord(value).model = model; });
    return status();
  };
  const modelForRequest = async () => {
    const selected = activeRecord(store.read())?.model;
    if (selected) return selected;
    const catalog = await models();
    if (!catalog.length) throw new ChatGPTError('No models are available to this ChatGPT account.');
    await store.update((value) => { activeRecord(value).model = catalog[0].id; });
    return catalog[0].id;
  };
  const disconnect = async () => {
    let revoked = false;
    await store.update(async (value) => {
      const record = activeRecord(value);
      if (!record) { revoked = true; return; }
      if (record.refresh_token) {
        try {
          const discoveryResponse = await request(`${ISSUER}/.well-known/openid-configuration`);
          if (!discoveryResponse.ok) throw new Error('Discovery unavailable');
          const discovery = await discoveryResponse.json();
          const endpoint = new URL(discovery.revocation_endpoint);
          if (endpoint.origin !== ISSUER) throw new Error('Invalid revocation endpoint');
          const response = await request(endpoint.href, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: record.refresh_token, token_type_hint: 'refresh_token', client_id: record.client_id }),
          });
          revoked = response.status === 200;
        } catch { /* Clear locally even when OpenAI cannot confirm revocation. */ }
      } else revoked = true;
      delete record.access_token; delete record.refresh_token; delete record.id_token;
      delete record.expiresAt; delete record.reauthenticationRequired;
    });
    return { ...status(), revoked };
  };
  return { store, status, begin, complete, accessToken, models, selectModel, modelForRequest, disconnect, apiError };
};

const chatGPTService = createChatGPTService();
module.exports = { createChatGPTService, chatGPTService, ChatGPTError, currentChatGPT, runWithChatGPT, chatGPTCacheKey, RESOURCE };
