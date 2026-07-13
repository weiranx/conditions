const express = require('express');
const request = require('supertest');

const {
  AccountValidationError,
  DuplicateEmailError,
  GoogleAccountLinkError,
  createAccountService,
  normalizeEmail,
  parseSessionTtlMs,
  validateAccountPreferences,
  validateDisplayName,
  validatePassword,
} = require('../src/auth/account-service');
const { createGoogleIdentityVerifier } = require('../src/auth/google-identity');
const { hashPassword, hashSessionToken, verifyPassword } = require('../src/auth/password');
const { createAccountAccessGuard } = require('../src/auth/account-access');
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

const AI_USAGE = {
  tierKey: 'free',
  usedTokens: 12500,
  limitTokens: 250000,
  remainingTokens: 237500,
  percentUsed: 5,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  resetAt: '2026-08-01T00:00:00.000Z',
  exhausted: false,
};

const FREE_TIER = {
  key: 'free',
  label: 'Free',
  status: 'active',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
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

  test('creates a Google account and first-party session in one transaction', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const transaction = jest.fn((callback) => callback(query));
    const service = createAccountService({
      database: { configured: true, query, transaction },
      sessionTtlMs: 60_000,
      now: () => Date.parse('2026-07-12T10:00:00.000Z'),
    });

    const result = await service.loginWithGoogle({
      subject: 'google-account-123',
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      emailAuthoritative: true,
      preferences: PREFERENCES,
    });

    expect(result.user.email).toBe(USER_ROW.email);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[2][0]).toContain("VALUES ('google'");
    expect(query.mock.calls[3][0]).toContain('INSERT INTO account_identities');
    expect(query.mock.calls[4][0]).toContain('INSERT INTO user_sessions');
    expect(query.mock.calls[4][1][1]).toBe(hashSessionToken(result.token));
  });

  test('does not auto-link a non-authoritative Google email to an existing account', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'active', google_subject: null }] });
    const service = createAccountService({
      database: {
        configured: true,
        query,
        transaction: (callback) => callback(query),
      },
    });

    await expect(service.loginWithGoogle({
      subject: 'google-account-123',
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      emailAuthoritative: false,
    })).rejects.toBeInstanceOf(GoogleAccountLinkError);
  });

  test('links an authoritative Google identity without removing password access', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'active', google_subject: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createAccountService({
      database: {
        configured: true,
        query,
        transaction: (callback) => callback(query),
      },
    });

    await expect(service.loginWithGoogle({
      subject: 'google-account-123',
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      emailAuthoritative: true,
    })).resolves.toMatchObject({ user: { id: USER_ROW.id } });

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[2][0]).toContain('INSERT INTO account_identities');
    expect(query.mock.calls.every(([sql]) => !sql.includes('INSERT INTO account_credentials'))).toBe(true);
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

  test('lists account activity and usage for the admin directory', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        ...USER_ROW,
        auth_provider: 'password',
        auth_methods: ['google', 'password'],
        status: 'active',
        updated_at: new Date('2026-07-12T11:00:00.000Z'),
        last_activity_at: new Date('2026-07-12T12:00:00.000Z'),
        active_sessions: '2',
        saved_reports: '4',
        ai_calls: '9',
        ai_tokens: '12500',
        total_count: '1',
        active_count: '1',
        suspended_count: '0',
        total_active_sessions: '2',
      }],
    });
    const service = createAccountService({ database: { configured: true, query } });

    await expect(service.listUsers({ limit: 999 })).resolves.toEqual({
      users: [{
        id: USER_ROW.id,
        email: USER_ROW.email,
        displayName: USER_ROW.display_name,
        authProvider: 'password',
        authMethods: ['google', 'password'],
        status: 'active',
        createdAt: USER_ROW.created_at.toISOString(),
        updatedAt: '2026-07-12T11:00:00.000Z',
        lastActivityAt: '2026-07-12T12:00:00.000Z',
        activeSessions: 2,
        savedReports: 4,
        aiCalls: 9,
        aiTokens: 12500,
      }],
      total: 1,
      summary: { active: 1, suspended: 0, activeSessions: 2 },
      limit: 500,
    });
    expect(query.mock.calls[0][0]).toContain('COUNT(*) FILTER (WHERE expires_at > NOW())');
    expect(query.mock.calls[0][1]).toEqual([500]);
  });

  test('suspends an account and revokes every active session atomically', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{
          ...USER_ROW,
          auth_provider: 'password',
          status: 'suspended',
          updated_at: new Date('2026-07-12T12:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }, { id: 'session-2' }], rowCount: 2 });
    const transaction = jest.fn((callback) => callback(query));
    const service = createAccountService({ database: { configured: true, query, transaction } });

    const result = await service.updateUserStatus({
      userId: USER_ROW.id,
      status: 'suspended',
      actorUserId: 'f39db25c-3498-41f9-9448-7c8004b8f688',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('UPDATE users');
    expect(query.mock.calls[1][0]).toContain('DELETE FROM user_sessions');
    expect(result.user.status).toBe('suspended');
    expect(result.revokedSessions).toBe(2);
  });

  test('revokes a managed account session without changing its status', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{
          ...USER_ROW,
          auth_provider: 'google',
          status: 'active',
          updated_at: new Date('2026-07-12T12:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }], rowCount: 1 });
    const transaction = jest.fn((callback) => callback(query));
    const service = createAccountService({ database: { configured: true, query, transaction } });

    const result = await service.revokeUserSessions({
      userId: USER_ROW.id,
      actorUserId: 'f39db25c-3498-41f9-9448-7c8004b8f688',
    });

    expect(query.mock.calls[0][0]).toContain('FROM users');
    expect(query.mock.calls[1][0]).toContain('DELETE FROM user_sessions');
    expect(result.user.status).toBe('active');
    expect(result.revokedSessions).toBe(1);
  });

  test('prevents the administrator from suspending or signing out the owner account', async () => {
    const query = jest.fn();
    const transaction = jest.fn();
    const service = createAccountService({ database: { configured: true, query, transaction } });

    await expect(service.updateUserStatus({
      userId: USER_ROW.id,
      status: 'suspended',
      actorUserId: USER_ROW.id,
    })).rejects.toMatchObject({ code: 'ADMIN_SELF_MODIFICATION' });
    await expect(service.revokeUserSessions({
      userId: USER_ROW.id,
      actorUserId: USER_ROW.id,
    })).rejects.toMatchObject({ code: 'ADMIN_SELF_MODIFICATION' });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('Google identity verification', () => {
  const NONCE = 'a-secure-google-nonce-value-123456789';

  test('verifies audience and nonce before returning a normalized identity', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({
        sub: 'google-account-123',
        email: 'CLIMBER@Example.COM',
        email_verified: true,
        hd: 'example.com',
        name: 'Avery Stone',
        nonce: NONCE,
      }),
    });
    const verifier = createGoogleIdentityVerifier({
      clientId: 'web-client.apps.googleusercontent.com',
      client: { verifyIdToken },
    });

    await expect(verifier.verify('header.payload.signature-value', { nonce: NONCE })).resolves.toEqual({
      subject: 'google-account-123',
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      emailAuthoritative: true,
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'header.payload.signature-value',
      audience: 'web-client.apps.googleusercontent.com',
    });
  });

  test('rejects a valid Google token when the browser nonce does not match', async () => {
    const verifier = createGoogleIdentityVerifier({
      clientId: 'web-client.apps.googleusercontent.com',
      client: {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            sub: 'google-account-123',
            email: USER_ROW.email,
            email_verified: true,
            nonce: 'a-different-google-nonce-value-12345',
          }),
        }),
      },
    });

    await expect(verifier.verify('header.payload.signature-value', { nonce: NONCE }))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_CREDENTIAL' });
  });
});

