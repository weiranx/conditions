const express = require('express');
const request = require('supertest');
const { registerObjectiveWatchCheckRoute, secretsMatch } = require('../src/routes/objective-watch-checks');

const makeApp = ({
  secret = 'cron-secret',
  checker = { run: jest.fn().mockResolvedValue({ checked: 2 }) },
  scheduler = null,
  ensureFeatureEnabled = () => {},
} = {}) => {
  const app = express();
  registerObjectiveWatchCheckRoute({
    app,
    secret,
    checker,
    scheduler,
    ensureFeatureEnabled,
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

test('records scheduler health around successful automatic checks', async () => {
  const scheduler = {
    recordHeartbeat: jest.fn().mockResolvedValue({ enabled: true }),
    recordStarted: jest.fn().mockResolvedValue(),
    recordCompleted: jest.fn().mockResolvedValue(),
    recordFailed: jest.fn().mockResolvedValue(),
  };
  const { app } = makeApp({ scheduler });
  const response = await request(app)
    .post('/api/internal/objective-watch-checks')
    .set('Authorization', 'Bearer cron-secret');

  expect(response.status).toBe(200);
  expect(scheduler.recordHeartbeat).toHaveBeenCalledTimes(1);
  expect(scheduler.recordStarted).toHaveBeenCalledTimes(1);
  expect(scheduler.recordCompleted).toHaveBeenCalledWith({ checked: 2 });
  expect(scheduler.recordFailed).not.toHaveBeenCalled();
});

test('keeps the host heartbeat healthy while automatic checks are stopped', async () => {
  const scheduler = {
    recordHeartbeat: jest.fn().mockResolvedValue({ enabled: false }),
    recordSkipped: jest.fn().mockResolvedValue(),
  };
  const { app, checker } = makeApp({ scheduler });
  const response = await request(app)
    .post('/api/internal/objective-watch-checks')
    .set('Authorization', 'Bearer cron-secret');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ok: true, skipped: true, reason: 'scheduler_disabled' });
  expect(scheduler.recordSkipped).toHaveBeenCalledWith('skipped_disabled');
  expect(checker.run).not.toHaveBeenCalled();
});

test('treats a disabled Objective Watch feature as an intentional skipped run', async () => {
  const featureError = new Error('Objective Watch is disabled.');
  const scheduler = {
    recordHeartbeat: jest.fn().mockResolvedValue({ enabled: true }),
    recordSkipped: jest.fn().mockResolvedValue(),
  };
  const { app, checker } = makeApp({
    scheduler,
    ensureFeatureEnabled: () => { throw featureError; },
  });
  const response = await request(app)
    .post('/api/internal/objective-watch-checks')
    .set('Authorization', 'Bearer cron-secret');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ok: true, skipped: true, reason: 'feature_disabled' });
  expect(scheduler.recordSkipped).toHaveBeenCalledWith('skipped_feature_disabled');
  expect(checker.run).not.toHaveBeenCalled();
});
