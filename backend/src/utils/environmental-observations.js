'use strict';

const { createCache, normalizeCoordKey } = require('./cache');

const NWS_POINTS_URL = 'https://api.weather.gov/points';
const MRMS_REFLECTIVITY_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer';
const RFC_QPE_URL = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer';
const USFS_CLOSED_ROADS_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer/1';
const WFIGS_CURRENT_PERIMETERS_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0';

const toFiniteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round = (value, digits = 1) => {
  const numeric = toFiniteOrNull(value);
  if (numeric === null) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

const convertQuantity = (quantity, target) => {
  const value = toFiniteOrNull(quantity?.value);
  if (value === null) return null;
  const unit = String(quantity?.unitCode || '').toLowerCase();
  if (target === 'tempF') {
    if (unit.includes('degc')) return round((value * 9) / 5 + 32);
    if (unit.includes('degf')) return round(value);
  }
  if (target === 'speedMph') {
    if (unit.includes('m_s-1')) return round(value * 2.236936);
    if (unit.includes('km_h-1')) return round(value * 0.621371);
    if (unit.includes('mi_h-1')) return round(value);
    if (unit.includes('kt')) return round(value * 1.150779);
  }
  if (target === 'distanceMi') {
    if (unit.endsWith(':m')) return round(value / 1609.344);
    if (unit.includes('km')) return round(value * 0.621371);
    if (unit.includes('mi')) return round(value);
  }
  if (target === 'precipIn') {
    if (unit.endsWith(':m')) return round(value * 39.3701, 2);
    if (unit.includes('mm')) return round(value * 0.0393701, 2);
    if (unit.includes('in')) return round(value, 2);
  }
  return round(value);
};

const parseArcGisRasterValue = (result) => {
  const raw = result?.attributes?.['Service Pixel Value'];
  if (raw === null || raw === undefined || /^nodata$/i.test(String(raw))) return null;
  return toFiniteOrNull(raw);
};

const parseProductTime = (attributes = {}) => {
  const name = String(attributes?.name || '');
  const compact = name.match(/(20\d{6})[_-](\d{6})/);
  if (compact) {
    const date = compact[1];
    const time = compact[2];
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
  }
  const epoch = toFiniteOrNull(attributes?.idp_validtime);
  if (epoch !== null && epoch > 1_000_000_000_000) return new Date(epoch).toISOString();
  return null;
};

const goesDayOfYear = (date) => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return String(Math.floor((date.getTime() - start) / 86_400_000)).padStart(3, '0');
};

