const { registerHealthRoutes } = require('../src/routes/health');

describe('health routes', () => {
  test('reads AI status for each health request', () => {
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
    handler({}, firstResponse);
    expect(firstResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      ai: { enabled: true, available: true },
    }));

    available = false;
    const secondResponse = { json: jest.fn() };
    handler({}, secondResponse);
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      ai: { enabled: false, available: false },
    }));
  });
});
