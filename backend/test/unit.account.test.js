const express = require('express');
const request = require('supertest');

const {
  AccountValidationError,
  DuplicateEmailError,
  createAccountService,
  normalizeEmail,
  parseSessionTtlMs,
  validateAccountPreferences,
  validateDisplayName,
  validatePassword,
} = require('../src/auth/account-service');
const { hashPassword, hashSessionToken, verifyPassword } = require('../src/auth/password');
const { registerAccountRoutes } = require('../src/routes/account');

const PREFERENCES = {
  defaultActivity: 'ski-touring',
  defaultStartTime: '06:30',
  themeMode: 'dark',
  temperatureUnit: 'f',
  elevationUnit: 'ft',
  windSpeedUnit: 'mph',
  timeStyle: 'ampm',
  maxWindGustMph: 30,
  maxPrecipChance: 50,
  minFeelsLikeF: 10,
  maxFeelsLikeF: 90,
  travelWindowHours: 10,
  runnerPaceMinutesPerMile: 25,
  runnerAscentMinutesPer1000Ft: 40,
  runnerStopBufferMinutes: 30,
};

const USER_ROW = {
  id: '8c696be4-e175-4b6a-965b-82bdf3758e0c',
  email: 'climber@example.com',
  display_name: 'Avery Stone',
  created_at: new Date('2026-07-12T10:00:00.000Z'),
  preferences: PREFERENCES,
};

describe('password accounts', () => {
  test('normalizes account input and enforces password length', () => {
    expect(normalizeEmail('  CLIMBER@Example.COM ')).toBe('climber@example.com');
    expect(validateDisplayName('  Avery   Stone  ')).toBe('Avery Stone');
    expect(validatePassword('a long trail password')).toBe('a long trail password');
    expect(() => validatePassword('too-short')).toThrow(AccountValidationError);
    expect(parseSessionTtlMs('7')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('hashes passwords with a random salt and verifies them safely', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');

    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password entirely', first)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false);
  });

  test('validates the complete settings payload before storing it', () => {
    expect(validateAccountPreferences(PREFERENCES)).toEqual(PREFERENCES);
    expect(() => validateAccountPreferences({ ...PREFERENCES, defaultActivity: 'invalid' }))
      .toThrow(AccountValidationError);
    expect(() => validateAccountPreferences({ ...PREFERENCES, travelWindowHours: 48 }))
      .toThrow(AccountValidationError);
  });

  test('creates a user, credentials, and session in one database statement', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [USER_ROW] });
    const service = createAccountService({
      database: { configured: true, query },
      sessionTtlMs: 60_000,
      now: () => Date.parse('2026-07-12T10:00:00.000Z'),
    });

    const result = await service.register({
      displayName: 'Avery Stone',
      email: 'CLIMBER@example.com',
      password: 'correct horse battery staple',
      preferences: PREFERENCES,
    });

    expect(result.user).toEqual({
      id: USER_ROW.id,
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      createdAt: USER_ROW.created_at.toISOString(),
      preferences: PREFERENCES,
    });
    expect(result.token).toHaveLength(43);
    expect(result.expiresAt.toISOString()).toBe('2026-07-12T10:01:00.000Z');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO account_credentials');
    expect(sql).toContain('INSERT INTO user_sessions');
    expect(params[0]).toBe('climber@example.com');
    expect(JSON.parse(params[2])).toEqual(PREFERENCES);
    expect(params[3]).toMatch(/^scrypt\$/);
    expect(params[4]).toMatch(/^[a-f0-9]{64}$/);
  });

  test('logs in with valid credentials and stores only a session-token hash', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ...USER_ROW, password_hash: passwordHash }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createAccountService({ database: { configured: true, query } });

    const result = await service.login({
      email: USER_ROW.email,
      password: 'correct horse battery staple',
    });

    expect(result.user.email).toBe(USER_ROW.email);
    const sessionParams = query.mock.calls[1][1];
    expect(sessionParams[0]).toBe(USER_ROW.id);
    expect(sessionParams[1]).toBe(hashSessionToken(result.token));
    expect(sessionParams[1]).not.toContain(result.token);
  });

  test('maps a unique-email database conflict to a safe account error', async () => {
    const duplicate = Object.assign(new Error('duplicate key detail'), { code: '23505' });
    const service = createAccountService({
      database: { configured: true, query: jest.fn().mockRejectedValue(duplicate) },
    });

    await expect(service.register({
      displayName: 'Avery Stone',
      email: USER_ROW.email,
      password: 'correct horse battery staple',
    })).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  test('updates preferences only through a current signed-in session', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [USER_ROW] });
    const service = createAccountService({ database: { configured: true, query } });

    await expect(service.updatePreferences('test-session-token', PREFERENCES)).resolves.toMatchObject({
      id: USER_ROW.id,
      preferences: PREFERENCES,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE users');
    expect(params[0]).toBe(hashSessionToken('test-session-token'));
    expect(JSON.parse(params[1])).toEqual(PREFERENCES);
    await expect(service.updatePreferences(null, PREFERENCES)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });
});

