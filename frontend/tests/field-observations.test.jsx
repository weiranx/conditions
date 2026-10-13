import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { FieldObservations } = await import('../src/field/FieldObservations');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;
import { AiAccessContext } from '../src/contexts/ai-access';

const objective = { name: 'Mount Baldy', lat: 34.29, lon: -117.65, elevationFt: 10064 };
const observations = [
  {
    observedDate: '2026-10-03', ageDays: 10, stale: false, location: 'Baldy Bowl', elevationFt: 8000, aspect: 'N',
    surface: 'firm-snow', snowlineFt: 8000, hazards: ['postholing'], quote: 'Firm snow on the north side of the bowl.', confidence: 'high',
  },
  {
    observedDate: '2026-08-20', ageDays: 54, stale: true, location: 'Ski hut trail', elevationFt: null, aspect: null,
    surface: 'dry-trail', snowlineFt: null, hazards: [], quote: 'The trail to the hut was dry.', confidence: 'medium',
  },
];

async function mount(t, props = {}, { allowed = true, respond } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    const [status, payload] = respond ? respond() : [200, { observations, plannedDate: '2026-10-13', generatedAt: '2026-10-13T00:00:00Z' }];
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(
    <AiAccessContext.Provider value={{ requestAiAccess: () => allowed }}>
      <FieldObservations objective={objective} date="2026-10-13" available formatElevation={(ft) => `${ft} ft`} {...props} />
    </AiAccessContext.Provider>,
  ));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const type = async (value) => act(async () => {
    const area = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, value);
    area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = async () => act(async () => {
    document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  return { requests, type, submit };
}

test('extracts pasted text into dated observations with quotes, dimming stale ones', async (t) => {
  const h = await mount(t);
  assert.ok(document.querySelector('label').textContent.includes('Paste a trip report or what you saw'));
  const button = document.querySelector('button[type="submit"]');
  assert.equal(button.disabled, true);
  await h.type('Firm snow on the north side of the bowl. The trail to the hut was dry.');
  await h.submit();

  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /\/api\/field-observations\/extract$/);
  assert.deepEqual(h.requests[0].body.objective, objective);
  assert.equal(h.requests[0].body.date, '2026-10-13');

  const items = document.querySelectorAll('.field-observation');
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /2026-10-03 · 10 days before/);
  assert.match(items[0].textContent, /Firm snow · Baldy Bowl · 8000 ft · N aspect · snowline 8000 ft/);
  assert.equal(items[0].querySelector('blockquote').textContent, 'Firm snow on the north side of the bowl.');
  assert.match(items[0].querySelector('.field-observation-hazards').textContent, /postholing/);
  assert.equal(items[0].classList.contains('is-stale'), false);
  assert.equal(items[1].classList.contains('is-stale'), true);
  assert.match(items[1].textContent, /Old/);
});

test('hides the extract form when the feature is unavailable', async (t) => {
  await mount(t, { available: false });
  assert.equal(document.querySelector('textarea'), null);
  assert.equal(document.querySelector('button'), null);
});

test('asks for an account before extracting', async (t) => {
  const blocked = await mount(t, {}, { allowed: false });
  await blocked.type('Dry trail all the way up.');
  await blocked.submit();
  assert.equal(blocked.requests.length, 0);
});

test('shows the server error when extraction fails', async (t) => {
  // Another date, so the observations stored by the first test don't show.
  const h = await mount(t, { date: '2026-10-20' }, { respond: () => [413, { error: 'Keep the text under 12,000 characters.' }] });
  await h.type('Dry trail all the way up.');
  await h.submit();
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Keep the text under 12,000 characters.');
  assert.equal(document.querySelectorAll('.field-observation').length, 0);
});
