import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Route } from '../src/field/Route';
import { buildCheckpointProfile } from '../src/field/route-planning';

const point = (overrides = {}) => ({
  name: 'Trailhead', elev_ft: 6000, distance_miles: 0, progress_percent: 0,
  etaDate: '2026-09-08', etaTime: '23:00', dataAvailable: true, score: 70,
  weather: { temp: 32, windGust: 20, precipChance: 0 }, activeAlerts: 0,
  ...overrides,
});
const result = (summaries) => ({ summaries, waypoints: [], partialData: false,
  analysis: 'Checkpoint evidence.', routeSource: 'generated' });
const workspace = (overrides = {}) => ({
  safetyData: { capabilities: { routeAnalysis: true } },
  routeAnalysis: result([point(), point({ name: 'Summit', distance_miles: 5, elev_ft: 9000,
    etaDate: '2026-09-09', etaTime: '03:00', progress_percent: 100 })]),
  preferences: { elevationUnit: 'ft' }, featureFlags: { gpxImport: true },
  objectiveName: 'Test mountain', position: { lat: 46, lng: -121 },
  forecastDate: '2026-09-08', alpineStartTime: '23:00', travelWindowHours: 4,
  objectiveTimezone: 'America/Los_Angeles', customRouteName: '',
  routeSuggestions: [{ name: 'West ridge', class: 'Class 2', distance_rt_miles: 10, elev_gain_ft: 3000 }],
  formatElevationDisplay: n => `${n} ft`, formatDistanceDisplay: n => `${n} mi`,
  formatElevationDeltaDisplay: n => `+${n} ft`, formatTempDisplay: n => `${n}°F`,
  formatWindDisplay: n => `${n} mph`,
  ...overrides,
});

test('profile respects uneven cumulative distance, with progress and order fallbacks', () => {
  const summaries = [point(), point({ distance_miles: 1, progress_percent: 25 }), point({ distance_miles: 10, progress_percent: 100 })];
  const profile = buildCheckpointProfile(summaries);
  assert.equal(profile.axis, 'distance');
  assert.deepEqual(profile.points.map(p => p.x), [20, 116, 980]);
  summaries[1].distance_miles = null;
  const progress = buildCheckpointProfile(summaries);
  assert.equal(progress.axis, 'progress');
  assert.equal(progress.points[1].x, 260);
  summaries[1].progress_percent = null;
  const order = buildCheckpointProfile(summaries);
  assert.equal(order.axis, 'order');
  assert.equal(order.points[1].x, 500);
});

test('profile rejects unavailable elevations and handles flat, duplicate and reversed distances', () => {
  for (const invalid of [null, undefined, NaN, Infinity, '5000']) {
    assert.equal(buildCheckpointProfile([point(), point({ elev_ft: invalid })]), null);
  }
  assert.equal(buildCheckpointProfile([]), null);
  assert.equal(buildCheckpointProfile([point()]), null);
  for (const distances of [[0, 0, 0], [0, 5, 2]]) {
    const profile = buildCheckpointProfile(distances.map(distance_miles => point({ elev_ft: 0, distance_miles })));
    assert.equal(profile.axis, 'order');
    assert.ok(profile.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

test('itinerary keeps every arrival date, alternatives and route uncertainty visible', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace()} />);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll('.field-route-stop').length, 2);
  assert.match(doc.querySelector('.field-route-itinerary').textContent, /2026-09-08.*2026-09-09/);
  assert.ok(doc.querySelector('.field-route-alternatives'));
  assert.equal(doc.querySelector('.field-route-alternatives').open, false);
  assert.match(html, /2 of 2 forecasts returned/);
  assert.match(html, /not been verified against a mapped trail/);
  assert.match(html, /not terrain-adjusted pace/);
});

test('missing checkpoint forecasts never display zero alerts, score, or weather as evidence', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([
    point({ dataAvailable: false, score: 0, weather: { temp: 0, windGust: 0, precipChance: 0 } }),
  ]) })} />);
  assert.match(html, /0 of 1 forecasts returned/);
  assert.match(html, /Missing forecast/);
  assert.match(html, /Alerts unavailable/);
  assert.doesNotMatch(html, /0 alerts|0\/100|0°F|0 mph|>0%/);
  assert.match(html, /Some checkpoints have incomplete source data/);
});

test('empty results and unavailable services provide a useful next step', () => {
  const html = renderToStaticMarkup(<Route workspace={workspace({ routeAnalysis: result([]), routeSuggestions: [],
    safetyData: { capabilities: { routeAnalysis: false } } })} />);
  assert.match(html, /No checkpoint forecasts were returned/);
  assert.match(html, /No route suggestions found/);
  assert.match(html, /unavailable on this server/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('checkpoint selection updates detail and clamps when a shorter saved route loads', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ ai: { available: true } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<Route workspace={workspace({ viewingHistoryReport: true })} />));
  await act(async () => document.querySelectorAll('.field-route-stop')[1].click());
  assert.equal(document.querySelector('#field-route-checkpoint-detail h3').textContent, 'Summit');
  assert.equal(document.querySelectorAll('.field-route-stop')[1].getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('input'), null);
  await act(async () => root.render(<Route workspace={workspace({ viewingHistoryReport: true,
    routeAnalysis: result([point({ name: 'Replacement checkpoint' })]) })} />));
  assert.equal(document.querySelector('.field-route-stop').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#field-route-checkpoint-detail h3').textContent, 'Replacement checkpoint');
});
