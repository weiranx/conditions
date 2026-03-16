const request = require('supertest');

const { app } = require('../index');

test('GET /healthz returns healthy payload', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.service).toBe('backcountry-conditions-backend');
  expect(typeof res.body.timestamp).toBe('string');
  expect(res.body.timestamp.length).toBeGreaterThan(0);
  expect(typeof res.headers['x-request-id']).toBe('string');
  expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
});

test('GET /health mirrors healthz', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('GET /api/healthz returns healthy payload for API-prefixed clients', async () => {
  const res = await request(app).get('/api/healthz');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.service).toBe('backcountry-conditions-backend');
});

test('GET /api/safety rejects missing coordinates', async () => {
  const res = await request(app).get('/api/safety');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/safety rejects invalid coordinate ranges', async () => {
  const res = await request(app).get('/api/safety?lat=200&lon=-121.7&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/safety rejects invalid date format', async () => {
  const res = await request(app).get('/api/safety?lat=46.85&lon=-121.76&date=02-20-2026');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Invalid date format/i);
});

test('GET /api/sat-oneliner rejects missing coordinates', async () => {
  const res = await request(app).get('/api/sat-oneliner');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/sat-oneliner rejects invalid coordinate ranges', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=200&lon=-121.7');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/sat-oneliner validates maxLength bounds', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/maxLength/i);
});

test('GET /api/sat-oneliner rejects invalid date format', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&date=02-20-2026');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Invalid date format/i);
});

test('GET /api/search supports short local queries without external dependencies', async () => {
  const res = await request(app).get('/api/search?q=ra');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /api/search without q returns popular peak recommendations', async () => {
  const res = await request(app).get('/api/search');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(5);
  expect(res.body[0]).toMatchObject({
    name: 'Mount Rainier, Washington',
    type: 'peak',
    class: 'popular',
  });
});

test('GET /api/search with local short query returns mountain matches', async () => {
  const res = await request(app).get('/api/search?q=rain');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((entry) => String(entry.name).includes('Rainier'))).toBe(true);
});

test('GET /api/search normalizes punctuation and Mt abbreviation in queries', async () => {
  const res = await request(app).get('/api/search?q=mt.%20rainier');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((entry) => String(entry.name).includes('Rainier'))).toBe(true);
});

test('GET /api/search trims whitespace in short queries before local matching', async () => {
  const res = await request(app).get('/api/search?q=%20%20ra%20%20');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThan(0);
  expect(res.body.every((entry) => entry.class === 'natural')).toBe(true);
});


test('GET /api/sat-oneliner rejects non-numeric maxLength', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=abc');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/maxLength/i);
});

test('GET /api/sat-oneliner rejects maxLength above upper bound', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=500');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/maxLength/i);
});

test('GET /api/search treats whitespace-only q as empty and returns popular peaks', async () => {
  const res = await request(app).get('/api/search?q=%20%20%20');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(5);
  expect(res.body[0]).toMatchObject({
    name: 'Mount Rainier, Washington',
    type: 'peak',
    class: 'popular',
  });
});

test('GET /api/search returns empty list for unmatched short local query', async () => {
  const res = await request(app).get('/api/search?q=zx');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body).toHaveLength(0);
});

// ── Health route completeness ────────────────────────────────────────────────

test('GET /api/health alias also returns healthy payload', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.service).toBe('backcountry-conditions-backend');
});

test('GET /healthz includes version, uptime, memory, and nodeVersion fields', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(typeof res.body.version).toBe('string');
  expect(res.body.version.length).toBeGreaterThan(0);
  expect(typeof res.body.uptime).toBe('number');
  expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  expect(typeof res.body.memory).toBe('object');
  expect(typeof res.body.memory.heapUsedMb).toBe('number');
  expect(typeof res.body.memory.rssMb).toBe('number');
  expect(typeof res.body.nodeVersion).toBe('string');
  expect(Array.isArray(res.body.caches)).toBe(true);
});

// ── /api/safety — additional validation edge cases ───────────────────────────

