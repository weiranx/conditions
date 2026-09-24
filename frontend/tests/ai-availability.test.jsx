import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { publishAiAvailability, useAiAvailability } from '../src/hooks/useAiAvailability';

const health = { ai: { available: true, features: { reportChat: { available: false } } } };

async function mount(t, consumers) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, CustomEvent: globalThis.CustomEvent };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let visibility = 'visible';
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
  const polls = new Set();
  dom.window.setInterval = (poll) => { polls.add(poll); return poll; };
  dom.window.clearInterval = (poll) => { polls.delete(poll); };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify(health), { status: 200 });
  };
  const seen = [];
  function Consumer({ index }) {
    seen[index] = useAiAvailability({ ai: false });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(Array.from({ length: consumers }, (_, index) => <Consumer key={index} index={index} />)));
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
  };
  t.after(async () => {
    await unmount();
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return {
    requests,
    seen,
    unmount,
    tick: async () => act(async () => polls.forEach((poll) => poll())),
    show: async (state) => act(async () => {
      visibility = state;
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    }),
  };
}

test('report sections share one AI availability poll', async (t) => {
  const h = await mount(t, 3);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.seen, Array(3).fill({ aiBrief: true, reportChat: false, routeAnalysis: true, snowVision: true }));
  await h.tick();
  assert.equal(h.requests.length, 2);
});

test('a hidden tab skips availability polls and refreshes when shown', async (t) => {
  const h = await mount(t, 1);
  await h.show('hidden');
  await h.tick();
  assert.equal(h.requests.length, 1);
  await h.show('visible');
  assert.equal(h.requests.length, 2);
});

test('published AI settings reach mounted consumers, and polling stops with the last one', async (t) => {
  const h = await mount(t, 2);
  await act(async () => publishAiAvailability({ available: false }));
  assert.deepEqual(h.seen, Array(2).fill({ aiBrief: false, reportChat: false, routeAnalysis: false, snowVision: false }));
  await h.unmount();
  await h.tick();
  assert.equal(h.requests.length, 1);
});
