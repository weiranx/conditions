import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/contexts/account';
import { Library } from '../src/field/Library';
import { useObjectiveWatchStatus } from '../src/field/model/useObjectiveWatchStatus';
import { watchHasEnded, watchNeedsAttention, watchRefreshWait } from '../src/field/watch-status';

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
const mph = { formatWindDisplay: (value) => `${Math.round(value)} mph`, localizeUnitText: (text) => text };
const kph = {
  formatWindDisplay: (value) => `${Math.round(value * 1.609)} kph`,
  localizeUnitText: (text) => text.replace(/(\d+) mph/g, (_, value) => `${Math.round(value * 1.609)} kph`),
};
const worse = (label, key = 'wind_gust') => ({ key, direction: 'worse', label });
const better = (label, key = 'wind_gust_improvement') => ({ key, direction: 'better', label });
const changed = (reasons, overrides = {}) => ({ ...check('changed'), change: { checkedAt, reasons }, ...overrides });
async function setup(t, handler, units = mph) {
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
      workspace={{ featureFlags: {}, handleOpenObjectiveWatch: noop, ...units }} />
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
  assert.match(h.text(), /No meaningful change/);
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

test('labels improvements as improvements and flags only unreviewed risk increases', async t => {
  const watches = [
    watch('Improved', { latestCheck: changed([better('Peak gusts decreased from 40 mph to 20 mph.')]),
      unreviewedChanges: { count: 1, worsened: false, latest: { checkedAt, reasons: [better('Peak gusts decreased from 40 mph to 20 mph.')] }, latestWorse: null } }),
    watch('Worse', { latestCheck: changed([worse('Peak gusts increased from 20 mph to 40 mph.'), better('Precipitation chance decreased from 70% to 30%.', 'precipitation_improvement')]),
      unreviewedChanges: { count: 1, worsened: true, latest: null, latestWorse: { checkedAt, reasons: [worse('Peak gusts increased from 20 mph to 40 mph.')] } } }),
  ];
  const h = await setup(t, () => ({ payload: { watches, policy } }));
  const card = (title) => [...document.querySelectorAll('.field-watch-card')].find((el) => el.querySelector('h2').textContent === title);
  assert.match(card('Improved').querySelector('.field-watch-latest strong').textContent, /Conditions improved/);
  assert.match(card('Improved').textContent, /Conditions improved since your last review/);
  assert.match(card('Worse').querySelector('.field-watch-latest strong').textContent, /Risk increased/);
  const reasons = [...card('Worse').querySelectorAll('.field-watch-latest li')];
  assert.deepEqual(reasons.map((li) => li.className), ['is-worse', 'is-better']);
  // The latest check already lists the change under review.
  assert.equal(card('Worse').querySelectorAll('.field-watch-review li').length, 0);
  await h.click('Needs attention');
  assert.deepEqual(h.cards(), ['Worse']);
});

test('marking changes reviewed clears the attention flag', async t => {
  let reviewed = false;
  const requests = [];
  const unreviewed = { count: 3, worsened: true, latest: null,
    latestWorse: { checkedAt: '2026-09-01T00:00:00Z', reasons: [worse('New weather alert: Wind Advisory (Moderate).', 'new_weather_alert')] } };
  const h = await setup(t, (url, init) => {
    requests.push(`${init?.method || 'GET'} ${url}`);
    if (url.endsWith('/review')) {
      reviewed = true;
      return { payload: { watch: watch('Rainier'), policy } };
    }
    return { payload: { watches: [watch('Rainier', { unreviewedChanges: reviewed
      ? { count: 0, worsened: false, latest: null, latestWorse: null } : unreviewed })], policy } };
  });
  assert.match(h.text(), /Risk increased since your last review · 3 changes in check history/);
  assert.match(document.querySelector('.field-watch-review').textContent, /New weather alert: Wind Advisory/);
  assert.ok(document.querySelector('.field-watch-card.is-attention'));
  await h.click('Mark reviewed');
  assert.ok(requests.some((entry) => entry.startsWith('POST') && entry.endsWith('/review')));
  assert.equal(document.querySelector('.field-watch-review'), null);
  assert.equal(document.querySelector('.field-watch-card.is-attention'), null);
});

test('shows readings and change reasons in the preferred wind unit, including older labels', async t => {
  const legacy = { key: 'wind_gust', label: 'Peak gusts increased from 20 to 40 mph.' };
  await setup(t, () => ({ payload: { watches: [watch('Rainier', {
    latestCheck: changed([legacy], { summary: { score: 60, maxWindGust: 40, avalancheDanger: 3 } }),
  })], policy } }), kph);
  const latest = document.querySelector('.field-watch-latest').textContent;
  assert.match(latest, /Peak gust 64 kph/);
  assert.match(latest, /Avalanche Considerable/);
  assert.match(latest, /Peak gusts increased from 32 kph to 64 kph/);
  assert.doesNotMatch(latest, /mph/);
});

test('attention falls back to the direction of the last change without review data', () => {
  const now = Date.parse('2026-09-06T14:00:00Z');
  const improvement = watch('Rainier', { lastChange: { reasons: [{ key: 'score_improvement', label: 'Better.' }] } });
  const increase = watch('Rainier', { lastChange: { reasons: [{ key: 'score_drop', label: 'Worse.' }] } });
  assert.equal(watchNeedsAttention(improvement, policy, now), false);
  assert.equal(watchNeedsAttention(increase, policy, now), true);
});

test('the report learns whether its exact plan is already watched', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const lookups = [];
  let watched = false;
  globalThis.fetch = async (url) => {
    lookups.push(String(url));
    return new Response(JSON.stringify({ watch: watched ? watch('Rainier') : null, policy }), { status: 200 });
  };
  const plan = watch('Rainier').plan;
  let status;
  function Probe({ active, userId = 'user' }) {
    status = useObjectiveWatchStatus(plan, userId, active);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  await act(async () => root.render(<Probe active />));
  assert.equal(status.watching, false);
  assert.match(lookups[0], /forecastDate=2099-09-06&alpineStartTime=05%3A30&travelWindowHours=12/);
  await act(async () => status.markWatched());
  assert.equal(status.watching, true);

  // Returning to the report checks again, so a watch removed elsewhere is noticed.
  await act(async () => root.render(<Probe active={false} />));
  assert.equal(status.watching, true);
  await act(async () => root.render(<Probe active />));
  assert.equal(lookups.length, 2);
  assert.equal(status.watching, false);

  watched = true;
  await act(async () => root.render(<Probe active userId="other-user" />));
  assert.equal(status.watching, true);
  await act(async () => root.render(<Probe active userId={null} />));
  assert.equal(status.watching, false);
  assert.equal(lookups.length, 3);
});
