const express = require('express');
const request = require('supertest');
const { createChatGPTMiddleware } = require('../src/auth/chatgpt-access');
const { currentChatGPT } = require('../src/auth/chatgpt');
const { createAccountAccessGuard } = require('../src/auth/account-access');
const { registerChatGPTRoutes } = require('../src/routes/chatgpt');

const owner = { id: '00000000-0000-4000-8000-000000000002', email: 'owner@example.com' };
const other = { id: '00000000-0000-4000-8000-000000000003', email: 'other@example.com' };
const onlyOwner = (service = { hasRegistration: () => true }) => ({ isEnabled: () => true, serviceForUser: (id) => id === owner.id ? service : null });
const accountService = { available: true, getUserForSession: async (token) => token === 'owner' ? owner : token === 'other' ? other : null };

test('only the owner foreground browser request receives a plan context; parallel callers remain isolated', async () => {
  const app = express();
  app.use(createChatGPTMiddleware({ getAccountService: () => accountService, accounts: onlyOwner() }));
  const respond = async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    res.json({ ownerId: currentChatGPT()?.userId || null });
  };
  app.get('/api/safety', respond);
  app.get('/api/objective-watches', respond);
  const responses = await Promise.all([
    request(app).get('/api/safety').set('Cookie', 'bc_session=owner'),
    request(app).get('/api/safety').set('Cookie', 'bc_session=other'),
    request(app).get('/api/safety'),
    request(app).get('/api/safety').set('Cookie', 'bc_session=owner').set('Authorization', 'Bearer mcp-token'),
    request(app).get('/api/objective-watches').set('Cookie', 'bc_session=owner'),
  ]);
  expect(responses.map((r) => r.body.ownerId)).toEqual([owner.id, null, null, null, null]);
  expect(responses[0].headers['cache-control']).toContain('no-store');
  expect(currentChatGPT()).toBeNull();
});

test('owner subscription bypasses app API spend limits while ordinary users retain the guard', async () => {
  const usageService = { available: true, assertUserCanGenerate: jest.fn(async () => ({ exhausted: false })) };
  const guard = createAccountAccessGuard({ service: accountService, usageService });
  const app = express();
  app.use(createChatGPTMiddleware({ getAccountService: () => accountService, accounts: onlyOwner() }));
  app.post('/api/ai-brief', async (req, res) => {
    if (await guard(req, res)) res.json({ userId: req.accountUser.id });
  });
  expect((await request(app).post('/api/ai-brief').set('Cookie', 'bc_session=owner')).status).toBe(200);
  expect(usageService.assertUserCanGenerate).not.toHaveBeenCalled();
  expect((await request(app).post('/api/ai-brief').set('Cookie', 'bc_session=other')).status).toBe(200);
  expect(usageService.assertUserCanGenerate).toHaveBeenCalledWith(other.id, 'free');
});

test('connection controls require the real owner session and explicit allowed Origin', async () => {
  const service = { status: jest.fn(() => ({ state: 'connected', connected: true })), models: jest.fn(async () => []),
    selectModel: jest.fn(), disconnect: jest.fn(async () => ({ connected: false, revoked: false })) };
  const app = express();
  app.use(express.json());
  registerChatGPTRoutes({ app, accountService, accounts: onlyOwner(service), allowedOrigins: ['https://conditions.example.com'] });
  expect((await request(app).get('/api/account/chatgpt')).status).toBe(401);
  expect((await request(app).get('/api/account/chatgpt').set('Cookie', 'bc_session=other')).body).toMatchObject({ enabled: false });
  expect((await request(app).get('/api/account/chatgpt/models').set('Cookie', 'bc_session=other')).status).toBe(403);
  for (const origin of [null, 'https://attacker.example']) {
    const req = request(app).post('/api/account/chatgpt/disconnect').set('Cookie', 'bc_session=owner');
    if (origin) req.set('Origin', origin);
    expect((await req).status).toBe(403);
  }
  expect(service.disconnect).not.toHaveBeenCalled();
  const result = await request(app).post('/api/account/chatgpt/disconnect').set('Cookie', 'bc_session=owner').set('Origin', 'https://conditions.example.com');
  expect(result.status).toBe(200);
  expect(result.body.message).toContain('Remote revocation was not confirmed');
  expect(service.disconnect).toHaveBeenCalledTimes(1);
});

