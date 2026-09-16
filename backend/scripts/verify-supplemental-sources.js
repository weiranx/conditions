// Read-only provider smoke check. No key values or request URLs are printed.
require('dotenv').config({ quiet: true });
const { createSupplementalEvidenceService } = require('../src/utils/supplemental-evidence');
const { createUsgsWaterService } = require('../src/utils/usgs-water');
const { createFetchWithTimeout } = require('../src/utils/http-client');
const { haversineKm } = require('../src/utils/geo');
const lat = Number(process.argv[2] ?? 32.7336), lon = Number(process.argv[3] ?? -117.1897);
if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Provide a valid latitude and longitude');
const fetchWithTimeout = createFetchWithTimeout(10000);
const targetTimeIso = new Date(Date.now() + 18 * 3600000).toISOString();
Promise.allSettled([
  createSupplementalEvidenceService({ fetchWithTimeout, synopticToken: process.env.SYNOPTIC_API_TOKEN })({ lat, lon, targetTimeIso }),
  createUsgsWaterService({ fetchWithTimeout, haversineKm, apiKey: process.env.USGS_API_KEY })({ lat, lon }),
]).then(([evidence, water]) => {
  if (evidence.status === 'fulfilled') for (const [key, value] of Object.entries(evidence.value)) console.log(JSON.stringify({ source: key, status: value.status, issuedTime: value.issuedTime, validTime: value.validTime, station: value.station?.id, sampleCount: value.points?.length, stationCount: value.stations?.length, nearSurfaceUgM3: value.nearSurfaceUgM3, columnMgM2: value.columnMgM2 }));
  else console.log('Supplemental check failed');
  console.log(JSON.stringify({ source: 'USGS', status: water.status === 'fulfilled' ? water.value.status : 'unavailable', site: water.status === 'fulfilled' ? water.value.siteId : undefined }));
});
