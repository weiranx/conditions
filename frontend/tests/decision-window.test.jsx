import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { evaluateBackcountryDecision } from '../src/app/decision';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { usePreferenceHandlers } from '../src/hooks/usePreferenceHandlers';
import { makeReport } from '../dev/mock-data.mjs';

const preferences = getDefaultUserPreferences();
const clearDay = () => makeReport({ date: '2026-09-06', start: '07:00', travel_window_hours: 10 }, 'clear');

test('an hour without a temperature reading is not scored as 0 °F', () => {
  const data = clearDay();
  data.weather.trend[3].temp = null;
  const decision = evaluateBackcountryDecision(data, '07:00', preferences);
  const feelsLike = decision.checks.find((check) => check.key === 'feels-like');
  assert.equal(feelsLike.ok, true, feelsLike.detail);
  assert.doesNotMatch(feelsLike.detail, /-\d+°F/);
  assert.ok(!decision.cautions.some((text) => /Apparent temperature falls/.test(text)));
});

test('the heat blocker uses the hottest hour of the window, not the coldest', () => {
  const data = clearDay();
  data.weather.trend[6].temp = 101;
  const decision = evaluateBackcountryDecision(data, '07:00', preferences);
  assert.equal(decision.level, 'NO-GO');
  assert.ok(decision.blockers.some((text) => /Apparent temperature reaches about 101°F/.test(text)), decision.blockers.join(' | '));

  const cool = evaluateBackcountryDecision(clearDay(), '07:00', preferences);
  assert.ok(!cool.blockers.some((text) => /Apparent temperature reaches/.test(text)));
});

async function mountPreferenceHandlers(t, initial) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let current;
  function Probe() {
    const [prefs, setPreferences] = useState(initial.preferences);
    const [targetElevationInput, setTargetElevationInput] = useState(initial.target);
    const [trailheadElevationInput, setTrailheadElevationInput] = useState(initial.trailhead);
    const handlers = usePreferenceHandlers({
      preferences: prefs, setPreferences, travelWindowHours: prefs.travelWindowHours,
      targetElevationInput, setTargetElevationInput, trailheadElevationInput, setTrailheadElevationInput,
      onApplyToPlanner: () => {}, persistLocally: false,
    });
    current = { handlers, preferences: prefs, targetElevationInput, trailheadElevationInput };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<Probe />));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { get current() { return current; } };
}

test('switching elevation units keeps the typed trailhead at the same height', async (t) => {
  const h = await mountPreferenceHandlers(t, { preferences, target: '14411', trailhead: '5400' });
  await act(async () => h.current.handlers.handleElevationUnitChange('m'));
  assert.equal(h.current.preferences.elevationUnit, 'm');
  assert.equal(h.current.targetElevationInput, '4392');
  assert.equal(h.current.trailheadElevationInput, '1646');

  await act(async () => h.current.handlers.handleElevationUnitChange('ft'));
  assert.equal(h.current.trailheadElevationInput, '5400');
});

test('switching elevation units leaves an empty trailhead empty', async (t) => {
  const h = await mountPreferenceHandlers(t, { preferences, target: '', trailhead: '' });
  await act(async () => h.current.handlers.handleElevationUnitChange('m'));
  assert.equal(h.current.trailheadElevationInput, '');
  assert.equal(h.current.targetElevationInput, '');
});
