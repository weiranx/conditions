import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
const bootstrap = new JSDOM('<html><body></body></html>');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const { createRoot } = await import('react-dom/client');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
import { ChatGPTPlan } from '../src/field/ChatGPTPlan';

test('browser-only ChatGPT setup can sign in, cancel, choose a model, and disconnect', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example.com/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, CustomEvent: globalThis.CustomEvent };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  let connection = { enabled: true, connected: false };
  dom.window.open = () => null;
  const signIn = { id: 'attempt-id', authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?state=test', expiresAt: Date.now() + 600000 };
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), dom.window.location.origin).pathname;
    requests.push({ pathname, ...init });
    let payload;
    if (pathname === '/api/account/chatgpt') payload = connection;
    else if (pathname.endsWith('/signin/start')) payload = { signIn };
    else if (pathname.endsWith('/signin/cancel')) payload = { canceled: true };
    else if (pathname.endsWith('/signin/complete')) payload = connection = { enabled: true, connected: true, state: 'connected', email: 'me@example.com', model: null };
    else if (pathname === '/api/healthz') payload = { ai: { available: true, billingSource: connection.connected ? 'chatgpt' : 'api' } };
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
  assert.ok(!document.body.textContent.includes('npm run'));
  await press('Continue with ChatGPT');
  assert.ok(document.querySelector('a[href="' + signIn.authorizationUrl + '"]'));
  await press('Cancel sign-in');
  assert.equal(document.querySelector('textarea'), null);
  await press('Continue with ChatGPT');
  const callbackUrl = 'http://127.0.0.1:1455/auth/callback?code=private-code&state=test&client_id=oaiapp_test';
  await act(async () => {
    const input = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, callbackUrl);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await press('Finish sign-in');
  const completed = requests.filter((request) => request.pathname.endsWith('/signin/complete'));
  assert.equal(completed.length, 1);
  assert.deepEqual(JSON.parse(completed[0].body), { signInId: signIn.id, callbackUrl });
  assert.equal(document.querySelector('textarea'), null);
  assert.ok(!JSON.stringify(localStorage).includes('private-code'));
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
  const availability = [];
  dom.window.addEventListener('summitsafe:ai-availability-change', (event) => availability.push(event.detail));
  await press('Disconnect ChatGPT');
  assert.ok(document.body.textContent.includes('Remote revocation was not confirmed'));
  assert.equal(requests.filter((request) => request.pathname.endsWith('/disconnect')).length, 1);
  // Disconnecting hands AI back to the server's providers instead of switching it off.
  // The ChatGPT state is withdrawn before the check, which then publishes the server's answer.
  assert.equal(requests.at(-1).pathname, '/api/healthz');
  assert.equal(availability.length, 2);
  assert.ok(Object.values(availability[0]).every((available) => available === false));
  assert.ok(Object.values(availability[1]).some(Boolean));
  assert.ok(document.querySelector('a[href="https://chatgpt.com/settings/usage"]'));
});

test('a failed availability check after disconnecting does not report the disconnect as failed', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example.com/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch, CustomEvent: globalThis.CustomEvent };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.setItem('conditions:chatgpt-welcome:conditions-owner-id', 'seen');
  let connection = { enabled: true, connected: true, state: 'connected', email: 'me@example.com', model: 'account-model' };
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url), dom.window.location.origin).pathname;
    if (pathname === '/api/healthz') throw new TypeError('Failed to fetch');
    let payload;
    if (pathname === '/api/account/chatgpt') payload = connection;
    else if (pathname === '/api/account/chatgpt/disconnect') payload = connection = { enabled: true, connected: false, state: 'disconnected', revoked: true, message: 'Disconnected ChatGPT.' };
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
  await act(async () => root.render(<ChatGPTPlan userId="conditions-owner-id" />));
  const availability = [];
  dom.window.addEventListener('summitsafe:ai-availability-change', (event) => availability.push(event.detail));
  await act(async () => [...document.querySelectorAll('button')].find((element) => element.textContent === 'Disconnect ChatGPT').click());
  assert.ok(document.body.textContent.includes('Disconnected ChatGPT.'));
  assert.equal(document.querySelector('[role="alert"]'), null);
  // Until the server answers, AI waits for the next poll instead of claiming the ChatGPT plan.
  assert.equal(availability.length, 1);
  assert.ok(Object.values(availability[0]).every((available) => available === false));
});