const parseGlmKeyTime = (key) => {
  const match = String(key || '').match(/_s(20\d{2})(\d{3})(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, 0, day, Number(match[3]), Number(match[4]), Number(match[5])));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < String(text || '').length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const createEnvironmentalObservationService = ({
  fetchWithTimeout,
  haversineKm,
  requestTimeoutMs = 10000,
  firmsMapKey = null,
} = {}) => {
  const weatherObservationCache = createCache({ name: 'nws-observations', ttlMs: 10 * 60 * 1000, staleTtlMs: 20 * 60 * 1000, maxEntries: 300 });
  const radarCache = createCache({ name: 'noaa-radar-nowcast', ttlMs: 5 * 60 * 1000, staleTtlMs: 10 * 60 * 1000, maxEntries: 300 });
  const accessCache = createCache({ name: 'federal-access', ttlMs: 6 * 60 * 60 * 1000, staleTtlMs: 18 * 60 * 60 * 1000, maxEntries: 300 });
  const wildfireCache = createCache({ name: 'wildfire-activity', ttlMs: 15 * 60 * 1000, staleTtlMs: 30 * 60 * 1000, maxEntries: 300 });

  const fetchJson = async (url, fetchOptions, timeoutMs = requestTimeoutMs) => {
    const response = await fetchWithTimeout(url, fetchOptions, timeoutMs);
    if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
    return response.json();
  };

  const fetchWeatherObservation = ({ lat, lon, fetchOptions }) => weatherObservationCache.getOrFetch(
    normalizeCoordKey(lat, lon),
    async () => {
      const points = await fetchJson(`${NWS_POINTS_URL}/${lat},${lon}`, fetchOptions);
      const stationsUrl = points?.properties?.observationStations;
      if (!stationsUrl) return { available: false, source: 'NOAA/NWS station observations' };
      const stationCollection = await fetchJson(stationsUrl, fetchOptions);
      const stations = (stationCollection?.features || []).map((feature) => {
        const coordinates = feature?.geometry?.coordinates || [];
        const stationLat = toFiniteOrNull(coordinates[1]);
        const stationLon = toFiniteOrNull(coordinates[0]);
        const stationId = feature?.properties?.stationIdentifier || String(feature?.id || '').split('/').pop();
        if (!stationId || stationLat === null || stationLon === null) return null;
        return {
          stationId,
          stationName: feature?.properties?.name || stationId,
          stationLat,
          stationLon,
          elevationM: toFiniteOrNull(feature?.properties?.elevation?.value),
          distanceKm: haversineKm(lat, lon, stationLat, stationLon),
        };
      }).filter(Boolean).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 6);

      const settled = await Promise.allSettled(stations.map(async (station) => {
        const payload = await fetchJson(`https://api.weather.gov/stations/${encodeURIComponent(station.stationId)}/observations/latest`, fetchOptions);
        const props = payload?.properties || {};
        const result = {
          ...station,
          observedTime: props.timestamp || null,
          tempF: convertQuantity(props.temperature, 'tempF'),
          dewPointF: convertQuantity(props.dewpoint, 'tempF'),
          humidityPct: convertQuantity(props.relativeHumidity, 'raw'),
          windMph: convertQuantity(props.windSpeed, 'speedMph'),
          gustMph: convertQuantity(props.windGust, 'speedMph'),
          windDirectionDeg: convertQuantity(props.windDirection, 'raw'),
          visibilityMi: convertQuantity(props.visibility, 'distanceMi'),
          precipLastHourIn: convertQuantity(props.precipitationLastHour, 'precipIn'),
          textDescription: props.textDescription || null,
        };
        const hasMeasurement = [result.tempF, result.windMph, result.gustMph, result.humidityPct, result.visibilityMi]
          .some((value) => value !== null);
        result.measurementCount = [result.tempF, result.windMph, result.gustMph, result.humidityPct, result.visibilityMi]
          .filter((value) => value !== null).length;
        return hasMeasurement ? result : null;
      }));
      const candidates = settled.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value)
        .sort((a, b) => (a.distanceKm + (5 - a.measurementCount) * 10) - (b.distanceKm + (5 - b.measurementCount) * 10));
      if (!candidates.length) return { available: false, source: 'NOAA/NWS station observations' };
      const best = candidates[0];
      return {
        available: true,
        ...best,
        distanceKm: round(best.distanceKm),
        elevationFt: best.elevationM === null ? null : Math.round(best.elevationM * 3.28084),
        source: 'NOAA/NWS station observations (MADIS quality controlled)',
        sourceLink: `https://api.weather.gov/stations/${encodeURIComponent(best.stationId)}/observations/latest`,
        nearbyStationCount: candidates.length,
      };
    },
  );

  const identifyRaster = async ({ serviceUrl, layerId, lat, lon, fetchOptions }) => {
    const pad = 0.4;
    const params = new URLSearchParams({
      f: 'pjson',
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      tolerance: '2',
      mapExtent: `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`,
      imageDisplay: '800,600,96',
      returnGeometry: 'false',
      layers: `all:${layerId}`,
    });
    const payload = await fetchJson(`${serviceUrl}/identify?${params.toString()}`, fetchOptions);
    return Array.isArray(payload?.results) ? payload.results[0] || null : null;
  };

  const fetchGlmMetadata = async ({ lon, fetchOptions }) => {
    const satellite = lon <= -103 ? 'goes18' : 'goes19';
    for (let hourOffset = 0; hourOffset < 4; hourOffset += 1) {
      const target = new Date(Date.now() - hourOffset * 60 * 60 * 1000);
      const prefix = `GLM-L2-LCFA/${target.getUTCFullYear()}/${goesDayOfYear(target)}/${String(target.getUTCHours()).padStart(2, '0')}/`;
      const url = `https://noaa-${satellite}.s3.amazonaws.com/?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`;
      try {
        const response = await fetchWithTimeout(url, fetchOptions, requestTimeoutMs);
        if (!response.ok) continue;
        const xml = await response.text();
        const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
        if (!keys.length) continue;
        const key = keys[keys.length - 1];
        return {
          available: true,
          satellite: satellite === 'goes18' ? 'GOES-18 West' : 'GOES-19 East',
          productTime: parseGlmKeyTime(key),
          productKey: key,
          source: 'NOAA GOES-R Geostationary Lightning Mapper Level 2 feed',
          sourceLink: `https://noaa-${satellite}.s3.amazonaws.com/${key}`,
          detectionAtObjective: null,
          note: 'The raw GLM feed is available and timestamped. Objective-level flash extraction is not inferred from file presence; radar and NWS thunder probability remain the actionable nowcast signals.',
        };
      } catch {
        // Try an earlier hour before declaring the feed unavailable.
      }
    }
    return { available: false, source: 'NOAA GOES-R Geostationary Lightning Mapper Level 2 feed' };
  };

  const fetchRadarNowcast = ({ lat, lon, fetchOptions }) => radarCache.getOrFetch(
    normalizeCoordKey(lat, lon),
    async () => {
      const [reflectivity, qpe1h, qpe6h, qpe24h, lightning] = await Promise.allSettled([
        identifyRaster({ serviceUrl: MRMS_REFLECTIVITY_URL, layerId: 3, lat, lon, fetchOptions }),
        identifyRaster({ serviceUrl: RFC_QPE_URL, layerId: 8, lat, lon, fetchOptions }),
        identifyRaster({ serviceUrl: RFC_QPE_URL, layerId: 20, lat, lon, fetchOptions }),
        identifyRaster({ serviceUrl: RFC_QPE_URL, layerId: 28, lat, lon, fetchOptions }),
        fetchGlmMetadata({ lon, fetchOptions }),
      ]);
      const radarResult = reflectivity.status === 'fulfilled' ? reflectivity.value : null;
      const attributes = radarResult?.attributes || {};
      const pixelValue = parseArcGisRasterValue(radarResult);
      const values = [qpe1h, qpe6h, qpe24h].map((result) => {
        const value = result.status === 'fulfilled' ? parseArcGisRasterValue(result.value) : null;
        return value !== null && value >= 0 ? value : null;
      });
      const anyResponse = radarResult || [qpe1h, qpe6h, qpe24h].some((result) => result.status === 'fulfilled' && result.value);
      return {
        available: Boolean(anyResponse),
        status: pixelValue !== null && pixelValue > 0 ? 'echo_detected' : anyResponse ? 'no_echo_detected' : 'unavailable',
        echoDetected: pixelValue !== null && pixelValue > 0,
        reflectivityPixelValue: pixelValue,
        observedTime: parseProductTime(attributes),
        rain1hIn: round(values[0], 2),
        rain6hIn: round(values[1], 2),
        rain24hIn: round(values[2], 2),
        source: 'NOAA MRMS radar + NWS RFC quantitative precipitation estimates',
        sourceLink: 'https://radar.weather.gov/',
        note: 'Radar echo and gauge/radar precipitation are observations, not a forecast. Terrain blockage can reduce radar coverage in mountain valleys.',
        lightning: lightning.status === 'fulfilled' ? lightning.value : { available: false, source: 'NOAA GOES-R GLM' },
      };
    },
  );

  const fetchAccessStatus = ({ lat, lon, fetchOptions }) => accessCache.getOrFetch(
    normalizeCoordKey(lat, lon),
    async () => {
      const params = new URLSearchParams({
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        distance: '25',
        units: 'esriSRUnit_Kilometer',
        outFields: 'id,name,oper_maint_level,objective_maint_level,route_status,symbol_name,county,admin_org',
        returnGeometry: 'false',
        resultRecordCount: '20',
      });
      const payload = await fetchJson(`${USFS_CLOSED_ROADS_URL}/query?${params.toString()}`, fetchOptions);
      const seen = new Set();
      const roads = (payload?.features || []).map((feature) => feature?.attributes || {}).filter((attributes) => {
        const key = `${attributes.id || ''}|${attributes.name || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 10).map((attributes) => ({
        id: attributes.id || null,
        name: attributes.name || attributes.id || 'Unnamed Forest Service road',
        operatingLevel: attributes.oper_maint_level || null,
        objectiveLevel: attributes.objective_maint_level || null,
        routeStatus: attributes.route_status || null,
        symbolName: attributes.symbol_name || null,
        county: attributes.county || null,
      }));
      let caltransClosures = [];
      const isCalifornia = lat >= 32 && lat <= 42.2 && lon >= -125 && lon <= -113.5;
      if (isCalifornia) {
        try {
          const caltransParams = new URLSearchParams({
            f: 'json',
            geometry: `${lon},${lat}`,
            geometryType: 'esriGeometryPoint',
            inSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            distance: '75',
            units: 'esriSRUnit_Kilometer',
            outFields: 'Name,Snippet,PopupInfo',
            returnGeometry: 'false',
            resultRecordCount: '20',
          });
          const caltrans = await fetchJson(
            `https://services1.arcgis.com/P5Mv5GY5S66M8Z1Q/arcgis/rest/services/CalTransTrafficData/FeatureServer/1/query?${caltransParams.toString()}`,
            fetchOptions,
          );
          caltransClosures = (caltrans?.features || []).map((feature) => feature?.attributes || {}).map((attributes) => ({
            name: attributes.Name || 'Caltrans closure',
            summary: attributes.Snippet || null,
            details: attributes.PopupInfo || null,
          })).slice(0, 10);
        } catch {
          caltransClosures = [];
        }
      }
      return {
        available: true,
        closedRoadCount: roads.length,
        roads,
        caltransClosureCount: caltransClosures.length,
        caltransClosures,
        searchRadiusKm: 25,
        source: isCalifornia
          ? 'USDA Forest Service road status + Caltrans QuickMap closure feed'
          : 'USDA Forest Service Enterprise Data Warehouse — roads closed to motorized uses',
        sourceLink: USFS_CLOSED_ROADS_URL,
        note: 'This is the Forest Service system-road status layer; temporary emergency closures and state/county road restrictions may require separate verification.',
      };
    },
  );

  const fetchWildfireActivity = ({ lat, lon, fetchOptions }) => wildfireCache.getOrFetch(
    normalizeCoordKey(lat, lon),
    async () => {
      const perimeterParams = new URLSearchParams({
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        distance: '150',
        units: 'esriSRUnit_Kilometer',
        outFields: 'poly_IncidentName,poly_GISAcres,poly_DateCurrent,attr_IncidentTypeCategory,attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_InitialLatitude,attr_InitialLongitude,attr_FireDiscoveryDateTime',
        returnGeometry: 'false',
        resultRecordCount: '25',
      });
      const perimeterPayload = await fetchJson(`${WFIGS_CURRENT_PERIMETERS_URL}/query?${perimeterParams.toString()}`, fetchOptions);
      const incidents = (perimeterPayload?.features || []).map((feature) => feature?.attributes || {}).map((attributes) => {
        const incidentLat = toFiniteOrNull(attributes.attr_InitialLatitude);
        const incidentLon = toFiniteOrNull(attributes.attr_InitialLongitude);
        return {
          name: attributes.attr_IncidentName || attributes.poly_IncidentName || 'Unnamed incident',
          type: attributes.attr_IncidentTypeCategory || null,
          acres: round(attributes.attr_IncidentSize ?? attributes.poly_GISAcres),
          percentContained: round(attributes.attr_PercentContained, 0),
          discoveredTime: attributes.attr_FireDiscoveryDateTime ? new Date(attributes.attr_FireDiscoveryDateTime).toISOString() : null,
          perimeterUpdatedTime: attributes.poly_DateCurrent ? new Date(attributes.poly_DateCurrent).toISOString() : null,
          distanceKm: incidentLat !== null && incidentLon !== null ? round(haversineKm(lat, lon, incidentLat, incidentLon)) : null,
        };
      }).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)).slice(0, 10);

      let firmsDetections = [];
      if (firmsMapKey) {
        const pad = 1.25;
        const bbox = `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`;
        const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(firmsMapKey)}/VIIRS_SNPP_NRT/${bbox}/1`;
        try {
          const response = await fetchWithTimeout(firmsUrl, fetchOptions, requestTimeoutMs);
          if (response.ok) {
            firmsDetections = parseCsvRows(await response.text()).map((row) => {
              const detectionLat = toFiniteOrNull(row.latitude);
              const detectionLon = toFiniteOrNull(row.longitude);
              return {
                latitude: detectionLat,
                longitude: detectionLon,
                confidence: row.confidence || null,
                brightness: toFiniteOrNull(row.bright_ti4),
                acquiredDate: row.acq_date || null,
                acquiredTimeUtc: row.acq_time || null,
                distanceKm: detectionLat !== null && detectionLon !== null ? round(haversineKm(lat, lon, detectionLat, detectionLon)) : null,
              };
            }).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)).slice(0, 20);
          }
        } catch {
          firmsDetections = [];
        }
      }

      return {
        available: true,
        nearbyIncidentCount: incidents.length,
        incidents,
        firmsConfigured: Boolean(firmsMapKey),
        firmsDetectionCount: firmsDetections.length,
        firmsDetections,
        searchRadiusKm: 150,
        source: firmsMapKey ? 'NIFC WFIGS current fire perimeters + NASA FIRMS VIIRS detections' : 'NIFC WFIGS current fire perimeters',
        sourceLink: 'https://data-nifc.opendata.arcgis.com/',
        note: incidents.length || firmsDetections.length
          ? 'Nearby fire activity exists; verify current evacuation, closure, smoke, and containment information before travel.'
          : 'No current WFIGS perimeter was returned within the search radius. Small or newly detected fires may not yet have a perimeter.',
      };
    },
  );

  return {
    fetchWeatherObservation,
    fetchRadarNowcast,
    fetchAccessStatus,
    fetchWildfireActivity,
  };
};

module.exports = {
  createEnvironmentalObservationService,
  convertQuantity,
  parseArcGisRasterValue,
  parseProductTime,
  parseCsvRows,
  parseGlmKeyTime,
};
