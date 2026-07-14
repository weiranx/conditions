const express = require('express');
const request = require('supertest');
const { registerObjectiveWatchCheckRoute, secretsMatch } = require('../src/routes/objective-watch-checks');

const makeApp = ({ secret = 'cron-secret', checker = { run: jest.fn().mockResolvedValue({ checked: 2 }) } } = {}) => {
  const app = express();
  registerObjectiveWatchCheckRoute({
    app,
    secret,
    checker,
    ensureFeatureEnabled: () => {},
    log: { info: jest.fn(), error: jest.fn() },
  });
  return { app, checker };
};

test('compares cron secrets without exposing their length or contents', () => {
  expect(secretsMatch('same-secret', 'same-secret')).toBe(true);
  expect(secretsMatch('wrong', 'same-secret')).toBe(false);
});

test('requires a configured valid bearer secret before running checks', async () => {
  const unconfigured = await request(makeApp({ secret: '' }).app).post('/api/internal/objective-watch-checks');
  expect(unconfigured.status).toBe(503);

  const { app, checker } = makeApp();
  const unauthorized = await request(app)
    .post('/api/internal/objective-watch-checks')
    .set('Authorization', 'Bearer wrong-secret');
  expect(unauthorized.status).toBe(401);
  expect(checker.run).not.toHaveBeenCalled();

  const authorized = await request(app)
    .post('/api/internal/objective-watch-checks')
    .set('Authorization', 'Bearer cron-secret');
  expect(authorized.status).toBe(200);
  expect(authorized.body).toEqual({ ok: true, checked: 2 });
  expect(checker.run).toHaveBeenCalledTimes(1);
});
