const { createBackendRestartController } = require('../src/server/backend-restart');

test('keeps restart unavailable unless a supervisor-backed deployment enables it', () => {
  const controller = createBackendRestartController({ enabled: false });
  expect(controller.getStatus()).toMatchObject({
    available: false,
    scheduled: false,
  });
  expect(() => controller.scheduleRestart()).toThrow('unavailable in this deployment');
});

test('schedules one graceful termination signal and reports pending state', () => {
  let scheduledCallback = null;
  const timer = { unref: jest.fn() };
  const schedule = jest.fn((callback, delayMs) => {
    scheduledCallback = callback;
    expect(delayMs).toBe(1500);
    return timer;
  });
  const sendSignal = jest.fn();
  const controller = createBackendRestartController({
    enabled: true,
    now: () => Date.parse('2026-07-14T19:00:00.000Z'),
    schedule,
    sendSignal,
  });

  expect(controller.scheduleRestart()).toEqual({
    available: true,
    scheduled: true,
    scheduledAt: '2026-07-14T19:00:00.000Z',
    restartDelayMs: 1500,
    reason: null,
  });
  expect(controller.scheduleRestart()).toMatchObject({ scheduled: true });
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(timer.unref).toHaveBeenCalledTimes(1);

  scheduledCallback();
  expect(sendSignal).toHaveBeenCalledTimes(1);
});
