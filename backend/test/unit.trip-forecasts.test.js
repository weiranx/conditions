const express = require('express');
const request = require('supertest');

const { registerTripForecastRoutes } = require('../src/routes/trip-forecasts');

const USAGE = {
  tierKey: 'guest',
  unlimited: false,
  usedRuns: 1,
  limitRuns: 3,
  remainingRuns: 2,
  percentUsed: 33.3,
  periodStart: null,
  periodEnd: null,
  resetAt: null,
  exhausted: false,
};

const makeApp = ({ accountService, tierService, usageService, invokeSafetyHandler, ensureFeatureEnabled } = {}) => {
  const app = express();
  app.use(express.json());
  registerTripForecastRoutes({
    app,
    accountService,
    tierService,
    usageService: usageService || {
      available: true,
      reserve: jest.fn().mockResolvedValue({ reservationId: 'reservation-id', duplicate: false, usage: USAGE }),
      finish: jest.fn().mockResolvedValue(USAGE),
    },
    invokeSafetyHandler: invokeSafetyHandler || jest.fn().mockResolvedValue({
      statusCode: 200,
      payload: { forecast: { selectedDate: '2026-07-14' } },
    }),
    ...(ensureFeatureEnabled ? { ensureFeatureEnabled } : {}),
    isProduction: false,
  });
  return app;
};

const validRequest = (agent) => agent
  .post('/api/trip-forecasts')
  .set('Idempotency-Key', 'multi-day-request-1')
  .send({
    lat: 47.4,
    lon: -121.4,
    startDate: '2026-07-14',
    startTime: '07:00',
    durationDays: 7,
    travelWindowHours: 12,
    objectiveName: 'Mailbox Peak',
  });

test('runs seven internal forecasts and counts one successful guest comparison', async () => {
  const usageService = {
    available: true,
    reserve: jest.fn().mockResolvedValue({ reservationId: 'reservation-id', duplicate: false, usage: USAGE }),
    finish: jest.fn().mockResolvedValue(USAGE),
  };
  const invokeSafetyHandler = jest.fn(async (query) => ({
    statusCode: 200,
    payload: { forecast: { selectedDate: query.date } },
  }));
  const response = await validRequest(request(makeApp({ usageService, invokeSafetyHandler })));

  expect(response.status).toBe(200);
  expect(response.body.days).toHaveLength(7);
  expect(response.body.multiDayUsage).toEqual(USAGE);
  expect(response.headers['set-cookie'][0]).toMatch(/bc_trip_guest=/);
  expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  expect(invokeSafetyHandler).toHaveBeenCalledTimes(7);
  expect(usageService.reserve).toHaveBeenCalledWith(expect.objectContaining({
    userId: undefined,
    anonymousId: expect.any(String),
    tierKey: 'free',
    idempotencyKey: 'multi-day-request-1',
  }));
  expect(usageService.finish).toHaveBeenCalledWith(expect.objectContaining({ succeeded: true }));
});

test('returns the quota contract when the multi-day limit is reached', async () => {
  const limitError = Object.assign(new Error('Guest multi-day forecast limit reached.'), {
    code: 'MULTI_DAY_USAGE_LIMIT_REACHED',
    statusCode: 429,
    usage: { ...USAGE, usedRuns: 3, remainingRuns: 0, percentUsed: 100, exhausted: true },
  });
  const usageService = {
    available: true,
    reserve: jest.fn().mockRejectedValue(limitError),
    finish: jest.fn(),
  };
  const response = await validRequest(request(makeApp({ usageService })));

  expect(response.status).toBe(429);
  expect(response.body.code).toBe('MULTI_DAY_USAGE_LIMIT_REACHED');
  expect(response.body.multiDayUsage).toMatchObject({ remainingRuns: 0, exhausted: true });
  expect(usageService.finish).not.toHaveBeenCalled();
});

test('marks a comparison failed when no forecast day succeeds', async () => {
  const usageService = {
    available: true,
    reserve: jest.fn().mockResolvedValue({ reservationId: 'reservation-id', duplicate: false, usage: USAGE }),
    finish: jest.fn().mockResolvedValue({ ...USAGE, usedRuns: 0 }),
  };
  const response = await validRequest(request(makeApp({
    usageService,
    invokeSafetyHandler: jest.fn().mockResolvedValue({ statusCode: 502, payload: null }),
  })));

  expect(response.status).toBe(502);
  expect(usageService.finish).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false }));
});

test('rejects a duration outside the supported 2–7 day range', async () => {
  const response = await request(makeApp())
    .post('/api/trip-forecasts')
    .set('Idempotency-Key', 'multi-day-request-invalid')
    .send({
      lat: 47.4,
      lon: -121.4,
      startDate: '2026-07-14',
      startTime: '07:00',
      durationDays: 8,
      travelWindowHours: 12,
    });
  expect(response.status).toBe(400);
});

test('rejects new multi-day forecasts when trip planning is disabled', async () => {
  const usageService = {
    available: true,
    reserve: jest.fn(),
    finish: jest.fn(),
  };
  const response = await validRequest(request(makeApp({
    usageService,
    ensureFeatureEnabled: () => {
      const error = new Error('This feature is unavailable');
      error.code = 'FEATURE_DISABLED';
      error.statusCode = 503;
      throw error;
    },
  })));

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('FEATURE_DISABLED');
  expect(usageService.reserve).not.toHaveBeenCalled();
});
