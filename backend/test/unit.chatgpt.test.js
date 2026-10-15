const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ChatGPTStore } = require('../src/auth/chatgpt-store');
const { createChatGPTService } = require('../src/auth/chatgpt');

const scope = 'openid email offline_access resource.invoke chatgpt.tokens.use.direct';
const tokens = (overrides = {}) => ({ access_token: 'test-access', refresh_token: 'test-refresh', id_token: 'test-id', token_type: 'Bearer', expires_in: 3600, scope, ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const callback = (attempt, params = {}) => new URL(`${attempt.redirectUri}?${new URLSearchParams({ state: attempt.state, code: 'test-code', client_id: 'oaiapp_test', ...params })}`);

test('real JWT verification checks signature, issuer, audience, expiry, nonce and subject', () => {
  require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'chatgpt-identity.cjs')], { timeout: 15000 });
});

describe('personal ChatGPT OAuth and protected credentials', () => {
  let directory; let store; let fetcher; let service; let verifyIdentity;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-chatgpt-'));
    store = new ChatGPTStore(directory);
    fetcher = jest.fn();
    verifyIdentity = jest.fn(async () => ({ sub: 'test-subject', email: 'person@example.com' }));
    service = createChatGPTService({ store, fetcher, verifyIdentity });
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const connect = async () => {
    const { attempt } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
    fetcher.mockResolvedValueOnce(response(tokens()));
    await service.complete(attempt, callback(attempt));
    return attempt;
  };

  test('registers with PKCE, persists a stable host, and reuses the issued client on later logins', async () => {
    const { attempt, url } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
    const authorize = new URL(url);
    const host = store.read().hostId;
    expect(authorize.origin).toBe('https://auth.openai.com');
    expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(authorize.searchParams.get('agent_name_hint')).toBe('Conditions');
    expect(authorize.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(authorize.searchParams.get('code_challenge')).toBe(createHash('sha256').update(attempt.verifier).digest('base64url'));
    fetcher.mockResolvedValueOnce(response(tokens()));
    await expect(service.complete(attempt, callback(attempt))).resolves.toMatchObject({ connected: true });
    expect(verifyIdentity).toHaveBeenCalledWith('test-id', 'oaiapp_test', attempt.nonce);
    const exchange = fetcher.mock.calls[0];
    expect(exchange[1].body.get('client_id')).toBe('oaiapp_test');
    expect(exchange[1].body.get('redirect_uri')).toBe(attempt.redirectUri);
    expect(exchange[1].body.get('code_verifier')).toBe(attempt.verifier);
    expect(exchange[1].body.has('client_secret')).toBe(false);
    const returning = await service.begin({ redirectUri: 'http://127.0.0.1:2000/auth/callback' });
    expect(new URL(returning.url).searchParams.get('client_id')).toBe('oaiapp_test');
    expect(new URL(returning.url).searchParams.has('agent_name_hint')).toBe(false);
    expect(new URL(returning.url).searchParams.has('id_token_hint')).toBe(false);
    expect(store.read().hostId).toBe(host);
    expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(service.status())).not.toContain('test-access');
    await expect(service.complete(attempt, callback(attempt))).rejects.toMatchObject({ code: 'CHATGPT_INVALID_STATE' });
  });

  test.each(['state', 'expired', 'denied', 'missing-client', 'changed-client', 'invalid-identity'])('rejects %s without storing credentials', async (failure) => {
    const { attempt } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
    const uri = callback(attempt);
    if (failure === 'state') uri.searchParams.set('state', 'wrong');
    if (failure === 'expired') attempt.expiresAt = Date.now() - 1;
    if (failure === 'denied') uri.searchParams.set('error', 'access_denied');
    if (failure === 'missing-client') uri.searchParams.delete('client_id');
    if (failure === 'changed-client') attempt.clientId = 'oaiapp_original';
    if (failure === 'invalid-identity') {
      fetcher.mockResolvedValueOnce(response(tokens()));
      verifyIdentity.mockRejectedValueOnce(new Error('sensitive JWT details'));
    }
    await expect(service.complete(attempt, uri)).rejects.toThrow();
    expect(service.status().connected).toBe(false);
    expect(store.read().registrations).toHaveLength(0);
    if (failure !== 'invalid-identity') expect(fetcher).not.toHaveBeenCalled();
  });

  test('identity sign-in without granted plan scope cannot make requests', async () => {
    const { attempt } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
    fetcher.mockResolvedValueOnce(response(tokens({ scope: 'openid email offline_access' })));
    expect(await service.complete(attempt, callback(attempt))).toMatchObject({ state: 'permission_required', connected: false });
    await expect(service.accessToken()).rejects.toMatchObject({ code: 'CHATGPT_PERMISSION_REQUIRED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('serializes rotating refreshes across two service instances and commits the replacement together', async () => {
    await connect();
    await store.update((value) => { value.registrations[0].expiresAt = Date.now() - 1000; });
    fetcher.mockResolvedValueOnce(response(tokens({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: undefined })));
    const other = createChatGPTService({ store: new ChatGPTStore(directory), fetcher, verifyIdentity });
    const results = await Promise.all([service.accessToken(), other.accessToken()]);
    expect(results).toEqual(['new-access', 'new-access']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].body.get('grant_type')).toBe('refresh_token');
    expect(fetcher.mock.calls[1][1].body.get('scope')).toBeNull();
    expect(store.read().registrations[0].refresh_token).toBe('new-refresh');
  });

  test('invalid refresh stops reuse and asks for sign-in; transient errors retain credentials', async () => {
    await connect();
    await store.update((value) => { value.registrations[0].expiresAt = 1; });
    fetcher.mockRejectedValueOnce(new Error('network failure containing a token'));
    await expect(service.accessToken()).rejects.toThrow('Could not reach OpenAI');
    expect(store.read().registrations[0].refresh_token).toBe('test-refresh');
    fetcher.mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400));
    await expect(service.accessToken()).rejects.toMatchObject({ code: 'CHATGPT_REAUTHENTICATION_REQUIRED' });
    expect(store.read().registrations[0].refresh_token).toBeUndefined();
    expect(service.status().state).toBe('reauthentication_required');
  });

  test('persists rotated credentials even when the returned grant removes plan permission', async () => {
    await connect();
    await store.update((value) => { value.registrations[0].expiresAt = 1; });
    fetcher.mockResolvedValueOnce(response(tokens({ refresh_token: 'rotated', scope: 'openid email', id_token: undefined })));
    await expect(service.accessToken()).rejects.toMatchObject({ code: 'CHATGPT_PERMISSION_REQUIRED' });
    expect(store.read().registrations[0].refresh_token).toBe('rotated');
  });

  test('disconnect clears tokens even if revocation is unavailable and retains the client and host', async () => {
    await connect();
    const host = store.read().hostId;
    fetcher.mockRejectedValueOnce(new Error('offline'));
    const result = await service.disconnect();
    expect(result).toMatchObject({ connected: false, revoked: false });
    const value = store.read();
    expect(value.hostId).toBe(host);
    expect(value.registrations[0]).toMatchObject({ client_id: 'oaiapp_test', subject: 'test-subject' });
    expect(JSON.stringify(value)).not.toContain('test-access');
    expect(JSON.stringify(value)).not.toContain('test-refresh');
    expect(JSON.stringify(value)).not.toContain('test-id');
  });

  test('catalog uses this account token, preserves model ordering, and rejects unavailable models', async () => {
    await connect();
    const catalog = { models: [
      { slug: 'model-first', display_name: 'First', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
      { slug: 'hidden', visibility: 'hidden' },
      { slug: 'model-second', display_name: 'Second', visibility: 'list', supported_reasoning_levels: ['minimal', 'medium'] },
    ] };
    fetcher.mockResolvedValue(response(catalog));
    expect(await service.models()).toEqual([{ id: 'model-first', name: 'First' }, { id: 'model-second', name: 'Second' }]);
    expect(fetcher.mock.calls[1][0]).toBe('https://api.openai.com/v1/models');
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer test-access');
    await expect(service.selectModel('invented-model')).rejects.toMatchObject({ code: 'CHATGPT_INVALID_MODEL' });
    expect(await service.modelForRequest()).toBe('model-first');
    expect((await service.selectModel('model-second')).model).toBe('model-second');
    expect(await service.reasoningEffortsFor('model-first')).toEqual(['low', 'high']);
    expect(await service.reasoningEffortsFor('model-second')).toEqual(['minimal', 'medium']);
    expect(await service.reasoningEffortsFor('hidden')).toEqual([]);
  });

  test('refuses world-readable credentials and symlinks', async () => {
    await connect();
    fs.chmodSync(store.file, 0o644);
    expect(service.status().state).toBe('unavailable');
    await expect(service.accessToken()).rejects.toThrow('owner-only');
    fs.chmodSync(store.file, 0o600);
    fs.renameSync(store.file, path.join(directory, 'protected.json'));
    fs.symlinkSync(path.join(directory, 'protected.json'), store.file);
    expect(service.status().state).toBe('unavailable');
  });
});
