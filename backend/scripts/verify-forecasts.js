#!/usr/bin/env node
const fs = require('node:fs');
const { verifyForecastPairs } = require('../src/utils/forecast-verification');
try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-forecasts.js matched-pairs.json');
  console.log(JSON.stringify(verifyForecastPairs(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
