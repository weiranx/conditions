// @env production
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchApi, fetchApiStream, NetworkUnavailableError } from '../src/lib/api-client';

// A stand-in browser: the navigator says whether there is a network, and fetch does what the test says.
function browser(t, { onLine, fetch }) {
  const previous = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), fetch: globalThis.fetch };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine } });
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return fetch(...args);
  };
  t.after(() => {
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
    globalThis.fetch = previous.fetch;
  });
  return calls;
}
// What a browser does when no response arrives: "Failed to fetch" in Chrome, "Load failed" in Safari.
const noConnection = () => Promise.reject(new TypeError('Failed to fetch'));

test('with no network at all a request fails at once, in plain words, without waiting on retries', async (t) => {
  const calls = browser(t, { onLine: false, fetch: noConnection });
  await assert.rejects(fetchApi('/api/safety'), (error) => {
    assert.ok(error instanceof NetworkUnavailableError);
    assert.match(error.message, /offline/i);
    assert.match(error.message, /needs a connection/i);
    return true;
  });
  assert.equal(calls.length, 0, 'nothing is sent, so nothing is waited on');
});

test('a server that cannot be reached reads as a connection problem, not as "Failed to fetch"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = browser(t, { onLine: true, fetch: noConnection });
  const request = fetchApi('/api/safety').then(() => null, (error) => error);
  // Two retries, one and two seconds apart, before it gives up.
  for (const wait of [1000, 2000]) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(wait);
  }
  const error = await request;
  assert.ok(error instanceof NetworkUnavailableError);
  assert.match(error.message, /can't reach the server/i);
  assert.doesNotMatch(error.message, /failed to fetch/i);
  assert.equal(calls.length, 3, 'a flaky signal still gets its retries');
});

test('a streaming request reports a lost connection the same way', async (t) => {
  browser(t, { onLine: true, fetch: noConnection });
  await assert.rejects(fetchApiStream('/api/route-analysis', {}, () => {}), (error) => {
    assert.ok(error instanceof NetworkUnavailableError);
    assert.match(error.message, /can't reach the server/i);
    return true;
  });
});

test('an answer from the server, even an error, is a response and not a connection problem', async (t) => {
  browser(t, {
    onLine: true,
    fetch: async () => new Response(JSON.stringify({ error: 'Bad plan' }), { status: 400, headers: { 'content-type': 'application/json' } }),
  });
  const { response, payload } = await fetchApi('/api/safety');
  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'Bad plan' });
});
