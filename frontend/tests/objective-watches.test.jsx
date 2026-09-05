import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/contexts/account';
import { Library } from '../src/field/Library';
import { watchHasEnded, watchRefreshWait } from '../src/field/watch-status';

const policy = { tierKey: 'premium', activeWatchLimit: 10, automaticChecks: true,
  emailAlerts: true, historyDays: 90, manualRefreshCooldownMinutes: 5,
  schedulerEnabled: true, checkIntervalMinutes: 180 };
const checkedAt = new Date(Date.now() - 3600000).toISOString();
const check = (status = 'unchanged') => ({ id: 'check-1', checkType: 'manual', status,
  summary: { score: 72, maxWindGust: 25 }, checkedAt, change: null, error: null });
const watch = (id, overrides = {}) => ({ id, title: id, plan: { forecastDate: '2099-09-06',
  alpineStartTime: '05:30', travelWindowHours: 12, lat: 46.85, lon: -121.76 },
  createdAt: checkedAt, updatedAt: checkedAt, lastAttemptedAt: checkedAt,
  lastCheckedAt: checkedAt, nextCheckAt: '2099-09-05T12:00:00Z',
  lastChange: null, consecutiveFailures: 0, notificationsEnabled: false,
  latestCheck: check(), ...overrides });
async function setup(t, handler) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (url, init) => {
    const result = await handler(String(url), init);
    return new Response(JSON.stringify(result.payload), { status: result.status || 200 });
  };
  const root = createRoot(document.getElementById('root'));
  const noop = () => {};
  await act(async () => root.render(<AccountContext.Provider value={{ user: { id: 'user', emailVerified: true } }}>
    <Library kind="watches" localReport={null} onOpen={noop} navigate={noop}
      workspace={{ featureFlags: {}, handleOpenObjectiveWatch: noop }} />
  </AccountContext.Provider>));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return {
    text: () => document.body.textContent,
    cards: () => [...document.querySelectorAll('.field-watch-card h2')].map(el => el.textContent),
    click: async (label) => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent.startsWith(label));
      assert.ok(button, `Missing button ${label}`);
      await act(async () => button.click());
    },
  };
}

test('failed watch loading shows recovery instead of a misleading empty state', async t => {
  let fails = true;
  const h = await setup(t, () => fails
    ? { status: 500, payload: { error: 'Watches unavailable' } }
    : { payload: { watches: [watch('Rainier')], policy } });
  assert.match(h.text(), /Watches unavailable/);
  assert.doesNotMatch(h.text(), /No watched objectives yet/);
  fails = false;
  await h.click('Retry loading plans');
  assert.deepEqual(h.cards(), ['Rainier']);
  assert.doesNotMatch(h.text(), /Watches unavailable/);
});

test('active and attention filters include partial, failed and overdue checks; completed plans remain accessible', async t => {
  const watches = [watch('Clear'), watch('Partial', { latestCheck: check('partial') }),
    watch('Failed', { latestCheck: check('failed'), consecutiveFailures: 1 }),
    watch('Overdue', { nextCheckAt: checkedAt }),
    watch('Completed', { plan: { ...watch('x').plan, forecastDate: '2000-01-01' } })];
  const h = await setup(t, () => ({ payload: { watches, policy } }));
  assert.equal(h.cards().length, 4);
  assert.equal(h.cards().at(-1), 'Clear');
  assert.match(h.text(), /Score 72/);
  assert.match(h.text(), /Some source data is missing/);
  await h.click('Needs attention');
  assert.deepEqual(h.cards().sort(), ['Failed', 'Overdue', 'Partial']);
  await h.click('Completed');
  assert.deepEqual(h.cards(), ['Completed']);
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.includes('Plan completed')).disabled, true);
  await h.click('All');
  assert.equal(h.cards().length, 5);
});

test('refresh updates the card and preserves expanded history', async t => {
  let latest = check();
  const h = await setup(t, (url, init) => {
    if (url.endsWith('/refresh') && init.method === 'POST') {
      latest = { ...check('partial'), id: 'check-2', checkedAt: new Date().toISOString() };
      return { payload: { watch: watch('Rainier', { latestCheck: undefined }), policy } };
    }
    if (url.endsWith('/checks')) return { payload: { checks: [latest], policy } };
    if (url.endsWith('/events')) return { payload: { events: [], policy } };
    return { payload: { watches: [watch('Rainier', { latestCheck: latest })], policy } };
  });
  await h.click('Check history');
  assert.match(h.text(), /No risk increase detected/);
  await h.click('Check now');
  assert.ok(document.querySelector('.field-watch-history'));
  assert.match(document.querySelector('.field-watch-latest').textContent, /Incomplete source data/);
  assert.match(document.querySelector('.field-watch-history').textContent, /Incomplete source data/);
});

test('cooldown uses the latest attempt, including failures, and expiry matches the server date boundary', () => {
  const now = Date.parse('2026-09-06T14:00:00Z');
  const w = watch('Rainier', { lastAttemptedAt: new Date(now - 60000).toISOString(),
    lastCheckedAt: new Date(now - 3600000).toISOString() });
  assert.equal(watchRefreshWait(w, policy, now), 4 * 60000);
  assert.equal(watchRefreshWait(w, policy, now + 4 * 60000), 0);
  assert.equal(watchRefreshWait({ ...w, lastAttemptedAt: 'bad' }, policy, now), 0);
  const ended = watch('Finished', { plan: { ...w.plan, forecastDate: '2026-09-05' } });
  assert.equal(watchHasEnded(ended, now - 1), false);
  assert.equal(watchHasEnded(ended, now), true);
});

test('a failed refresh preserves its error and applies the server attempt cooldown', async t => {
  let failed = false;
  const h = await setup(t, (url) => {
    if (url.endsWith('/refresh')) {
      failed = true;
      return { status: 500, payload: { error: 'Forecast retrieval failed' } };
    }
    return { payload: { watches: [watch('Rainier', failed ? {
      lastAttemptedAt: new Date().toISOString(), consecutiveFailures: 1, latestCheck: check('failed'),
    } : {})], policy } };
  });
  await h.click('Check now');
  assert.match(h.text(), /Forecast retrieval failed/);
  assert.match(document.querySelector('.field-watch-latest').textContent, /Check failed/);
  assert.ok([...document.querySelectorAll('button')].some(b => b.disabled && b.textContent.includes('Check in 5m')));
});

test('background revalidation updates expanded history when an automatic check arrives', async t => {
  let latest = check();
  const h = await setup(t, (url) => {
    if (url.endsWith('/checks')) return { payload: { checks: [latest], policy } };
    if (url.endsWith('/events')) return { payload: { events: [], policy } };
    return { payload: { watches: [watch('Rainier', { latestCheck: latest })], policy } };
  });
  await h.click('Check history');
  latest = { ...check('partial'), id: 'automatic-2', checkType: 'automatic' };
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.match(document.querySelector('.field-watch-history').textContent, /Automatic check · Incomplete source data/);
  assert.match(document.querySelector('.field-watch-latest').textContent, /Incomplete source data/);
});
