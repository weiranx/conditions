const { createServerTiming } = require('../src/utils/server-timing');

test('each mark is the time since the request began, and the total comes last', () => {
  let now = 1000;
  const timing = createServerTiming(() => now);
  now = 1120;
  timing.mark('weather');
  now = 1450.25;
  timing.mark('snowpack');
  now = 1500;

  expect(timing.header()).toBe('weather;dur=120.0, snowpack;dur=450.3, total;dur=500.0');
});

test('the first mark under a name wins and names that are not header tokens are dropped', () => {
  let now = 0;
  const timing = createServerTiming(() => now);
  now = 10;
  timing.mark('alerts');
  now = 40;
  timing.mark('alerts');
  timing.mark('bad name');
  timing.mark('semi;colon');
  timing.mark('');

  expect(timing.header()).toBe('alerts;dur=10.0, total;dur=40.0');
});

test('a tracked promise is marked when it settles, either way, and is returned unchanged', async () => {
  let now = 0;
  const timing = createServerTiming(() => now);
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  expect(timing.track('slow', slow)).toBe(slow);
  const failing = Promise.reject(new Error('down'));
  expect(timing.track('failing', failing)).toBe(failing);
  await expect(failing).rejects.toThrow('down');

  now = 250;
  release('ok');
  await slow;
  await Promise.resolve();
  now = 300;

  const marks = Object.fromEntries(timing.header().split(', ').map((entry) => entry.split(';dur=')));
  expect(marks.failing).toBe('0.0');
  expect(marks.slow).toBe('250.0');
  expect(marks.total).toBe('300.0');
});

test('a header can be built at any point without disturbing the marks', () => {
  let now = 5;
  const timing = createServerTiming(() => now);
  expect(timing.header()).toBe('total;dur=0.0');
  now = 9;
  timing.mark('a');
  const first = timing.header();
  expect(timing.header()).toBe(first);
});
