const { createSafetyInvoker } = require('../src/routes/safety');

test('internal safety invocations can suppress report logging', async () => {
  let capturedRequest;
  const invokeSafetyHandler = createSafetyInvoker({
    safetyHandler: async (req, res) => {
      capturedRequest = req;
      res.json({ ok: true });
    },
  });

  const result = await invokeSafetyHandler(
    { lat: '46.85', lon: '-121.76' },
    { suppressReportLog: true },
  );

  expect(result).toEqual({ statusCode: 200, payload: { ok: true } });
  expect(capturedRequest.internal).toEqual({ suppressReportLog: true });
});

test('internal safety invocations log by default', async () => {
  let capturedRequest;
  const invokeSafetyHandler = createSafetyInvoker({
    safetyHandler: async (req, res) => {
      capturedRequest = req;
      res.json({ ok: true });
    },
  });

  await invokeSafetyHandler({ lat: '46.85', lon: '-121.76' });

  expect(capturedRequest.internal).toEqual({ suppressReportLog: false });
});
