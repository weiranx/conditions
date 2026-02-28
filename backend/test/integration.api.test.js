const request = require('supertest');

const { app } = require('../index');

test('GET /healthz returns healthy payload', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.service).toBe('summitsafe-backend');
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
  expect(res.body.service).toBe('summitsafe-backend');
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
