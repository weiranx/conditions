import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const { createRoot } = await import('react-dom/client');
const { Chat } = await import('../src/field/Chat');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
import { AiAccessContext } from '../src/contexts/ai-access';

async function mount(t, props = {}, allowed = true) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const proto = dom.window.HTMLDialogElement.prototype;
  proto.showModal = function () { this.setAttribute('open', ''); this.dataset.modal = 'true'; };
  proto.close = function () { this.removeAttribute('open'); delete this.dataset.modal; };
  const root = createRoot(document.getElementById('root'));
  const render = async (next = props) => act(async () => root.render(<StrictMode><AiAccessContext.Provider value={{ requestAiAccess: () => allowed }}><Chat reportPayload='{"objective":"Rainier"}' {...next} /></AiAccessContext.Provider></StrictMode>));
  await render();
  const unmount = async () => act(async () => root.unmount());
  t.after(async () => { await unmount(); dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
  return { dom, render, unmount, click: async label => act(async () => document.querySelector(`button[aria-label="${label}"]`).click()) };
}

test('full screen preserves the composer node, scroll, and returns focus on Escape', async t => {
  const h = await mount(t);
  const composer = document.querySelector('textarea');
  const messages = document.querySelector('.field-chat-messages');
  await act(async () => {
    Object.getOwnPropertyDescriptor(h.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(composer, 'A draft still being written');
    composer.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
  });
  messages.scrollTop = 125;
  await h.click('Open chat full screen');
  assert.equal(document.querySelector('textarea'), composer);
  assert.equal(composer.value, 'A draft still being written');
  assert.equal(document.querySelector('dialog').dataset.modal, 'true');
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Exit full screen');
  assert.equal(messages.scrollTop, 125);
  messages.scrollTop = 230;
  await act(async () => document.querySelector('dialog').dispatchEvent(new h.dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.querySelector('dialog').dataset.modal, undefined);
  assert.equal(document.querySelector('textarea'), composer);
  assert.equal(messages.scrollTop, 230);
  assert.equal(document.body.style.overflow, '');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Open chat full screen');
});

test('saved conversations expand without AI access and never show a composer', async t => {
  const h = await mount(t, { readOnly: true, initialMessages: [{ id: 'saved', role: 'user', parts: [{ type: 'text', text: 'Saved question' }] }] }, false);
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.querySelector('textarea'), null);
  await h.click('Open chat full screen');
  assert.equal(document.querySelector('dialog').dataset.modal, 'true');
  assert.match(document.querySelector('dialog').textContent, /Saved question/);
});

test('access gate prevents expansion and unmount restores the existing body overflow', async t => {
  const h = await mount(t, {}, false);
  await h.click('Open chat full screen');
  assert.equal(document.querySelector('dialog').open, false);
  await h.render({ readOnly: true });
  document.body.style.overflow = 'clip';
  await h.click('Open chat full screen');
  assert.equal(document.body.style.overflow, 'hidden');
  await h.unmount();
  assert.equal(document.body.style.overflow, 'clip');
});

test('latest message scrolls only the conversation region', async t => {
  const h = await mount(t, { initialMessages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Question' }] }] });
  const region = document.querySelector('.field-chat-messages');
  Object.defineProperty(region, 'scrollHeight', { value: 2000 });
  let pageScrolled = false;
  h.dom.window.HTMLElement.prototype.scrollIntoView = () => { pageScrolled = true; };
  await act(async () => document.querySelector('.field-chat-latest').click());
  assert.equal(region.scrollTop, 2000);
  assert.equal(pageScrolled, false);
});

test('retry keeps one user question and sends the same report context', async t => {
  const h = await mount(t, { contextType: 'trip' });
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return new Response('Temporarily unavailable', { status: 503 });
    const chunks = [
      { type: 'start', messageId: 'answer' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Compare the conditions for each day.' },
      { type: 'text-end', id: 'text' },
      { type: 'finish' },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
    });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  await h.click('Open chat full screen');
  await act(async () => document.querySelector('.field-chat-suggestions button').click());
  assert.ok(document.querySelector('[role="alert"]'));
  await act(async () => document.querySelector('.field-chat-error button').click());
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.report, '{"objective":"Rainier"}');
    assert.equal(request.contextType, 'trip');
    assert.equal(request.messages.filter(message => message.role === 'user').length, 1);
  }
  assert.equal(document.querySelectorAll('.is-user').length, 1);
  assert.match(document.querySelector('.is-assistant').textContent, /Compare the conditions/);
  assert.equal(document.querySelector('[role="alert"]'), null);
});
