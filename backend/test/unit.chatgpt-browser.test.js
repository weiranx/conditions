const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createChatGPTAccounts } = require('../src/auth/chatgpt-accounts');
const { createChatGPTService } = require('../src/auth/chatgpt');
const { ChatGPTStore } = require('../src/auth/chatgpt-store');
const { registerChatGPTRoutes } = require('../src/routes/chatgpt');

const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const origin = 'https://conditions.example.com';
const prefix = '/api/account/chatgpt';

describe('browser ChatGPT sign-in', () => {
  let directory; let app; let accounts; let fetcher; let verifyIdentity;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-web-oauth-'));
    fetcher = jest.fn(async (_url, options) => {
      const id = options.body.get('client_id');
      return { ok: true, status: 200, json: async () => ({ access_token: `private-access-${id}`, refresh_token: `private-refresh-${id}`,
        id_token: `private-id-${id}`, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' }) };
    });
    verifyIdentity = jest.fn(async (_token, clientId) => ({ sub: `subject-${clientId}`, email: `${clientId}@example.com` }));
    accounts = createChatGPTAccounts({ env: {}, store: new ChatGPTStore(directory),
      createService: (options) => createChatGPTService({ ...options, fetcher, verifyIdentity }) });
    const accountService = { available: true, getUserForSession: async (token) => ['first', 'first-other-browser'].includes(token)
      ? { id: firstId } : token === 'second' ? { id: secondId } : null };
    app = express();
    app.use(express.json());
    registerChatGPTRoutes({ app, accountService, accounts, allowedOrigins: [origin] });
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

  const post = (action, body = {}, token = 'first') => request(app).post(`${prefix}/${action}`).set('Origin', origin).set('Cookie', `bc_session=${token}`).send(body);
  const start = async (token = 'first', newAccount = false) => {
    const response = await post('signin/start', { newAccount }, token);
    expect(response.status).toBe(200);
    return response.body.signIn;
  };
  const returned = (signIn, clientId = 'oaiapp_first') => {
    const authorization = new URL(signIn.authorizationUrl);
    const url = new URL(authorization.searchParams.get('redirect_uri'));
    url.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'test-authorization-code', client_id: clientId });
    return url.href;
  };

  test('starts OAuth in the UI, exchanges exactly once, and returns metadata without credentials', async () => {
    const signIn = await start();
    const url = new URL(signIn.authorizationUrl);
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(signIn).not.toHaveProperty('attempt');
    expect(signIn).not.toHaveProperty('verifier');
    const body = { signInId: signIn.id, callbackUrl: returned(signIn), userId: secondId };
    const responses = await Promise.all([post('signin/complete', body), post('signin/complete', body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 410]);
    const result = responses.find((r) => r.status === 200);
    expect(result.body).toMatchObject({ enabled: true, connected: true, signIn: null });
    expect(result.text).not.toContain('private-');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const tokenBody = fetcher.mock.calls[0][1].body;
    expect(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(tokenBody.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    expect(verifyIdentity).toHaveBeenCalledWith('private-id-oaiapp_first', 'oaiapp_first', url.searchParams.get('nonce'));
    expect(accounts.serviceForUser(firstId).status().connected).toBe(true);
    expect(accounts.serviceForUser(secondId).hasRegistration()).toBe(false);
  });

  test('resume and completion are bound to the initiating browser session and Conditions user', async () => {
    const signIn = await start();
    for (const token of ['first-other-browser', 'second']) {
      const status = await request(app).get(prefix).set('Cookie', `bc_session=${token}`);
      expect(status.body.signIn).toBeNull();
      expect((await post('signin/complete', { signInId: signIn.id, callbackUrl: returned(signIn) }, token)).status).toBe(410);
    }
    const status = await request(app).get(prefix).set('Cookie', 'bc_session=first');
    expect(status.body.signIn).toEqual(signIn);
    expect((await post('signin/complete', { signInId: signIn.id, callbackUrl: returned(signIn) })).status).toBe(200);
  });

  test('requires an authenticated session and allowed Origin for all sign-in actions', async () => {
    expect((await request(app).post(`${prefix}/signin/start`).set('Origin', origin).send({})).status).toBe(401);
    for (const action of ['start', 'complete', 'cancel']) {
      for (const badOrigin of [null, 'https://attacker.example']) {
        const req = request(app).post(`${prefix}/signin/${action}`).set('Cookie', 'bc_session=first');
        if (badOrigin) req.set('Origin', badOrigin);
        expect((await req.send({})).status).toBe(403);
      }
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('rejects changed callback origins, ports, paths, fragments, and duplicate parameters before exchange', async () => {
    const signIn = await start();
    const callback = returned(signIn);
    for (const invalid of [callback.replace('127.0.0.1', 'localhost'), callback.replace(':1455', ':3001'), callback.replace('/auth/callback', '/callback'), `${callback}#fragment`, `${callback}&code=duplicate`, 'x'.repeat(8193)]) {
      expect((await post('signin/complete', { signInId: signIn.id, callbackUrl: invalid })).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await post('signin/complete', { signInId: signIn.id, callbackUrl: callback })).status).toBe(200);
  });

  test('mismatched state and declined consent consume the attempt without exchanging a code', async () => {
    for (const failure of ['state', 'error']) {
      const signIn = await start();
      const callback = new URL(returned(signIn));
      callback.searchParams.set(failure, failure === 'state' ? 'incorrect' : 'access_denied');
      const body = { signInId: signIn.id, callbackUrl: callback.href };
      expect((await post('signin/complete', body)).status).toBe(400);
      expect((await post('signin/complete', body)).status).toBe(410);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('stale tabs cannot complete or cancel a newer attempt; expiration and cancellation are enforced', async () => {
    const old = await start();
    const latest = await start();
    expect((await post('signin/complete', { signInId: old.id, callbackUrl: returned(old) })).status).toBe(410);
    await post('signin/cancel', { signInId: old.id });
    expect((await request(app).get(prefix).set('Cookie', 'bc_session=first')).body.signIn.id).toBe(latest.id);
    await post('signin/cancel', { signInId: latest.id });
    expect((await post('signin/complete', { signInId: latest.id, callbackUrl: returned(latest) })).status).toBe(410);
    const expired = await start();
    jest.spyOn(Date, 'now').mockReturnValue(expired.expiresAt + 1);
    expect((await post('signin/complete', { signInId: expired.id, callbackUrl: returned(expired) })).status).toBe(410);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('saved account selection stays inside the Conditions profile and reauthorization uses its issued client', async () => {
    const initial = await start();
    await post('signin/complete', { signInId: initial.id, callbackUrl: returned(initial) });
    const additional = await start('first', true);
    expect(new URL(additional.authorizationUrl).searchParams.get('client_id')).toBe('dynamic_agent_client');
    await post('signin/complete', { signInId: additional.id, callbackUrl: returned(additional, 'oaiapp_additional') });
    const foreign = await start('second');
    await post('signin/complete', { signInId: foreign.id, callbackUrl: returned(foreign, 'oaiapp_foreign') }, 'second');
    expect((await post('account', { clientId: 'oaiapp_foreign' })).status).toBe(400);
    const selected = await post('account', { clientId: 'oaiapp_first', userId: secondId });
    expect(selected.body.accounts.find((account) => account.active).clientId).toBe('oaiapp_first');
    const returning = await start();
    expect(new URL(returning.authorizationUrl).searchParams.get('client_id')).toBe('oaiapp_first');
    expect(new URL(returning.authorizationUrl).searchParams.has('agent_name_hint')).toBe(false);
  });
});
