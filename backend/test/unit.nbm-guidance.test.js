const { createNbmService, parseNbp, reduceNbpBlock } = require('../src/utils/nbm-guidance');

const url = (hour) => `https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20260916/${hour}/text/blend_nbptx.t${hour}z`;
// The wind rows keep the fixed-width layout of the real bulletin; the extra rows must not be retained.
const station = (id, hhmm, firstHour) => [
  ` ${id.padEnd(7)}NBM V5.0 NBP GUIDANCE    9/16/2026  ${hhmm} UTC`,
  ` FHR    ${firstHour}| 29  41`,
  ' TMP    50| 60  70',
  ' WSPP1   0|      3',
  ' WSPP5   2|  9   2',
  ' WSPP9   4| 10   5',
  ' PWS    10| 20  30',
].join('\n');
// Every bulletin has a sample at 2026-09-17 12:00Z for KSAN.
const bulletin = (hhmm, firstHour) => Buffer.from(`${station('KSAN', hhmm, firstHour)}\n\n${station('KSEA', hhmm, firstHour)}\n`);
const bulletins = {
  [url('07')]: bulletin('0700', 29),
  [url('13')]: bulletin('1300', 23),
  [url('19')]: bulletin('1900', 17),
};
const args = { stations: [{ id: 'KSAN', distanceKm: 5 }], targetTimeIso: '2026-09-17T12:00:00Z', fetchOptions: { headers: { 'User-Agent': 'test' } } };

const setup = ({ files = bulletins, clock = '2026-09-16T10:00:00Z', waitBudgetMs } = {}) => {
  const state = { now: Date.parse(clock), files: { ...files } };
  const getBytes = jest.fn(async (target) => {
    const file = state.files[target];
    if (file === undefined) throw new Error('Source HTTP 404');
    if (file instanceof Error) throw file;
    return file;
  });
  return { state, getBytes, service: createNbmService({ getBytes, now: () => state.now, ...(waitBudgetMs === undefined ? {} : { waitBudgetMs }) }) };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const promptly = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('waited'), 200))]);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('a cached block keeps the rows parseNbp reads and drops the rest', () => {
  const full = station('KSAN', '1900', 17);
  const reduced = reduceNbpBlock(full);
  expect(parseNbp(reduced)).toEqual(parseNbp(full));
  expect(parseNbp(reduced).points).toHaveLength(1);
  expect(reduced).not.toContain('TMP');
  expect(reduced).not.toContain('PWS');
  expect(reduced.length).toBeLessThan(full.length);
  // A repeated row is read from its last occurrence, exactly as in the full block.
  const repeated = `${full}\n WSPP9   9| 99  99`;
  expect(parseNbp(reduceNbpBlock(repeated))).toEqual(parseNbp(repeated));
  expect(reduceNbpBlock('')).toBe('');
});

test('the newest bulletin is downloaded once and shared by every report', async () => {
  const { service, getBytes } = setup({ clock: '2026-09-16T21:00:00Z' });
  const [first, second] = await Promise.all([service(args), service(args)]);
  const third = await service(args);

  expect(first).toMatchObject({ available: true, issuedTime: '2026-09-16T19:00:00.000Z', sourceLink: url('19') });
  expect(second).toEqual(first);
  expect(third).toEqual(first);
  expect(getBytes).toHaveBeenCalledTimes(1);
  // The download belongs to the cache, not to whichever report asked first: no request signal, a long deadline.
  expect(getBytes).toHaveBeenCalledWith(url('19'), expect.objectContaining({ timeoutMs: 60000, maxBytes: 45000000 }));
  expect(getBytes.mock.calls[0][1].fetchOptions.signal).toBeUndefined();
});

test('a report goes out without the bulletin rather than wait past its budget, and the download carries on', async () => {
  const { service, getBytes, state } = setup({ clock: '2026-09-16T21:00:00Z', waitBudgetMs: 20 });
  const download = deferred();
  state.files[url('19')] = download.promise;

  const first = await service(args);
  expect(first).toMatchObject({ available: false, status: 'unavailable', note: expect.stringMatching(/still loading/) });
  // The older cycle is not fetched as well: that would be a second 35 MB download.
  expect(getBytes.mock.calls.map(([target]) => target)).toEqual([url('19')]);
  expect(await service(args)).toMatchObject({ status: 'unavailable' });
  expect(getBytes).toHaveBeenCalledTimes(1);

  download.resolve(bulletins[url('19')]);
  await settle();
  expect(await service(args)).toMatchObject({ available: true, issuedTime: '2026-09-16T19:00:00.000Z' });
  expect(getBytes).toHaveBeenCalledTimes(1);
});

test('the budget is one wait for the whole report, however many cycles it tries', async () => {
  const { service, getBytes, state } = setup({ clock: '2026-09-16T21:00:00Z', waitBudgetMs: 50 });
  // The newest bulletin is not published; the previous one is slow. The wait for it comes out of the same budget.
  delete state.files[url('19')];
  state.files[url('13')] = new Promise(() => {});
  const startedAt = Date.now();
  const result = await service(args);

  expect(result).toMatchObject({ available: false, status: 'unavailable', note: expect.stringMatching(/still loading/) });
  expect(Date.now() - startedAt).toBeLessThan(400);
  expect(getBytes.mock.calls.map(([target]) => target)).toEqual([url('19'), url('13')]);
});

