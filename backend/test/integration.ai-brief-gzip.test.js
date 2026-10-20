const zlib = require('node:zlib');
const request = require('supertest');

const { createApp } = require('../src/server/create-app');
const { registerAiBriefRoute } = require('../src/routes/ai-brief');

// The browser gzips the report it sends for an AI read; the server's own
// middleware chain must read it as it reads plain JSON.
const ORIGIN = 'https://conditions.example';
const setup = () => {
  const app = createApp({ isProduction: true, corsAllowlist: [ORIGIN], rateLimitWindowMs: 60000, rateLimitMaxRequests: 100 });
  const askAI = jest.fn().mockResolvedValue(JSON.stringify({
    hero: { headline: 'Wind builds through the afternoon', reason: 'Gusts reach 37 mph on the ridge.', evidence: [{ path: 'weather.windGust', value: 37 }] },
  }));
  registerAiBriefRoute({
    app,
    askAI,
    ensureAccountAccess: async (req) => { req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' }; return true; },
    ensureFeatureEnabled: () => {},
  });
  return { app, askAI };
};
// Sent over a real connection: supertest re-encodes a Buffer body sent as JSON.
const post = (app, path, payload, headers = {}) => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
        body: payload,
      });
      resolve({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) {
      reject(error);
    } finally {
      server.close();
    }
  });
});
// As the browser writes it, with CompressionStream.
const browserGzip = async (value) => Buffer.from(await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const body = (description) => ({ decisionLevel: 'CAUTION', report: { weather: { description, windGust: 37 }, safety: { explanations: ['Gusty ridge.'] } } });
const gzipped = (value) => zlib.gzipSync(Buffer.from(JSON.stringify(value)));

test('a gzipped AI read request is read like plain JSON', async () => {
  const plain = setup();
  const plainResponse = await request(plain.app).post('/api/ai-brief/opening').set('Origin', ORIGIN).send(body('Plain fixture'));

  const compressed = setup();
  const gzipResponse = await post(compressed.app, '/api/ai-brief/opening', await browserGzip(body('Gzip fixture')), { 'Content-Encoding': 'gzip' });

  expect(gzipResponse.status).toBe(200);
  expect(gzipResponse.body.hero).toMatchObject({ headline: 'Wind builds through the afternoon', level: 'CAUTION' });
  expect(gzipResponse.body.hero).toEqual(plainResponse.body.hero);
  expect(compressed.askAI.mock.calls[0][0]).toContain('Gzip fixture');
  expect(compressed.askAI.mock.calls[0][0].replace('Gzip fixture', 'Plain fixture')).toBe(plain.askAI.mock.calls[0][0]);
});

test('the size limit applies to the inflated report', async () => {
  const { app, askAI } = setup();
  // Under 1 MB compressed, over the 5 MB limit once inflated.
  const huge = body('x'.repeat(6 * 1024 * 1024));
  const payload = gzipped(huge);
  expect(payload.length).toBeLessThan(1024 * 1024);
  const response = await post(app, '/api/ai-brief', payload, { 'Content-Encoding': 'gzip' });
  expect(response.status).toBe(413);
  expect(askAI).not.toHaveBeenCalled();
});

test('the cross-origin preflight allows the Content-Encoding header', async () => {
  const { app } = setup();
  const response = await request(app)
    .options('/api/ai-brief')
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,content-encoding');
  expect(response.status).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
  expect(response.headers['access-control-allow-headers']).toMatch(/content-encoding/i);
});
