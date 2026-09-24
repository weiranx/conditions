import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getDefaultUserPreferences } from '../src/app/preferences';
import { usePreferenceHandlers } from '../src/hooks/usePreferenceHandlers';

// The decision's hour-window checks are backend tests now
// (backend/test/unit.plan-evaluation.test.js).
const preferences = getDefaultUserPreferences();

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
