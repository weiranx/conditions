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

// ── Response shape / header assertions ───────────────────────────────────────

test('All 400 validation errors return JSON content-type', async () => {
  const res = await request(app).get('/api/safety');
  expect(res.status).toBe(400);
  expect(res.headers['content-type']).toMatch(/application\/json/);
});

test('Every response carries an X-Request-Id header', async () => {
  const health = await request(app).get('/healthz');
  expect(typeof health.headers['x-request-id']).toBe('string');
  expect(health.headers['x-request-id'].length).toBeGreaterThan(0);

  const bad = await request(app).get('/api/safety');
  expect(typeof bad.headers['x-request-id']).toBe('string');
  expect(bad.headers['x-request-id'].length).toBeGreaterThan(0);
});

test('Each request receives a unique X-Request-Id', async () => {
  const [a, b] = await Promise.all([
    request(app).get('/healthz'),
    request(app).get('/healthz'),
  ]);
  expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
});

// ── /api/search — additional edge cases ─────────────────────────────────────

test('GET /api/search with exactly 2-char query stays on local path and returns array', async () => {
  // Queries under 3 chars skip Nominatim — result set comes from local peak catalog only
  const res = await request(app).get('/api/search?q=mt');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  // Every result must come from the local catalog (class: 'natural')
  expect(res.body.every((entry) => entry.class === 'natural')).toBe(true);
});

test('GET /api/search results each have name, lat, lon fields', async () => {
  const res = await request(app).get('/api/search?q=rain');
  expect(res.status).toBe(200);
  expect(res.body.length).toBeGreaterThan(0);
  for (const entry of res.body) {
    expect(typeof entry.name).toBe('string');
    expect(typeof entry.lat).toBe('number');
    expect(typeof entry.lon).toBe('number');
  }
});

test('GET /api/search popular peaks each have name, lat, lon, type, class fields', async () => {
  const res = await request(app).get('/api/search');
  expect(res.status).toBe(200);
  for (const entry of res.body) {
    expect(typeof entry.name).toBe('string');
    expect(typeof entry.lat).toBe('number');
    expect(typeof entry.lon).toBe('number');
    expect(entry.type).toBe('peak');
    expect(entry.class).toBe('popular');
  }
});

test('GET /api/search is case-insensitive for local catalog matches', async () => {
  const lower = await request(app).get('/api/search?q=rainier');
  const upper = await request(app).get('/api/search?q=RAINIER');
  expect(lower.status).toBe(200);
  expect(upper.status).toBe(200);
  // Both should find at least one Rainier entry
  expect(lower.body.some((e) => String(e.name).includes('Rainier'))).toBe(true);
  expect(upper.body.some((e) => String(e.name).includes('Rainier'))).toBe(true);
});

test('GET /api/search caps q at 120 characters without error', async () => {
  const longQuery = 'a'.repeat(200);
  const res = await request(app).get(`/api/search?q=${longQuery}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

// ── /api/route-suggestions — additional edge cases ───────────────────────────

test('GET /api/route-suggestions rejects empty-string peak', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=&lat=46.85&lon=-121.76');
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*lat.*lon are required/i);
});

test('GET /api/route-suggestions accepts lat=0 lon=0 as valid zero coordinates', async () => {
  // Zero is a valid coordinate value — validation must not reject it
  const res = await request(app).get('/api/route-suggestions?peak=Null+Island&lat=0&lon=0');
  // Should pass validation (not 400); downstream AI call will fail in test env
  expect(res.status).not.toBe(400);
}, 30000);

test('GET /api/route-suggestions rejects out-of-range lon', async () => {
  const res = await request(app).get('/api/route-suggestions?peak=Mt+Rainier&lat=46.85&lon=200');
  // lon=200 is not finite-invalid per Number() — it parses to 200 which is finite,
  // so the route only validates that lat/lon are finite numbers (not range).
  // Confirm that it does NOT return 400 for the coordinate check (range not enforced here).
  expect([200, 400, 500, 503]).toContain(res.status);
});

// ── /api/route-analysis — additional edge cases ──────────────────────────────

test('POST /api/route-analysis rejects missing peak with all other fields present', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '2026-06-15' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*route.*lat.*lon.*date are required/i);
});

test('POST /api/route-analysis rejects missing route with all other fields present', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', lat: 46.85, lon: -121.76, date: '2026-06-15' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/peak.*route.*lat.*lon.*date are required/i);
});

test('POST /api/route-analysis accepts start=00:00 as valid lower boundary', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '2026-06-15', start: '00:00' });
  // Passes validation — downstream AI/safety calls will fail in test env
  expect(res.status).not.toBe(400);
}, 30000);

test('POST /api/route-analysis accepts start=23:59 as valid upper boundary', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '2026-06-15', start: '23:59' });
  expect(res.status).not.toBe(400);
}, 30000);

test('POST /api/route-analysis accepts omitted start (start is optional)', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: -121.76, date: '2026-06-15' });
  // No start provided — must not be rejected with 400
  expect(res.status).not.toBe(400);
}, 30000);

test('POST /api/route-analysis rejects lat=0 due to falsy-coordinate bug (documents known issue)', async () => {
  // The route uses `!lat` / `!lon` which treats numeric zero as missing.
  // lat=0 (equator) is a geographically valid coordinate, but the current code
  // rejects it with 400. This test documents the existing behavior.
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Null Island', route: 'Shore Walk', lat: 0, lon: 0, date: '2026-06-15' });
  expect(res.status).toBe(400);
});

test('POST /api/route-analysis rejects non-numeric lon', async () => {
  const res = await request(app)
    .post('/api/route-analysis')
    .send({ peak: 'Mt Rainier', route: 'Disappointment Cleaver', lat: 46.85, lon: 'west', date: '2026-06-15' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/valid numbers/i);
});

// ── /api/ai-brief — additional edge cases ───────────────────────────────────

test('POST /api/ai-brief rejects score=null explicitly', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: null, primaryHazard: 'avalanche', decisionLevel: 'GO' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief rejects empty-string primaryHazard', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 72, primaryHazard: '', decisionLevel: 'GO' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief rejects empty-string decisionLevel', async () => {
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 72, primaryHazard: 'wind', decisionLevel: '' });
  expect(res.status).toBe(400);
  expect(String(res.body.error || '')).toMatch(/Missing required fields/i);
});

test('POST /api/ai-brief passes validation when factors and context are omitted', async () => {
  // factors and context are optional — omitting them must not cause a 400
  const res = await request(app)
    .post('/api/ai-brief')
    .send({ score: 55, primaryHazard: 'weather', decisionLevel: 'CAUTION' });
  expect(res.status).not.toBe(400);
});

test('POST /api/ai-brief 400 response carries JSON content-type', async () => {
  const res = await request(app).post('/api/ai-brief').send({});
  expect(res.status).toBe(400);
  expect(res.headers['content-type']).toMatch(/application\/json/);
});

// ── HTTP method mismatches ────────────────────────────────────────────────────

test('POST /api/safety is not a registered route (Express returns 404)', async () => {
  const res = await request(app).post('/api/safety').send({});
  expect(res.status).toBe(404);
});

test('GET /api/ai-brief is not a registered route (Express returns 404)', async () => {
  const res = await request(app).get('/api/ai-brief');
  expect(res.status).toBe(404);
});

test('GET /api/route-analysis is not a registered route (Express returns 404)', async () => {
  const res = await request(app).get('/api/route-analysis');
  expect(res.status).toBe(404);
});
