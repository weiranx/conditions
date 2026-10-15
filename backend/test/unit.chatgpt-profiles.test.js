const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatGPTStore, ChatGPTProfileStore } = require('../src/auth/chatgpt-store');
const { createChatGPTAccounts } = require('../src/auth/chatgpt-accounts');
const { createChatGPTService, chatGPTCacheKey, runWithChatGPT } = require('../src/auth/chatgpt');

const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const scopes = ['resource.invoke', 'chatgpt.tokens.use.direct'];
const registration = (label) => ({ client_id: `oaiapp_${label}`, subject: label, email: `${label}@example.com`, issuer: 'https://auth.openai.com',
  access_token: `${label}-access`, refresh_token: `${label}-refresh`, expiresAt: Date.now() + 3600000, scopes, model: `${label}-model` });
const seed = (store, record) => store.update((value) => { value.registrations.push(record); value.activeClientId = record.client_id; });

let directory; let store;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-profiles-')); store = new ChatGPTStore(directory); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('profile mutations preserve legacy credentials, share host identity, and keep model/token selection isolated', async () => {
  const legacy = new ChatGPTProfileStore(store);
  const first = new ChatGPTProfileStore(store, firstId);
  const second = new ChatGPTProfileStore(store, secondId);
  await seed(legacy, registration('legacy'));
  const host = store.read().hostId;
  await Promise.all([seed(first, registration('first')), seed(second, registration('second'))]);
  expect(first.read().hostId).toBe(host);
  expect(second.read().hostId).toBe(host);
  expect(legacy.read().registrations.map((r) => r.subject)).toEqual(['legacy']);
  expect(first.read().registrations.map((r) => r.subject)).toEqual(['first']);
  await second.update((value) => { value.registrations[0].model = 'changed'; });
  expect(first.read().registrations[0].model).toBe('first-model');
  expect(second.read().registrations[0].model).toBe('changed');
  expect(JSON.stringify(createChatGPTService({ store: first }).status())).not.toContain('second');
});

test('personal allowlist selects separate profiles and keeps legacy owner mapping compatible', async () => {
  await seed(new ChatGPTProfileStore(store), registration('legacy'));
  await seed(new ChatGPTProfileStore(store, secondId), registration('second'));
  const env = { CHATGPT_OWNER_USER_ID: firstId, CHATGPT_ACCOUNT_USER_IDS: `${firstId}, ${secondId}, invalid` };
  const accounts = createChatGPTAccounts({ env, store });
  expect(accounts.serviceForUser(firstId).status().email).toBe('legacy@example.com');
  expect(accounts.serviceForUser(secondId).status().email).toBe('second@example.com');
  expect(accounts.serviceForUser('../../escape')).toBeNull();
  expect(accounts.serviceForUser('00000000-0000-4000-8000-000000000004')).toBeNull();
  delete env.CHATGPT_ACCOUNT_USER_IDS;
  expect(accounts.serviceForUser(secondId)).toBeNull();
});

test('refreshes serialize without overwriting another profile, and disconnect touches only the selected account', async () => {
  const first = new ChatGPTProfileStore(store, firstId);
  const second = new ChatGPTProfileStore(store, secondId);
  await seed(first, { ...registration('first'), expiresAt: 1 });
  await seed(second, { ...registration('second'), expiresAt: 1 });
  const fetcher = jest.fn(async (_url, options) => {
    const old = options.body.get('refresh_token');
    return { ok: true, status: 200, json: async () => ({ access_token: `${old}-access-new`, refresh_token: `${old}-rotated`, token_type: 'Bearer', expires_in: 3600 }) };
  });
  const one = createChatGPTService({ store: first, fetcher });
  const two = createChatGPTService({ store: second, fetcher });
  expect(await Promise.all([one.accessToken(), two.accessToken()])).toEqual(['first-refresh-access-new', 'second-refresh-access-new']);
  expect(first.read().registrations[0].refresh_token).toBe('first-refresh-rotated');
  expect(second.read().registrations[0].refresh_token).toBe('second-refresh-rotated');
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await two.disconnect();
  expect(two.status().connected).toBe(false);
  expect(one.status().connected).toBe(true);
});

test('the same renewable session cannot be copied between personal profiles', async () => {
  const record = registration('first');
  await seed(new ChatGPTProfileStore(store, firstId), record);
  await expect(seed(new ChatGPTProfileStore(store, secondId), record)).rejects.toThrow('another Conditions account');
  expect(new ChatGPTProfileStore(store, secondId).read().registrations).toHaveLength(0);
});

test('CLI export/import transfers one selected profile and preserves the destination host ID', async () => {
  const previousDir = process.env.CHATGPT_AUTH_DIR;
  const previousOwner = process.env.CHATGPT_OWNER_USER_ID;
  process.env.CHATGPT_AUTH_DIR = directory;
  delete process.env.CHATGPT_OWNER_USER_ID;
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const { main } = require('../scripts/chatgpt');
    await seed(new ChatGPTProfileStore(store, firstId), registration('first'));
    await seed(new ChatGPTProfileStore(store, secondId), registration('second'));
    const exportedFile = path.join(directory, 'transfer', 'credentials.json');
    await main(['export', exportedFile, '--user', firstId]);
    const exported = new ChatGPTStore(path.dirname(exportedFile)).read();
    expect(exported.registrations.map((r) => r.subject)).toEqual(['first']);
    process.env.CHATGPT_AUTH_DIR = path.join(directory, 'server');
    const destination = new ChatGPTStore(process.env.CHATGPT_AUTH_DIR);
    await destination.update(() => {});
    const host = destination.read().hostId;
    await main(['import', exportedFile, '--user', firstId]);
    expect(destination.read().hostId).toBe(host);
    expect(new ChatGPTProfileStore(destination, firstId).read().registrations[0].subject).toBe('first');
    expect(new ChatGPTProfileStore(destination, secondId).read().registrations).toHaveLength(0);
    await expect(main(['import', exportedFile, '--user', secondId])).rejects.toThrow('different Conditions account');
    expect(output.mock.calls.flat().join(' ')).not.toContain('first-refresh');
  } finally {
    output.mockRestore();
    if (previousDir === undefined) delete process.env.CHATGPT_AUTH_DIR; else process.env.CHATGPT_AUTH_DIR = previousDir;
    if (previousOwner === undefined) delete process.env.CHATGPT_OWNER_USER_ID; else process.env.CHATGPT_OWNER_USER_ID = previousOwner;
  }
});

test('AI cache keys separate Conditions accounts, ChatGPT registrations, and models', () => {
  const service = (clientId, model) => ({ status: () => ({ model, accounts: [{ clientId, active: true }] }) });
  const key = (userId, clientId, model) => runWithChatGPT({ userId, service: service(clientId, model) }, () => chatGPTCacheKey('same-report'));
  expect(new Set([key(firstId, 'client', 'model'), key(secondId, 'client', 'model'), key(firstId, 'other-client', 'model'), key(firstId, 'client', 'other-model'), chatGPTCacheKey('same-report')]).size).toBe(5);
});