describe('account routes', () => {
  const usageService = {
    available: true,
    getUserUsage: jest.fn().mockResolvedValue(AI_USAGE),
  };
  const tierService = {
    available: true,
    getAccountTier: jest.fn().mockResolvedValue(FREE_TIER),
  };
  const reportDatabase = {
    configured: true,
    query: jest.fn().mockResolvedValue({ rows: [{ report_count: '7' }] }),
  };
  const makeApp = (service, googleVerifier, database = reportDatabase) => {
    const app = express();
    app.use(express.json());
    registerAccountRoutes({
      app,
      database,
      service,
      tierService,
      usageService,
      googleVerifier,
      isProduction: false,
    });
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
    expect(sessionResponse.body).toEqual({
      available: true,
      authenticated: true,
      user,
      accountTier: FREE_TIER,
      reportCount: 7,
      aiUsage: AI_USAGE,
    });
    expect(service.getUserForSession).toHaveBeenCalledWith('test-session-token');
    expect(reportDatabase.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM saved_reports'),
      [USER_ROW.id],
    );

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
    expect(response.body).toEqual({
      available: false,
      authenticated: false,
      user: null,
      accountTier: null,
      reportCount: null,
      aiUsage: null,
    });
  });

  test('exchanges a nonce-bound Google credential for the existing session cookie', async () => {
    const user = {
      id: USER_ROW.id,
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      createdAt: USER_ROW.created_at.toISOString(),
      preferences: PREFERENCES,
    };
    const service = {
      available: true,
      loginWithGoogle: jest.fn().mockResolvedValue({
        user,
        token: 'google-session-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const googleVerifier = {
      available: true,
      clientId: 'web-client.apps.googleusercontent.com',
      verify: jest.fn().mockResolvedValue({
        subject: 'google-account-123',
        email: USER_ROW.email,
        displayName: USER_ROW.display_name,
        emailAuthoritative: true,
      }),
    };
    const agent = request.agent(makeApp(service, googleVerifier));

    const configResponse = await agent.get('/api/auth/google/config');
    expect(configResponse.status).toBe(200);
    expect(configResponse.body).toMatchObject({
      available: true,
      clientId: googleVerifier.clientId,
    });
    expect(configResponse.body.nonce).toHaveLength(43);
    expect(configResponse.headers['set-cookie'][0]).toMatch(/bc_google_nonce=/);
    expect(configResponse.headers['set-cookie'][0]).toMatch(/HttpOnly/);

    const loginResponse = await agent.post('/api/auth/google').send({
      credential: 'header.payload.signature-value',
      preferences: PREFERENCES,
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toEqual({
      available: true,
      authenticated: true,
      user,
      accountTier: FREE_TIER,
      reportCount: 7,
      aiUsage: AI_USAGE,
    });
    expect(googleVerifier.verify).toHaveBeenCalledWith('header.payload.signature-value', {
      nonce: configResponse.body.nonce,
    });
    expect(service.loginWithGoogle).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'google-account-123',
      preferences: PREFERENCES,
    }));
    expect(loginResponse.headers['set-cookie'].join(';')).toMatch(/bc_session=google-session-token/);
    expect(loginResponse.headers['set-cookie'].join(';')).toMatch(/bc_google_nonce=;/);
  });

  test('keeps account details available when the report counter cannot be loaded', async () => {
    const user = {
      id: USER_ROW.id,
      email: USER_ROW.email,
      displayName: USER_ROW.display_name,
      createdAt: USER_ROW.created_at.toISOString(),
      preferences: PREFERENCES,
    };
    const response = await request(makeApp(
      { available: true, getUserForSession: jest.fn().mockResolvedValue(user) },
      undefined,
      { configured: true, query: jest.fn().mockRejectedValue(new Error('offline')) },
    )).get('/api/auth/session');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticated: true, user, reportCount: null });
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

describe('AI account access', () => {
  const allowUsageService = {
    available: true,
    assertUserCanGenerate: jest.fn().mockResolvedValue(AI_USAGE),
  };
  const freeTierService = {
    available: true,
    getAccountTier: jest.fn().mockResolvedValue(FREE_TIER),
  };
  const makeApp = (service, usageService = allowUsageService, tierService = freeTierService) => {
    const app = express();
    const ensureAccountAccess = createAccountAccessGuard({ service, tierService, usageService });
    app.get('/api/protected-ai', async (req, res) => {
      if (!(await ensureAccountAccess(req, res))) return;
      return res.json({ user: req.accountUser, accountTier: req.accountTier });
    });
    return app;
  };

  test('requires a current account session before AI work can run', async () => {
    const getUserForSession = jest.fn().mockResolvedValue(null);
    const response = await request(makeApp({ available: true, getUserForSession }))
      .get('/api/protected-ai');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Sign in or create an account to use AI features.',
      code: 'ACCOUNT_REQUIRED',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(getUserForSession).toHaveBeenCalledWith(null);
  });

  test('allows AI work for a valid session and exposes the account to the route', async () => {
    const user = { id: USER_ROW.id, email: USER_ROW.email };
    const getUserForSession = jest.fn().mockResolvedValue(user);
    const response = await request(makeApp({ available: true, getUserForSession }))
      .get('/api/protected-ai')
      .set('Cookie', 'bc_session=valid-session-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user, accountTier: FREE_TIER });
    expect(getUserForSession).toHaveBeenCalledWith('valid-session-token');
    expect(allowUsageService.assertUserCanGenerate).toHaveBeenCalledWith(USER_ROW.id, 'free');
  });

  test('uses the Premium allowance when an account has a current subscription', async () => {
    const user = { id: USER_ROW.id, email: USER_ROW.email };
    const premiumTier = { ...FREE_TIER, key: 'premium', label: 'Premium' };
    const assertUserCanGenerate = jest.fn().mockResolvedValue({ ...AI_USAGE, tierKey: 'premium' });
    const response = await request(makeApp(
      { available: true, getUserForSession: jest.fn().mockResolvedValue(user) },
      { available: true, assertUserCanGenerate },
      { available: true, getAccountTier: jest.fn().mockResolvedValue(premiumTier) },
    ))
      .get('/api/protected-ai')
      .set('Cookie', 'bc_session=valid-session-token');

    expect(response.status).toBe(200);
    expect(response.body.accountTier).toEqual(premiumTier);
    expect(assertUserCanGenerate).toHaveBeenCalledWith(USER_ROW.id, 'premium');
  });

  test('fails closed when account storage cannot verify sessions', async () => {
    const response = await request(makeApp({ available: false })).get('/api/protected-ai');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ACCOUNT_SERVICE_UNAVAILABLE');
  });

  test('blocks AI work when the account has exhausted its monthly allowance', async () => {
    const usage = { ...AI_USAGE, usedTokens: 250000, remainingTokens: 0, percentUsed: 100, exhausted: true };
    const limitError = Object.assign(new Error('Monthly AI usage limit reached.'), {
      code: 'AI_USAGE_LIMIT_REACHED',
      statusCode: 429,
      usage,
    });
    const response = await request(makeApp(
      { available: true, getUserForSession: jest.fn().mockResolvedValue({ id: USER_ROW.id }) },
      { available: true, assertUserCanGenerate: jest.fn().mockRejectedValue(limitError) },
    ))
      .get('/api/protected-ai')
      .set('Cookie', 'bc_session=valid-session-token');

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: 'Monthly AI usage limit reached.',
      code: 'AI_USAGE_LIMIT_REACHED',
      aiUsage: usage,
    });
  });
});
