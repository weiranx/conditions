const { registerHealthRoutes } = require('../src/routes/health');

describe('health routes', () => {
  test('reads AI status for each health request', async () => {
    const routes = new Map();
    const app = {
      get: jest.fn((path, handler) => routes.set(path, handler)),
    };
    let available = true;

    registerHealthRoutes(app, {
      ai: () => ({ enabled: available, available }),
    });

    const handler = routes.get('/api/healthz');
    const firstResponse = { json: jest.fn() };
    await handler({}, firstResponse);
    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      ai: { enabled: true, available: true },
    }));

    available = false;
    const secondResponse = { json: jest.fn() };
    await handler({}, secondResponse);
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      ai: { enabled: false, available: false },
    }));
  });

  test('returns 503 when a configured database is unavailable', async () => {
    const routes = new Map();
    const app = {
      get: jest.fn((path, handler) => routes.set(path, handler)),
    };
    registerHealthRoutes(app, {
      database: { health: jest.fn().mockResolvedValue({ configured: true, connected: false, error: 'unavailable' }) },
    });
    const json = jest.fn();
    const response = {
      status: jest.fn(() => ({ json })),
    };

    await routes.get('/healthz')({}, response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      database: { configured: true, connected: false, error: 'unavailable' },
    }));
  });
});
