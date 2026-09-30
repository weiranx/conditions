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

// An NDJSON answer that delivers its first lines and then, unless it is given no failure, breaks off.
function ndjsonAnswer(lines, failure) {
  const encoder = new TextEncoder();
  let sent = false;
  return new Response(new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(`${lines.join('\n')}\n`));
        return;
      }
      if (failure) throw failure;
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

test('a connection that drops while the answer is streaming reads as a connection problem too', async (t) => {
  browser(t, { onLine: true, fetch: async () => ndjsonAnswer(['{"type":"progress","step":1}'], new TypeError('network error')) });
  const events = [];
  await assert.rejects(fetchApiStream('/api/route-analysis', {}, (event) => events.push(event)), (error) => {
    assert.ok(error instanceof NetworkUnavailableError);
    assert.match(error.message, /can't reach the server/i);
    return true;
  });
  assert.deepEqual(events, [{ type: 'progress', step: 1 }], 'what arrived before the drop was still delivered');
});

test('a body that breaks off while it is read is a connection problem, not a raw browser error', async (t) => {
  browser(t, {
    onLine: true,
    fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network error')); } }),
      { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(fetchApiStream('/api/route-analysis', {}, () => {}), (error) => error instanceof NetworkUnavailableError);
});

test('a stream that finishes normally is untouched, and a bug in our own callback is not mistaken for a lost signal', async (t) => {
  browser(t, { onLine: true, fetch: async () => ndjsonAnswer(['{"type":"progress"}', '{"type":"result","payload":{"ok":true}}']) });
  const done = await fetchApiStream('/api/route-analysis', {}, () => {});
  assert.deepEqual(done, { ok: true, status: 200, payload: { ok: true } });

  browser(t, { onLine: true, fetch: async () => ndjsonAnswer(['{"type":"progress"}', '{"type":"result","payload":{}}']) });
  await assert.rejects(
    fetchApiStream('/api/route-analysis', {}, () => { throw new TypeError('our own bug'); }),
    (error) => error instanceof TypeError && !(error instanceof NetworkUnavailableError) && /our own bug/.test(error.message),
  );
});