test('parallel personal accounts select their own service from the session, never a supplied user ID', async () => {
  const first = { hasRegistration: () => true, status: () => ({ email: 'first@example.com' }), disconnect: jest.fn(async () => ({ revoked: true })) };
  const second = { hasRegistration: () => true, status: () => ({ email: 'second@example.com' }), disconnect: jest.fn(async () => ({ revoked: true })) };
  const accounts = { isEnabled: () => true, serviceForUser: (id) => id === owner.id ? first : id === other.id ? second : null };
  const app = express();
  app.use(express.json());
  app.use(createChatGPTMiddleware({ getAccountService: () => accountService, accounts }));
  app.get('/api/safety', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const selected = currentChatGPT();
    res.json({ id: selected.userId, ...selected.service.status() });
  });
  registerChatGPTRoutes({ app, accountService, accounts, allowedOrigins: ['https://conditions.example.com'] });
  const results = await Promise.all([
    request(app).get('/api/safety').set('Cookie', 'bc_session=owner').query({ userId: other.id }),
    request(app).get('/api/safety').set('Cookie', 'bc_session=other').query({ userId: owner.id }),
    request(app).get('/api/account/chatgpt').set('Cookie', 'bc_session=owner').query({ userId: other.id }),
    request(app).get('/api/account/chatgpt').set('Cookie', 'bc_session=other'),
  ]);
  expect(results.map((r) => r.body.email)).toEqual(['first@example.com', 'second@example.com', 'first@example.com', 'second@example.com']);
  expect(results.slice(0, 2).map((r) => r.body.id)).toEqual([owner.id, other.id]);
  await request(app).post('/api/account/chatgpt/disconnect').set('Cookie', 'bc_session=other')
    .set('Origin', 'https://conditions.example.com').send({ userId: owner.id });
  expect(second.disconnect).toHaveBeenCalledTimes(1);
  expect(first.disconnect).not.toHaveBeenCalled();
});

test('default-enabled accounts can connect without configuration while untouched accounts keep the server provider', async () => {
  const fs = require('node:fs');
  const directory = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'chatgpt-defaults-'));
  try {
    const { createChatGPTAccounts } = require('../src/auth/chatgpt-accounts');
    const { ChatGPTStore } = require('../src/auth/chatgpt-store');
    const accounts = createChatGPTAccounts({ env: {}, store: new ChatGPTStore(directory) });
    const app = express();
    app.use(createChatGPTMiddleware({ getAccountService: () => accountService, accounts }));
    app.get('/api/safety', (_req, res) => res.json({ userId: currentChatGPT()?.userId || null }));
    registerChatGPTRoutes({ app, accountService, accounts });
    for (const token of ['owner', 'other']) {
      expect((await request(app).get('/api/account/chatgpt').set('Cookie', `bc_session=${token}`)).body).toMatchObject({ enabled: true, connected: false });
      expect((await request(app).get('/api/safety').set('Cookie', `bc_session=${token}`)).body.userId).toBeNull();
    }
    await accounts.serviceForUser(owner.id).store.update((value) => {
      value.registrations.push({ client_id: 'oaiapp_connected' });
      value.activeClientId = 'oaiapp_connected';
    });
    // A retained registration, including a disconnected one, never opts back into API billing.
    expect((await request(app).get('/api/safety').set('Cookie', 'bc_session=owner')).body.userId).toBe(owner.id);
    expect((await request(app).get('/api/safety').set('Cookie', 'bc_session=other')).body.userId).toBeNull();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