describe('account routes', () => {
  const makeApp = (service) => {
    const app = express();
    app.use(express.json());
    registerAccountRoutes({ app, service, isProduction: false });
    return app;
  };

  test('registers, sets an HTTP-only session cookie, restores the session, and logs out', async () => {
    const user = {
      id: USER_ROW.id,
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      createdAt: USER_ROW.created_at.toISOString(),
      preferences: PREFERENCES,
    };
    const service = {
      available: true,
      register: jest.fn().mockResolvedValue({
        user,
        token: 'test-session-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      getUserForSession: jest.fn(async (token) => token === 'test-session-token' ? user : null),
      logout: jest.fn().mockResolvedValue(undefined),
      updatePreferences: jest.fn().mockResolvedValue(user),
    };
    const agent = request.agent(makeApp(service));

    const registerResponse = await agent.post('/api/auth/register').send({
      displayName: 'Avery Stone',
      email: USER_ROW.email,
      password: 'correct horse battery staple',
      preferences: PREFERENCES,
    });
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers['cache-control']).toBe('no-store');
    expect(registerResponse.headers['set-cookie'][0]).toMatch(/bc_session=test-session-token/);
    expect(registerResponse.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(registerResponse.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(service.register).toHaveBeenCalledWith(expect.objectContaining({ preferences: PREFERENCES }));

    const sessionResponse = await agent.get('/api/auth/session');
    expect(sessionResponse.body).toEqual({ available: true, authenticated: true, user });
    expect(service.getUserForSession).toHaveBeenCalledWith('test-session-token');

    const preferencesResponse = await agent.patch('/api/account/preferences').send({ preferences: PREFERENCES });
    expect(preferencesResponse.status).toBe(200);
    expect(preferencesResponse.body.user.preferences).toEqual(PREFERENCES);
    expect(service.updatePreferences).toHaveBeenCalledWith('test-session-token', PREFERENCES);

    const logoutResponse = await agent.post('/api/auth/logout');
    expect(logoutResponse.status).toBe(200);
    expect(service.logout).toHaveBeenCalledWith('test-session-token');
    expect(logoutResponse.headers['set-cookie'][0]).toMatch(/bc_session=;/);
  });

  test('returns account availability without exposing a server error when storage is disabled', async () => {
    const response = await request(makeApp({ available: false })).get('/api/auth/session');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false, authenticated: false, user: null });
  });

  test('returns field-safe registration conflicts', async () => {
    const response = await request(makeApp({
      available: true,
      register: jest.fn().mockRejectedValue(new DuplicateEmailError()),
    })).post('/api/auth/register').send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'An account already exists for this email address.',
      field: 'email',
    });
  });

  test('requires a signed-in session before updating preferences', async () => {
    const authenticationError = Object.assign(new Error('Sign in to save account preferences.'), {
      code: 'AUTHENTICATION_REQUIRED',
    });
    const response = await request(makeApp({
      available: true,
      updatePreferences: jest.fn().mockRejectedValue(authenticationError),
    })).patch('/api/account/preferences').send({ preferences: PREFERENCES });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Sign in to save account preferences.' });
  });
});
