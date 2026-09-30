'use strict';

jest.mock('../src/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { createCircuitBreaker, withCircuitBreaker } = require('../src/utils/http-client');

const fail = () => withCircuitBreaker(breaker, async () => { throw new Error('upstream down'); }).catch(() => null);
let breaker;

beforeEach(() => {
  breaker = createCircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeMs: 60000 });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('withCircuitBreaker', () => {
  test('opens after consecutive failures and then skips the call', async () => {
    for (let i = 0; i < 3; i += 1) await fail();
    expect(breaker.isOpen).toBe(true);

    const fn = jest.fn(async () => 'ok');
    await expect(withCircuitBreaker(breaker, fn)).rejects.toThrow(/test circuit breaker open/);
    expect(fn).not.toHaveBeenCalled();
  });

  test('a success ends the failure streak', async () => {
    await fail();
    await fail();
    await withCircuitBreaker(breaker, async () => 'ok');
    await fail();
    await fail();
    expect(breaker.isOpen).toBe(false);
  });

  test('closes again once the cool-down has passed', async () => {
    for (let i = 0; i < 3; i += 1) await fail();
    jest.advanceTimersByTime(60001);
    expect(breaker.isOpen).toBe(false);
    await expect(withCircuitBreaker(breaker, async () => 'ok')).resolves.toBe('ok');
  });

  test('an upstream that refuses one request is up, so refusals never open the breaker', async () => {
    const refuse = () => withCircuitBreaker(breaker, async () => {
      throw Object.assign(new Error('outside coverage'), { upstreamRefusedRequest: true });
    }).catch((error) => error.message);

    for (let i = 0; i < 10; i += 1) expect(await refuse()).toBe('outside coverage');
    expect(breaker.isOpen).toBe(false);

    // The refusals also break a streak of real failures.
    await fail();
    await fail();
    await refuse();
    await fail();
    await fail();
    expect(breaker.isOpen).toBe(false);
  });

  test('the error is still thrown to the caller when it is a refusal', async () => {
    const error = Object.assign(new Error('nope'), { upstreamRefusedRequest: true });
    await expect(withCircuitBreaker(breaker, async () => { throw error; })).rejects.toBe(error);
  });
});
