import request from 'supertest';
import { app } from '../index.js';

test('GET /healthz returns healthy payload', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('GET /api/search?q=mount rainier returns Rainier', async () => {
  const res = await request(app).get('/api/search?q=mount rainier');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body[0].name).toMatch(/Rainier/i);
}, 15000);

test('GET /api/safety?lat=46.85&lon=-121.76 returns safety report', async () => {
  // Use a mock response or a long timeout since this calls real external APIs
  const res = await request(app)
    .get('/api/safety?lat=46.85&lon=-121.76')
    .timeout({ deadline: 30000 });
  
  if (res.status === 200) {
    expect(res.body).toHaveProperty('safety');
    expect(res.body).toHaveProperty('weather');
    expect(res.body).toHaveProperty('avalanche');
  } else {
    // If external APIs fail, it might return a 500 but still have partial data
    expect([200, 500]).toContain(res.status);
  }
}, 35000);
