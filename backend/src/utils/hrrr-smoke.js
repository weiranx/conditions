const { spawn } = require('node:child_process');
const path = require('node:path');
const { createCache } = require('./cache');
const HOUR = 3600000;
let decoding = false;
const decodeSmoke = (buffer, lat, lon, signal) => new Promise((resolve, reject) => {
  // A GRIB grid is large in memory; do not allow simultaneous decoders on the VPS.
  if (decoding) return reject(new Error('Smoke decoder busy'));
  decoding = true;
  const child = spawn(process.env.GRIB_PYTHON || 'python3', [path.resolve(__dirname, '../../scripts/decode-smoke.py'), String(lat), String(lon)], { stdio: ['pipe', 'pipe', 'pipe'], signal });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 16384) child.kill('SIGKILL'); });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', () => { clearTimeout(timer); decoding = false; reject(new Error('Smoke decoder unavailable')); });
  child.on('close', (code) => {
    clearTimeout(timer); decoding = false;
    if (code !== 0) return reject(new Error('Smoke decoder failed'));
    try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid decoded smoke')); }
  });
  child.stdin.end(buffer);
});
const smokeRanges = (text) => {
  const rows = text.trim().split(/\r?\n/).map((line) => ({ line, offset: Number(line.split(':')[1]) }));
  return ['MASSDEN:8 m above ground:', 'COLMD:entire atmosphere (considered as a single layer):'].map((name) => {
    const index = rows.findIndex((r) => r.line.includes(name));
    const start = rows[index]?.offset, end = rows[index + 1]?.offset - 1;
    if (index < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start > 10000000) throw new Error('Missing or oversized smoke field');
    return `bytes=${start}-${end}`;
  });
};
const normalizeSmoke = (rows, validTime) => {
  if (!Array.isArray(rows) || rows.length !== 2) throw new Error('Incomplete smoke fields');
  for (const row of rows) {
    const stamp = `${row.validDate}${String(row.validClock).padStart(4, '0')}`;
    if (stamp !== validTime.replace(/[-:T]/g, '').slice(0, 12) || !Number.isFinite(row.value) || row.value < 0 || !Number.isFinite(row.distanceKm) || row.distanceKm > 10) throw new Error('Smoke grid time or location mismatch');
  }
  // HRRR uses GRIB master table version 2; ecCodes can label these newer
  // parameters "unknown". Validate the numeric NCEP table 4.2-0-20 codes
  // instead of guessing from a missing human-readable unit label.
  for (const [index, row] of rows.entries()) {
    if (row.centre !== 'kwbc' || row.discipline !== 0 || row.category !== 20 || row.parameter !== index
      || row.surfaceType !== (index === 0 ? 103 : 200) || (index === 0 && row.level !== 8)) throw new Error('Unknown smoke parameter or level');
    const expectedUnits = index === 0 ? ['kg m**-3', 'kg m-3', 'unknown'] : ['kg m**-2', 'kg m-2', 'unknown'];
    if (!expectedUnits.includes(row.units)) throw new Error('Unknown smoke units');
  }
  return {
    nearSurfaceUgM3: +(rows[0].value * 1e9).toFixed(2), columnMgM2: +(rows[1].value * 1e6).toFixed(2),
    gridDistanceKm: +rows[0].distanceKm.toFixed(1), gridLatitude: rows[0].latitude,
    gridLongitude: rows[0].longitude > 180 ? rows[0].longitude - 360 : rows[0].longitude,
  };
};
const createHrrrSmokeService = ({ getBytes, now = Date.now, decode = decodeSmoke }) => {
  const cache = createCache({ name: 'hrrr-smoke-points', ttlMs: 30 * 60000, maxEntries: 100 });
  return async ({ lat, lon, targetTimeIso, fetchOptions }) => {
    if (lat < 24 || lat > 50 || lon < -125 || lon > -66) return { available: false, status: 'out_of_range', note: 'HRRR smoke sampling currently covers the contiguous United States.' };
    const cycle = Math.floor((now() - 2 * HOUR) / (6 * HOUR)) * 6 * HOUR;
    const hour = Math.round((Date.parse(targetTimeIso) - cycle) / HOUR);
    if (!Number.isFinite(hour) || hour < 0 || hour > 48) return { available: false, status: 'out_of_range', note: 'Selected time is outside the latest 48-hour HRRR run.' };
    return cache.getOrFetch(`${lat.toFixed(4)},${lon.toFixed(4)}:${cycle}:${hour}`, async () => {
      const issuedTime = new Date(cycle).toISOString();
      const validTime = new Date(cycle + hour * HOUR).toISOString();
      const url = `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.${issuedTime.slice(0, 10).replace(/-/g, '')}/conus/hrrr.t${issuedTime.slice(11, 13)}z.wrfsfcf${String(hour).padStart(2, '0')}.grib2`;
      const index = (await getBytes(`${url}.idx`, { fetchOptions, maxBytes: 100000 })).toString();
      const buffers = await Promise.all(smokeRanges(index).map((range) => getBytes(url, { fetchOptions, range, maxBytes: 10000000 })));
      const rows = await decode(Buffer.concat(buffers), lat, lon, fetchOptions?.signal);
      return { available: true, status: 'ok', issuedTime, validTime, ...normalizeSmoke(rows, validTime), sourceLink: `${url}.idx`, note: 'Modeled wildfire smoke at 8 m above ground and through the atmospheric column. A snapshot near the selected start, not total PM2.5, AQI, or whole-trip exposure. New fires and terrain effects may be missed.' };
    });
  };
};
module.exports = { createHrrrSmokeService, smokeRanges, normalizeSmoke, decodeSmoke };
