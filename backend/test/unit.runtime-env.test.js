const {
  createRuntimeEnvService,
  normalizeRuntimeEnvValue,
  RUNTIME_ENV_DEFINITIONS,
} = require('../src/utils/runtime-env');

const definition = (key) => RUNTIME_ENV_DEFINITIONS.find((entry) => entry.key === key);

test('exposes allowlisted values while redacting credentials', () => {
  const service = createRuntimeEnvService({
    env: {},
    filePath: '/tmp/runtime-env-test.json',
    baseValues: {
      REQUEST_TIMEOUT_MS: '9000',
      OPENAI_API_KEY: 'deployment-secret',
      GEMINI_API_KEY: 'gemini-deployment-secret',
      OBJECTIVE_WATCH_CRON_SECRET: 'cron-secret',
    },
    initialOverrides: {},
  });

  const status = service.getStatus();
  expect(status.restartRequired).toBe(true);
  expect(status.entries.find((entry) => entry.key === 'REQUEST_TIMEOUT_MS')).toMatchObject({
    value: '9000',
    configured: true,
    source: 'deployment environment',
    overridden: false,
  });
  expect(status.entries.find((entry) => entry.key === 'OPENAI_API_KEY')).toMatchObject({
    value: null,
    configured: true,
    secret: true,
  });
  expect(status.entries.find((entry) => entry.key === 'GEMINI_API_KEY')).toMatchObject({
    value: null,
    configured: true,
    secret: true,
  });
  expect(status.entries.find((entry) => entry.key === 'OBJECTIVE_WATCH_CRON_SECRET')).toMatchObject({
    value: null,
    configured: true,
    secret: true,
    editable: false,
    source: 'deployment environment',
  });
  expect(JSON.stringify(status)).not.toContain('deployment-secret');
  expect(JSON.stringify(status)).not.toContain('gemini-deployment-secret');
  expect(JSON.stringify(status)).not.toContain('cron-secret');
});

test('persists validated overrides and resets them to deployment values', async () => {
  const env = { REQUEST_TIMEOUT_MS: '9000' };
  const writes = [];
  const fileSystem = {
    mkdir: jest.fn(async () => {}),
    writeFile: jest.fn(async (_path, content) => writes.push(content)),
    rename: jest.fn(async () => {}),
  };
  const service = createRuntimeEnvService({
    env,
    filePath: '/tmp/runtime-env-test.json',
    baseValues: { REQUEST_TIMEOUT_MS: '9000', OPENAI_API_KEY: null },
    initialOverrides: {},
    fileSystem,
  });

  let status = await service.update({ REQUEST_TIMEOUT_MS: '12000', OPENAI_API_KEY: 'new-secret' });
  expect(env.REQUEST_TIMEOUT_MS).toBe('12000');
  expect(env.OPENAI_API_KEY).toBe('new-secret');
  expect(status.entries.find((entry) => entry.key === 'OPENAI_API_KEY').value).toBeNull();
  expect(writes.at(-1)).toContain('new-secret');

  status = await service.update({ REQUEST_TIMEOUT_MS: null });
  expect(env.REQUEST_TIMEOUT_MS).toBe('9000');
  expect(status.entries.find((entry) => entry.key === 'REQUEST_TIMEOUT_MS')).toMatchObject({
    value: '9000',
    overridden: false,
  });
});

test('rejects invalid and non-allowlisted values', async () => {
  expect(() => normalizeRuntimeEnvValue(definition('RATE_LIMIT_MAX_REQUESTS'), '0')).toThrow('between 1 and 100000');
  const service = createRuntimeEnvService({
    env: {},
    filePath: '/tmp/runtime-env-test.json',
    baseValues: {},
    initialOverrides: {},
  });
  await expect(service.update({ DATABASE_URL: 'postgres://secret' })).rejects.toMatchObject({
    code: 'INVALID_RUNTIME_ENV',
  });
  await expect(service.update({ OBJECTIVE_WATCH_CRON_SECRET: 'replacement' })).rejects.toThrow(
    'Environment variable is deployment-managed: OBJECTIVE_WATCH_CRON_SECRET.',
  );
});

test('ignores deployment-managed credentials in persisted overrides', () => {
  const service = createRuntimeEnvService({
    env: {},
    filePath: '/tmp/runtime-env-test.json',
    baseValues: { OBJECTIVE_WATCH_CRON_SECRET: null },
    initialOverrides: { OBJECTIVE_WATCH_CRON_SECRET: 'stale-override' },
  });

  const status = service.getStatus();
  expect(status.entries.find((entry) => entry.key === 'OBJECTIVE_WATCH_CRON_SECRET')).toMatchObject({
    configured: false,
    overridden: false,
    editable: false,
  });
});
