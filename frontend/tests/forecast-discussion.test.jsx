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
const { ForecastDiscussion } = await import('../src/field/ForecastDiscussion');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;
import { AiAccessContext } from '../src/contexts/ai-access';

const units = { temperature: 'f', wind: 'mph', elevation: 'ft' };
// Each test uses its own place: summaries are kept for the session per place.
const report = (lat, discussion = {}) => ({
  location: { lat, lon: -119.53 },
  forecast: { selectedDate: '2026-10-16', selectedStartTime: '2026-10-16T06:00:00-07:00' },
  weather: { description: 'Snow showers', temp: 28 },
  supplementalEvidence: {
    discussion: {
      source: 'NWS Area Forecast Discussion', kind: 'regional_context', available: true, status: 'ok', office: 'REV',
      issuedTime: '2026-10-14T21:01:00Z', sourceLink: 'https://forecast.weather.gov/product.php?site=NWS&issuedby=REV&product=AFD',
      sections: [{ title: 'LONG TERM', kind: 'period', matchesTrip: true, text: 'Snow showers above 7000 feet.' }],
      ...discussion,
    },
  },
});
const summary = {
  summary: 'A trough brings cooler air with snow showers Friday.',
  forObjective: 'Your Friday trip falls in the snowy period.',
  watch: ['Snow levels near 7000 ft.'],
  forecasterConfidence: 'moderate',
  coversTripDate: true,
  office: 'REV',
  issuedTime: '2026-10-14T21:01:00Z',
  generatedAt: '2026-10-15T00:00:00Z',
};

async function mount(t, props, { allowed = true, respond } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    const [status, payload] = respond ? respond() : [200, summary];
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const root = createRoot(document.getElementById('root'));
  const render = (next) => act(async () => root.render(
    <AiAccessContext.Provider value={{ requestAiAccess: () => allowed, aiEnabled: true }}>
      <ForecastDiscussion objectiveName="Half Dome" units={units} available {...next} />
    </AiAccessContext.Provider>,
  ));
  await render(props);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const click = async () => act(async () => {
    document.querySelector('.ai-brief-empty button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  return { requests, click, render };
}

test('summarizes the discussion for the plan on request', async (t) => {
  const data = report(37.1);
  const h = await mount(t, { report: data });
  assert.match(document.querySelector('.forecast-discussion-meta').textContent, /NWS REV Area Forecast Discussion · issued/);
  assert.equal(document.querySelector('.forecast-discussion-body'), null);
  await h.click();

  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /\/api\/forecast-discussion\/summary$/);
  assert.equal(h.requests[0].body.objectiveName, 'Half Dome');
  assert.deepEqual(h.requests[0].body.units, units);
  assert.equal(h.requests[0].body.report.supplementalEvidence.discussion.office, 'REV');

  const body = document.querySelector('.forecast-discussion-body').textContent;
  assert.match(body, /The regional picture.*A trough brings cooler air/);
  assert.match(body, /For Half Dome.*Your Friday trip/);
  assert.match(body, /Watch for.*Snow levels near 7000 ft\./);
  const chips = [...document.querySelectorAll('.forecast-discussion-meta .sky-chip')].map((chip) => chip.textContent);
  assert.deepEqual(chips, ['Covers your date', 'Moderate forecaster confidence']);
  assert.equal(document.querySelector('.field-source-link').textContent, 'Read the full discussion');
  assert.equal(document.querySelector('.ai-brief-empty'), null);
});

test('keeps the summary when shown again, and asks again for a newer discussion', async (t) => {
  const h = await mount(t, { report: report(37.2) });
  await h.click();
  await h.render({ report: report(37.2) });
  assert.ok(document.querySelector('.forecast-discussion-body'));
  assert.equal(h.requests.length, 1);

  await h.render({ report: report(37.2, { issuedTime: '2026-10-15T09:00:00Z' }) });
  assert.equal(document.querySelector('.forecast-discussion-body'), null);
  assert.ok(document.querySelector('.ai-brief-empty button'));
});

test('shows the server error and keeps the button', async (t) => {
  const h = await mount(t, { report: report(37.3) }, { respond: () => [503, { error: 'Could not summarize the forecast discussion right now.' }] });
  await h.click();
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Could not summarize the forecast discussion right now.');
  assert.ok(document.querySelector('.ai-brief-empty button'));
});

test('asks for an account before calling the AI', async (t) => {
  const h = await mount(t, { report: report(37.4) }, { allowed: false });
  await h.click();
  assert.equal(h.requests.length, 0);
});

test('renders nothing without a discussion', async (t) => {
  await mount(t, { report: report(37.5, { available: false }) });
  assert.equal(document.querySelector('.forecast-discussion'), null);
});

test('renders nothing when AI is unavailable', async (t) => {
  const h = await mount(t, { report: report(37.6), available: false });
  assert.equal(document.querySelector('.forecast-discussion'), null);
  assert.equal(h.requests.length, 0);
});
