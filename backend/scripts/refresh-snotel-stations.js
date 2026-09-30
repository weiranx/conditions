#!/usr/bin/env node
// Rewrites src/data/snotel-stations.json from the live USDA AWDB catalog.
// The catalog changes a few times a year; run this when a station a report needs is missing.
//   node scripts/refresh-snotel-stations.js
const fs = require('node:fs');
const path = require('node:path');
const { SNOTEL_STATIONS_URL, parseSnotelStationCatalog } = require('../src/utils/snotel-stations');

const target = path.resolve(__dirname, '../src/data/snotel-stations.json');

(async () => {
  try {
    const response = await fetch(SNOTEL_STATIONS_URL, { headers: { 'User-Agent': 'BackcountryConditions/1.0 (station catalog refresh)' } });
    if (!response.ok) throw new Error(`AWDB station catalog request failed with status ${response.status}`);
    const stations = parseSnotelStationCatalog(await response.json())
      .sort((a, b) => String(a.stationTriplet).localeCompare(String(b.stationTriplet)));
    // The catalog holds well over a thousand snow stations; a short one means the response was cut off.
    if (stations.length < 800) throw new Error(`AWDB returned only ${stations.length} SNOTEL stations; keeping the current file.`);
    // One station per line keeps the diff of a refresh readable.
    fs.writeFileSync(target, `[\n${stations.map((station) => `  ${JSON.stringify(station)}`).join(',\n')}\n]\n`);
    console.log(`Wrote ${stations.length} stations to ${path.relative(process.cwd(), target)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
