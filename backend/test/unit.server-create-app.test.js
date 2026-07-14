const request = require('supertest');

const { registerAccountRoutes } = require('../src/routes/account');
const { createApp } = require('../src/server/create-app');

describe('server rate limiting', () => {
  test('keeps account access available after the general API limit is exhausted', async () => {
    const app = createApp({
      isProduction: true,
      corsAllowlist: [],
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 1,
    });
    const user = {
      id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
      email: 'climber@example.com',
      displayName: 'Avery Stone',
      createdAt: '2026-07-12T10:00:00.000Z',
      preferences: {},
    };
    const service = {
      available: true,
      getUserForSession: jest.fn().mockResolvedValue(null),
      register: jest.fn().mockResolvedValue({
        user,
        token: 'test-session-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };

    app.get('/api/example', (_req, res) => res.json({ ok: true }));
    registerAccountRoutes({ app, service, isProduction: false });

    await request(app).get('/api/example').expect(200);
    await request(app)
      .get('/api/example')
      .expect(429, { error: 'Too many requests. Please retry later.' });

    await request(app)
      .get('/api/auth/session')
      .expect(200, {
        available: true,
        authenticated: false,
        user: null,
        accountTier: null,
        reportCount: null,
        reportUsage: null,
        multiDayUsage: null,
        aiUsage: null,
      });
    await request(app)
      .post('/api/auth/register')
      .send({
        displayName: 'Avery Stone',
        email: 'climber@example.com',
        password: 'correct horse battery staple',
      })
      .expect(201);

    expect(service.register).toHaveBeenCalledTimes(1);
  });

  test('retains the stricter limit for repeated authentication attempts', async () => {
    const app = createApp({
      isProduction: true,
      corsAllowlist: [],
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 1,
    });
    const invalidCredentials = Object.assign(new Error('Email or password is incorrect.'), {
      code: 'INVALID_CREDENTIALS',
    });
    const service = {
      available: true,
      login: jest.fn().mockRejectedValue(invalidCredentials),
    };

    registerAccountRoutes({ app, service, isProduction: false });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'climber@example.com', password: 'incorrect password' })
        .expect(401, { error: 'Email or password is incorrect.' });
    }

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'climber@example.com', password: 'incorrect password' })
      .expect(429, { error: 'Too many account attempts. Please wait and try again.' });

    expect(service.login).toHaveBeenCalledTimes(20);
  });
});
