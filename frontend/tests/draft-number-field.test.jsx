import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
// React's event support is detected when React DOM is first imported.
const bootstrap = new JSDOM('<html><body></body></html>');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: bootstrap.window.navigator });
const { createRoot } = await import('react-dom/client');
const { DraftNumberField } = await import('../src/field/Thresholds');
bootstrap.window.close();
delete globalThis.window;
delete globalThis.document;
if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
else delete globalThis.navigator;

/** The field as a setting uses it: what it applies becomes the value it is given. */
async function mount(t, props) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const applied = [];
  function Host() {
    const [value, setValue] = useState(props.initial);
    return <DraftNumberField id="setting" value={value} unit="min/mi" min={props.min} max={props.max} integer={props.integer}
      onApply={(next) => { applied.push(next); setValue(next); }} />;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<Host />));
  const input = () => document.getElementById('setting');
  return {
    applied,
    shown: () => input().value,
    type: (text) => act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input(), text);
      input().dispatchEvent(new window.Event('input', { bubbles: true }));
    }),
    leave: () => act(async () => { input().dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); }),
  };
}

test('a number can be edited by deleting a digit and typing another', async (t) => {
  const field = await mount(t, { initial: 30, min: 5, max: 120 });
  // 30 → backspace → "3" is below the minimum: shown as typed, not applied.
  await field.type('3');
  assert.equal(field.shown(), '3');
  assert.deepEqual(field.applied, []);
  // Then "35": applied at once.
  await field.type('35');
  assert.equal(field.shown(), '35');
  assert.deepEqual(field.applied, [35]);
  await field.leave();
  assert.equal(field.shown(), '35');
});

test('emptying the field applies nothing, and leaving puts the applied value back', async (t) => {
  const field = await mount(t, { initial: 45, min: 0, max: 240 });
  await field.type('');
  assert.equal(field.shown(), '');
  assert.deepEqual(field.applied, []);
  await field.leave();
  assert.equal(field.shown(), '45');
  assert.deepEqual(field.applied, []);
});

test('leaving clamps what was typed outside the range', async (t) => {
  const field = await mount(t, { initial: 30, min: 5, max: 120 });
  await field.type('3');
  await field.leave();
  assert.equal(field.shown(), '5');
  await field.type('500');
  assert.equal(field.shown(), '500', 'nothing is forced while typing');
  await field.leave();
  assert.equal(field.shown(), '120');
  assert.deepEqual(field.applied, [5, 120]);
});

test('a whole-number setting rounds what is typed once it applies', async (t) => {
  const field = await mount(t, { initial: 5, min: 0, max: 15, integer: true });
  await field.type('7.6');
  assert.deepEqual(field.applied, [8]);
  assert.equal(field.shown(), '7.6', 'the typing is left alone until the field is left');
  await field.leave();
  assert.equal(field.shown(), '8');
});
