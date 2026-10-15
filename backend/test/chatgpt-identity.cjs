// Runs in native Node so jose's ESM implementation is tested without Jest's VM loader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatGPTStore } = require('../src/auth/chatgpt-store');
const { createChatGPTService } = require('../src/auth/chatgpt');

async function main() {
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const wrong = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-identity-'));
  try {
    for (const failure of [null, 'issuer', 'audience', 'expiry', 'nonce', 'signature', 'subject']) {
      const store = new ChatGPTStore(path.join(directory, failure || 'valid'));
      let token;
      const service = createChatGPTService({ store, identityKeySet: createLocalJWKSet({ keys: [jwk] }),
        fetcher: async () => ({ ok: true, json: async () => ({ access_token: 'test-access', refresh_token: 'test-refresh', id_token: token,
          token_type: 'Bearer', expires_in: 3600, scope: 'openid resource.invoke chatgpt.tokens.use.direct' }) }) });
      const { attempt } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
      const jwt = new SignJWT({ nonce: failure === 'nonce' ? 'wrong' : attempt.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuedAt()
        .setIssuer(failure === 'issuer' ? 'https://attacker.example' : 'https://auth.openai.com')
        .setAudience(failure === 'audience' ? 'oaiapp_other' : 'oaiapp_test')
        .setExpirationTime(failure === 'expiry' ? Math.floor(Date.now() / 1000) - 100 : '1h');
      if (failure !== 'subject') jwt.setSubject('subject');
      token = await jwt.sign(failure === 'signature' ? wrong.privateKey : privateKey);
      const callback = new URL(`${attempt.redirectUri}?${new URLSearchParams({ state: attempt.state, code: 'code', client_id: 'oaiapp_test' })}`);
      if (failure) {
        await assert.rejects(service.complete(attempt, callback), { code: 'CHATGPT_REAUTHENTICATION_REQUIRED' });
        assert.equal(service.status().connected, false);
      } else assert.equal((await service.complete(attempt, callback)).connected, true);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  // Exercise native SDK streaming through the actual subscription chat implementation.
  process.env.DATABASE_URL = '';
  const { createReportChatStream } = require('../src/routes/report-chat');
  const { runWithChatGPT } = require('../src/auth/chatgpt');
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.model, 'test-account-model');
    const events = [
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const service = { modelForRequest: async () => 'test-account-model', accessToken: async () => 'test-oauth', apiError: () => new Error('test API error') };
    const stream = await runWithChatGPT({ service, userId: 'test-owner', alive: true }, () => createReportChatStream({
      messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'What is the wind?' }] }],
      reportJson: '{}', abortSignal: new AbortController().signal, userId: 'test-owner',
      onError: () => 'unexpected-error',
    }));
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(requests.length, 1);
    assert.ok(chunks.some((chunk) => chunk.type === 'text-delta' && chunk.delta === 'Hello'));
    assert.ok(chunks.some((chunk) => chunk.type === 'finish'));
    assert.equal(chunks.some((chunk) => chunk.type === 'error'), false);
  } finally { globalThis.fetch = previousFetch; }
}
main().catch(() => { console.error('ChatGPT ID-token verification failed.'); process.exitCode = 1; });
