const express = require('express');
const request = require('supertest');
const { registerSavedReportRoutes } = require('../src/routes/saved-reports');

const USER_ID = '8c696be4-e175-4b6a-965b-82bdf3758e0c';
const BASELINE_QUERY = {
  lat: '46.8523',
  lon: '-121.7603',
  forecastDate: '2026-07-15',
  alpineStartTime: '05:30',
};

const makeApp = (query) => {
  const app = express();
  registerSavedReportRoutes({
    app,
    database: { configured: true, query },
    accountService: {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue({ id: USER_ID }),
    },
  });
  return app;
};

test.each([
  { lat: '' },
  { lat: '   ' },
  { lon: '' },
  { lon: '\t' },
  { lat: undefined },
  { lon: undefined },
  { lat: ['0', '1'] },
])('rejects absent or malformed comparison coordinates: %j', async (overrides) => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const response = await request(makeApp(query))
    .get('/api/account/reports/comparison-baseline')
    .query({ ...BASELINE_QUERY, ...overrides });

  expect(response.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

test.each([
  { forecastDate: '2026-02-29' },
  { forecastDate: '2026-04-31' },
  { forecastDate: '2026-13-01' },
  { forecastDate: '2026-00-01' },
  { alpineStartTime: '24:00' },
  { alpineStartTime: '05:60' },
])('rejects impossible comparison dates or times: %j', async (overrides) => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const response = await request(makeApp(query))
    .get('/api/account/reports/comparison-baseline')
    .query({ ...BASELINE_QUERY, ...overrides });

  expect(response.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

test('keeps valid zero coordinates, leap days, and midnight when finding a baseline', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const response = await request(makeApp(query))
    .get('/api/account/reports/comparison-baseline')
    .query({ lat: '0', lon: '0', forecastDate: '2028-02-29', alpineStartTime: '00:00' });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ baseline: null });
  expect(query).toHaveBeenCalledWith(expect.any(String), [USER_ID, 0, 0, '2028-02-29', '00:00', null]);
});

test.each([' ', '\t', '\n', ' \t\n '])('keeps blank history scores unavailable: %j', async (score) => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ id: 'report-id', title: 'Mount Rainier', score }],
  });
  const response = await request(makeApp(query)).get('/api/account/reports');

  expect(response.status).toBe(200);
  expect(response.body.reports[0].score).toBeNull();
});

test.each(['0', ' 0 ', 0, '72.5'])('preserves measured history scores: %j', async (score) => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ id: 'report-id', title: 'Mount Rainier', score }],
  });
  const response = await request(makeApp(query)).get('/api/account/reports');

  expect(response.status).toBe(200);
  expect(response.body.reports[0].score).toBe(Number(score));
});