test('a bulletin already in memory is used at once whatever the budget', async () => {
  const { service } = setup({ clock: '2026-09-16T21:00:00Z', waitBudgetMs: 0 });
  await service.prewarm();
  expect(await service(args)).toMatchObject({ available: true, issuedTime: '2026-09-16T19:00:00.000Z' });
});

test('the first report after a restart waits for the newest bulletin and falls back when it is not published', async () => {
  const { service, getBytes, state } = setup({ clock: '2026-09-16T21:00:00Z' });
  delete state.files[url('19')];
  const result = await service(args);

  expect(result).toMatchObject({ available: true, issuedTime: '2026-09-16T13:00:00.000Z', sourceLink: url('13') });
  expect(getBytes.mock.calls.map(([target]) => target)).toEqual([url('19'), url('13')]);

  const { service: nothing } = setup({ files: {}, clock: '2026-09-16T21:00:00Z' });
  expect(await nothing(args)).toMatchObject({ available: false, status: 'unavailable' });
});

test('a report answers from the previous cycle while the new bulletin downloads in the background', async () => {
  const { service, getBytes, state } = setup();
  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });
  expect(getBytes).toHaveBeenCalledTimes(1);

  // The 13 UTC cycle becomes current, and its bulletin is slow to arrive.
  const download = deferred();
  state.files[url('13')] = download.promise;
  state.now = Date.parse('2026-09-16T16:00:00Z');
  const during = await promptly(service(args));
  expect(during).toMatchObject({ available: true, issuedTime: '2026-09-16T07:00:00.000Z', sourceLink: url('07') });
  expect(await promptly(service(args))).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });

  // One background download, made without the report's signal and with a long deadline.
  const downloads = getBytes.mock.calls.filter(([target]) => target === url('13'));
  expect(downloads).toHaveLength(1);
  expect(downloads[0][1]).toMatchObject({ timeoutMs: 60000, fetchOptions: { headers: { 'User-Agent': 'test' } } });
  expect(downloads[0][1].fetchOptions.signal).toBeUndefined();

  download.resolve(bulletins[url('13')]);
  await settle();
  const after = await service(args);
  expect(after).toMatchObject({ issuedTime: '2026-09-16T13:00:00.000Z', sourceLink: url('13') });
  expect(getBytes.mock.calls.filter(([target]) => target === url('13'))).toHaveLength(1);
});

test('a failed background download is not retried by every report', async () => {
  const { service, getBytes, state } = setup();
  await service(args);
  state.files[url('13')] = new Error('Source HTTP 404');
  state.now = Date.parse('2026-09-16T16:00:00Z');
  const attempts = () => getBytes.mock.calls.filter(([target]) => target === url('13')).length;

  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });
  await settle();
  expect(attempts()).toBe(1);

  state.now += 60000;
  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });
  await settle();
  expect(attempts()).toBe(1);

  state.now += 5 * 60000;
  state.files[url('13')] = bulletins[url('13')];
  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });
  await settle();
  expect(attempts()).toBe(2);
  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T13:00:00.000Z' });
});

test('a bulletin stays available as the fallback through the whole next cycle', async () => {
  const { service, state } = setup();
  await service(args);
  // Just before the 19 UTC cycle would replace the 13 UTC one, five hours after the 07 UTC bulletin was fetched.
  state.now = Date.parse('2026-09-16T15:00:00Z');
  state.files[url('13')] = new Promise(() => {});
  expect(await promptly(service(args))).toMatchObject({ issuedTime: '2026-09-16T07:00:00.000Z' });
});

test('prewarm loads the newest bulletin ahead of the first report, or the previous one when it is not out', async () => {
  const { service, getBytes } = setup({ clock: '2026-09-16T21:00:00Z' });
  await service.prewarm({ fetchOptions: { headers: { 'User-Agent': 'test' }, signal: new AbortController().signal } });
  expect(getBytes).toHaveBeenCalledTimes(1);
  expect(getBytes.mock.calls[0][1].fetchOptions.signal).toBeUndefined();
  expect(await service(args)).toMatchObject({ issuedTime: '2026-09-16T19:00:00.000Z' });
  expect(getBytes).toHaveBeenCalledTimes(1);

  const late = setup({ clock: '2026-09-16T21:00:00Z' });
  delete late.state.files[url('19')];
  await late.service.prewarm();
  expect(late.getBytes.mock.calls.map(([target]) => target)).toEqual([url('19'), url('13')]);
  expect(await late.service(args)).toMatchObject({ issuedTime: '2026-09-16T13:00:00.000Z' });

  const down = setup({ files: {}, clock: '2026-09-16T21:00:00Z' });
  await expect(down.service.prewarm()).resolves.toBeUndefined();
});

test('a report stops waiting for a download when its own request is cancelled', async () => {
  const { service, state } = setup({ clock: '2026-09-16T21:00:00Z' });
  state.files[url('19')] = new Promise(() => {});
  const controller = new AbortController();
  const pending = service({ ...args, fetchOptions: { signal: controller.signal } });
  setTimeout(() => controller.abort(new Error('Client disconnected')), 10);
  await expect(pending).rejects.toThrow('Client disconnected');
});

test('a bulletin with no station blocks is rejected rather than cached', async () => {
  const { service, getBytes, state } = setup({ clock: '2026-09-16T21:00:00Z' });
  state.files[url('19')] = Buffer.from('not a bulletin');
  state.files[url('13')] = Buffer.from('not a bulletin either');
  expect(await service(args)).toMatchObject({ available: false, status: 'unavailable' });
  await service(args);
  expect(getBytes.mock.calls.filter(([target]) => target === url('19')).length).toBe(2);
});
