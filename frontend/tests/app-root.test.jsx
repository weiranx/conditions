// @env production
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '../src/AppRoot';

async function mount(t, tree) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, CustomEvent: globalThis.CustomEvent };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(String(url), 'https://conditions.example').pathname);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(tree));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { requests };
}

// A screen whose code is still downloading.
const Downloading = lazy(() => new Promise(() => {}));

test('the planner asks for feature flags and the session while its code is still downloading', async (t) => {
  const { requests } = await mount(t, <AppRoot landing={false}><Downloading /></AppRoot>);

  assert.match(document.body.textContent, /Loading Backcountry Conditions/);
  assert.equal(document.querySelector('.loading-state').getAttribute('role'), 'status');
  assert.ok(requests.includes('/api/feature-flags'), 'feature flags are requested at once');
  assert.ok(requests.includes('/api/auth/session'), 'the session is requested at once');
  assert.ok(requests.includes('/api/auth/google/config'), 'the sign-in configuration is requested at once');
});

test('the landing page sends no account or feature flag requests', async (t) => {
  const { requests } = await mount(t, <AppRoot landing><Downloading /></AppRoot>);

  assert.match(document.body.textContent, /Loading Backcountry Conditions/);
  assert.deepEqual(requests, []);
});

test('a screen that has loaded renders inside the providers', async (t) => {
  const Ready = lazy(() => Promise.resolve({ default: () => <p id="screen">planner</p> }));
  await mount(t, <AppRoot landing={false}><Ready /></AppRoot>);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(document.getElementById('screen')?.textContent, 'planner');
  assert.equal(document.querySelector('.loading-state'), null);
});