test('GET /api/safety rejects when only lat is missing', async () => {
  const res = await request(app).get('/api/safety?lon=-121.7&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/safety rejects when only lon is missing', async () => {
  const res = await request(app).get('/api/safety?lat=46.85&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/safety rejects NaN coordinates', async () => {
  const res = await request(app).get('/api/safety?lat=abc&lon=-121.7&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/safety rejects lat below -90', async () => {
  const res = await request(app).get('/api/safety?lat=-91&lon=-121.7&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/safety rejects lon above 180', async () => {
  const res = await request(app).get('/api/safety?lat=46.85&lon=181&date=2026-02-20');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/safety accepts boundary coordinates lat=90 lon=-180', async () => {
  // Validation should pass — downstream may fail but we get past the 400 check
  const res = await request(app).get('/api/safety?lat=90&lon=-180&date=2026-02-20');
  expect(res.status).not.toBe(400);
}, 30000);

// ── /api/sat-oneliner — additional validation edge cases ─────────────────────

test('GET /api/sat-oneliner rejects when only lat is missing', async () => {
  const res = await request(app).get('/api/sat-oneliner?lon=-121.7');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/sat-oneliner rejects when only lon is missing', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Latitude and longitude are required/i);
});

test('GET /api/sat-oneliner rejects NaN coordinates', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=abc&lon=-121.7');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid decimal coordinates/i);
});

test('GET /api/sat-oneliner accepts maxLength at exactly 80 (lower bound)', async () => {
  // 80 is the minimum valid value — validation should pass; downstream may fail
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=80');
  expect(res.status).not.toBe(400);
}, 30000);

test('GET /api/sat-oneliner accepts maxLength at exactly 320 (upper bound)', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=320');
  expect(res.status).not.toBe(400);
}, 30000);

test('GET /api/sat-oneliner rejects maxLength below 80', async () => {
  const res = await request(app).get('/api/sat-oneliner?lat=46.85&lon=-121.76&maxLength=79');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/maxLength/i);
});

// ── /api/ai-brief ────────────────────────────────────────────────────────────

test('POST /api/ai-brief rejects request with empty body', async () => {
  const res = await request(app).post('/api/ai-brief').send({});
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief rejects missing score', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ primaryHazard: 'avalanche', decisionLevel: 'GO' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief rejects missing primaryHazard', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 72, decisionLevel: 'GO' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief rejects missing decisionLevel', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 72, primaryHazard: 'wind' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief accepts score of 0 as a valid non-null value', async () => {
  // score=0 must NOT trigger "Missing required fields" — the check is `score == null`
  // The call will reach the AI layer and likely fail in test (no real Claude), so we
  // only assert it gets past validation (not a 400).
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 0, primaryHazard: 'weather', decisionLevel: 'NO-GO' });
  expect(res.status).not.toBe(400);
});

// ── /api/route-suggestions ───────────────────────────────────────────────────

test('GET /api/route-suggestions rejects missing peak', async () => {
  const res = await request(app).get('/api/route-suggestions?lat=46.85&lon=-121.76');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*lat.*lon are required/i);
});

test('GET /api/route-suggestions rejects missing lat', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=Mt+Rainier&lon=-121.76');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*lat.*lon are required/i);
});

test('GET /api/route-suggestions rejects missing lon', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=Mt+Rainier&lat=46.85');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*lat.*lon are required/i);
});

test('GET /api/route-suggestions rejects non-numeric lat', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=Mt+Rainier&lat=abc&lon=-121.76');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid numbers/i);
});

test('GET /api/route-suggestions rejects non-numeric lon', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=Mt+Rainier&lat=46.85&lon=xyz');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid numbers/i);
});

// ── /api/route-analysis ──────────────────────────────────────────────────────

test('POST /api/route-analysis rejects empty body', async () => {
  const res = await request(app).post('/api/route-analysis').send({});
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*route.*lat.*lon.*date are required/i);
});

test('POST /api/route-analysis rejects missing date', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76 });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*route.*lat.*lon.*date are required/i);
});

test('POST /api/route-analysis rejects invalid date format', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '02-20-2026' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/YYYY-MM-DD/i);
});

test('POST /api/route-analysis rejects invalid start time format', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '2026-06-15', start: '6am' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/HH:MM/i);
});

test('POST /api/route-analysis rejects non-numeric lat', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 'north', lon: -121.76, date: '2026-06-15' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid numbers/i);
});

// ── /api/report-logs ─────────────────────────────────────────────────────────

test('GET /api/report-logs returns 403 when LOGS_SECRET is not configured', async () => {
  // In the test environment LOGS_SECRET env var is unset, so the endpoint is disabled.
  const res = await request(app).get('/api/report-logs');
  expect(res.status).toBe(403);
  expect(String(res.body.error || '')).toMatch(/disabled|LOGS_SECRET/i);
});
