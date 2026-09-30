const { toFiniteOrNull } = require('./numbers');

const SNOTEL_STATIONS_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?elements=WTEQ,SNWD,PREC&durations=DAILY&activeOnly=true';
const SNOTEL_NETWORK_CODES = ['SNTL', 'SNTLT', 'MSNT'];

/**
 * The SNOTEL stations that can be located, reduced to the fields a report reads. The USDA catalog is about
 * 600 kB of which most is metadata nothing uses, and its server takes 10 seconds or more to send it.
 */
const parseSnotelStationCatalog = (json) => (Array.isArray(json) ? json : []).flatMap((station) => {
  const latitude = toFiniteOrNull(station?.latitude);
  const longitude = toFiniteOrNull(station?.longitude);
  if (!SNOTEL_NETWORK_CODES.includes(String(station?.networkCode || '').toUpperCase()) || latitude === null || longitude === null) return [];
  return [{
    stationTriplet: station.stationTriplet,
    stationId: station.stationId,
    stateCode: station.stateCode,
    networkCode: station.networkCode,
    name: station.name,
    elevation: toFiniteOrNull(station.elevation),
    latitude,
    longitude,
  }];
});

module.exports = { SNOTEL_STATIONS_URL, SNOTEL_NETWORK_CODES, parseSnotelStationCatalog };
