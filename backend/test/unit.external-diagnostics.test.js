const { runExternalDiagnostics } = require('../src/utils/external-diagnostics');

const createResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  body: { cancel: jest.fn(async () => {}) },
});

test('external diagnostics check every configured service without exposing request details', async () => {
  const fetchWithTimeout = jest.fn(async () => createResponse());

  const result = await runExternalDiagnostics({ fetchWithTimeout, env: {} });

  expect(result.summary.total).toBeGreaterThan(20);
  expect(result.summary.operational).toBe(fetchWithTimeout.mock.calls.length);
  expect(result.summary.failed).toBe(0);
  expect(result.summary.notConfigured).toBeGreaterThan(0);
  expect(result.services.every((service) => !('url' in service) && !('options' in service))).toBe(true);
  expect(fetchWithTimeout.mock.calls.every(([, , timeout]) => timeout === 9000)).toBe(true);
});

test('external diagnostics isolate upstream failures and return sanitized messages', async () => {
  let avalancheAttempts = 0;
  const fetchWithTimeout = jest.fn(async (url) => {
    if (url.includes('avalanche.org')) {
      avalancheAttempts += 1;
      const error = new Error('private network detail');
      error.name = 'AbortError';
      throw error;
    }
    if (url.includes('epqs.nationalmap.gov')) return createResponse(503);
    return createResponse();
  });

  const result = await runExternalDiagnostics({ fetchWithTimeout, env: {} });
  const avalanche = result.services.find((service) => service.id === 'avalanche-org');
  const elevation = result.services.find((service) => service.id === 'usgs-elevation');

  expect(result.summary.failed).toBe(2);
  expect(avalancheAttempts).toBe(2);
  expect(avalanche).toEqual(expect.objectContaining({ status: 'failed', message: 'Timed out' }));
  expect(elevation).toEqual(expect.objectContaining({ status: 'failed', httpStatus: 503, message: 'Upstream returned HTTP 503' }));
  expect(JSON.stringify(result)).not.toContain('private network detail');
});

test('external diagnostics recover from one transient upstream failure', async () => {
  let airNowAttempts = 0;
  const fetchWithTimeout = jest.fn(async (url) => {
    if (url.includes('airnowapi.org')) {
      airNowAttempts += 1;
      if (airNowAttempts === 1) {
        const error = new Error('temporary timeout');
        error.name = 'AbortError';
        throw error;
      }
    }
    return createResponse();
  });

  const result = await runExternalDiagnostics({
    fetchWithTimeout,
    env: { AIRNOW_API_KEY: 'air-secret' },
  });
  const airNow = result.services.find((service) => service.id === 'airnow');

  expect(airNowAttempts).toBe(2);
  expect(airNow).toEqual(expect.objectContaining({ status: 'operational', httpStatus: 200 }));
  expect(result.summary.failed).toBe(0);
});

test('external diagnostics do not retry definitive client errors', async () => {
  let airNowAttempts = 0;
  const fetchWithTimeout = jest.fn(async (url) => {
    if (url.includes('airnowapi.org')) {
      airNowAttempts += 1;
      return createResponse(401);
    }
    return createResponse();
  });

  const result = await runExternalDiagnostics({
    fetchWithTimeout,
    env: { AIRNOW_API_KEY: 'invalid-air-secret' },
  });
  const airNow = result.services.find((service) => service.id === 'airnow');

  expect(airNowAttempts).toBe(1);
  expect(airNow).toEqual(expect.objectContaining({
    status: 'failed',
    httpStatus: 401,
    message: 'Upstream returned HTTP 401',
  }));
});

test('credentialed diagnostics send keys upstream but never include them in results', async () => {
  const env = {
    NPS_API_KEY: 'nps-secret',
    AIRNOW_API_KEY: 'air-secret',
    NASA_FIRMS_MAP_KEY: 'firms-secret',
    SENTINEL_HUB_CLIENT_ID: 'sentinel-client',
    SENTINEL_HUB_CLIENT_SECRET: 'sentinel-secret',
    OPENAI_API_KEY: 'openai-secret',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    KIMI_API_KEY: 'kimi-secret',
  };
  const fetchWithTimeout = jest.fn(async () => createResponse());

  const result = await runExternalDiagnostics({ fetchWithTimeout, env });
  const serialized = JSON.stringify(result);

  Object.values(env).forEach((secret) => expect(serialized).not.toContain(secret));
  expect(result.summary.notConfigured).toBe(0);
  expect(result.summary.failed).toBe(0);
});
