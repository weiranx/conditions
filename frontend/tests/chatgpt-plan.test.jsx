import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatGPTPlan } from '../src/field/ChatGPTPlan';

test('personal ChatGPT setup can refresh, select an account model, and disconnect once', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example.com/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, CustomEvent: globalThis.CustomEvent };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  let connection = { enabled: false };
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), dom.window.location.origin).pathname;
    requests.push({ pathname, ...init });
    let payload;
    if (pathname === '/api/account/chatgpt') payload = connection;
    else if (pathname === '/api/healthz') payload = { ai: { available: true, billingSource: 'chatgpt' } };
    else if (pathname === '/api/account/chatgpt/models') payload = { models: [{ id: 'account-model', name: 'My model' }] };
    else if (pathname === '/api/account/chatgpt/model') payload = connection = { ...connection, model: JSON.parse(init.body).model };
    else if (pathname === '/api/account/chatgpt/disconnect') payload = connection = { enabled: true, connected: false, state: 'disconnected', revoked: false, message: 'Disconnected locally. Remote revocation was not confirmed.' };
    else throw new Error(`Unexpected request: ${pathname}`);
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const press = (text) => act(async () => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent === text);
    assert.ok(button, `Missing button: ${text}`);
    button.click();
  });
  await act(async () => root.render(<ChatGPTPlan userId="conditions-owner-id" />));
  assert.ok(document.body.textContent.includes('conditions-owner-id'));
  connection = { enabled: true, connected: true, state: 'connected', email: 'me@example.com', model: null };
  await press('Refresh connection');
  assert.ok(document.body.textContent.includes('You’re using your ChatGPT plan'));
  await press('Got it');
  assert.equal(localStorage.getItem('conditions:chatgpt-welcome:conditions-owner-id'), 'seen');
  await press('Load available models');
  await act(async () => {
    const select = document.querySelector('select');
    select.value = 'account-model';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.equal(connection.model, 'account-model');
  await press('Disconnect ChatGPT');
  assert.ok(document.body.textContent.includes('Remote revocation was not confirmed'));
  assert.equal(requests.filter((request) => request.pathname.endsWith('/disconnect')).length, 1);
  assert.ok(document.querySelector('a[href="https://chatgpt.com/settings/usage"]'));
});
