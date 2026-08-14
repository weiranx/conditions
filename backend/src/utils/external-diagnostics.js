'use strict';

const DIAGNOSTIC_TIMEOUT_MS = 9000;
const DIAGNOSTIC_MAX_ATTEMPTS = 2;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const USER_AGENT = 'BackcountryConditions/1.0 (+https://backcountryconditions.app; support@backcountryconditions.app)';

const oneDayAgo = () => {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

const buildExternalServiceChecks = (env = process.env) => {
  const npsKey = env.NPS_API_KEY || '';
  const airNowKey = env.AIRNOW_API_KEY || '';
  const firmsKey = env.NASA_FIRMS_MAP_KEY || '';
  const sentinelClientId = env.SENTINEL_HUB_CLIENT_ID || '';
  const sentinelClientSecret = env.SENTINEL_HUB_CLIENT_SECRET || '';
  const openAIKey = env.OPENAI_API_KEY || '';
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const kimiKey = env.KIMI_API_KEY || env.MOONSHOT_API_KEY || '';
  const kimiBaseURL = String(env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
  const geminiKey = env.GEMINI_API_KEY || '';
  const geminiBaseURL = String(env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');

  return [
    {
      id: 'nws-weather',
      name: 'NOAA / NWS weather',
      category: 'Weather',
      url: 'https://api.weather.gov/points/46.8523,-121.7603',
    },
    {
      id: 'open-meteo-weather',
      name: 'Open-Meteo weather',
      category: 'Weather',
      url: 'https://api.open-meteo.com/v1/forecast?latitude=46.8523&longitude=-121.7603&current=temperature_2m',
    },
    {
      id: 'sunrise-sunset',
      name: 'SunriseSunset.io',
      category: 'Weather',
      url: `https://api.sunrisesunset.io/json?lat=46.8523&lng=-121.7603&date=${today()}`,
    },
    {
      id: 'avalanche-org',
      name: 'Avalanche.org',
      category: 'Avalanche',
      url: 'https://api.avalanche.org/v2/public/products/map-layer',
    },
    {
      id: 'nominatim',
      name: 'OpenStreetMap Nominatim',
      category: 'Search',
      url: 'https://nominatim.openstreetmap.org/search?format=json&q=Mount%20Rainier&countrycodes=us&limit=1',
    },
    {
      id: 'usgs-elevation',
      name: 'USGS elevation',
      category: 'Terrain',
      url: 'https://epqs.nationalmap.gov/v1/json?x=-121.7603&y=46.8523&units=Feet&wkid=4326',
    },
    {
      id: 'nrcs-awdb',
      name: 'NRCS AWDB / SNOTEL',
      category: 'Snowpack',
      url: 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?stationTriplets=679%3AWA%3ASNTL',
    },
    {
      id: 'noaa-nohrsc',
      name: 'NOAA NOHRSC snow analysis',
      category: 'Snowpack',
      url: 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer?f=json',
    },
    {
      id: 'nasa-earthdata',
      name: 'NASA Earthdata CMR',
      category: 'Snowpack',
      url: 'https://cmr.earthdata.nasa.gov/search/collections.json?page_size=1',
    },
    {
      id: 'cdec',
      name: 'California CDEC',
      category: 'Snowpack',
      url: `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=ADM&SensorNums=3&dur_code=D&Start=${oneDayAgo()}&End=${today()}`,
    },
    {
      id: 'open-meteo-air-quality',
      name: 'Open-Meteo air quality',
      category: 'Air quality',
      url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=46.8523&longitude=-121.7603&current=us_aqi',
    },
    {
      id: 'usgs-water',
      name: 'USGS Water Services',
      category: 'Water',
      url: 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=12092000&period=P1D&parameterCd=00060',
    },
    {
      id: 'noaa-nwps',
      name: 'NOAA National Water Prediction Service',
      category: 'Water',
      url: 'https://api.water.noaa.gov/nwps/v1/gauges/RNTW1',
    },
    {
      id: 'noaa-coops',
      name: 'NOAA Tides and Currents',
      category: 'Water',
      url: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9447130.json',
    },
    {
      id: 'nps-trails',
      name: 'National Park Service trails',
      category: 'Access',
      url: 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails_Geographic/FeatureServer/0?f=json',
    },
    {
      id: 'overpass',
      name: 'OpenStreetMap Overpass',
      category: 'Access',
      url: 'https://overpass-api.de/api/status',
    },
    {
      id: 'usfs-roads',
      name: 'USFS road access',
      category: 'Access',
      url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer/1?f=json',
    },
    {
      id: 'caltrans',
      name: 'Caltrans road conditions',
      category: 'Access',
      url: 'https://services1.arcgis.com/P5Mv5GY5S66M8Z1Q/arcgis/rest/services/CalTransTrafficData/FeatureServer/1?f=json',
    },
    {
      id: 'noaa-radar',
      name: 'NOAA radar services',
      category: 'Observations',
      url: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer?f=json',
    },
    {
      id: 'noaa-goes',
      name: 'NOAA GOES satellite archive',
      category: 'Observations',
      url: 'https://noaa-goes18.s3.amazonaws.com/?list-type=2&max-keys=1',
    },
    {
      id: 'nifc-wfigs',
      name: 'NIFC wildfire perimeters',
      category: 'Wildfire',
      url: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0?f=json',
    },
    {
      id: 'nps-developer',
      name: 'National Park Service alerts',
      category: 'Access',
      optional: true,
      configured: Boolean(npsKey),
      url: `https://developer.nps.gov/api/v1/parks?limit=1&api_key=${encodeURIComponent(npsKey)}`,
    },
    {
      id: 'airnow',
      name: 'AirNow',
      category: 'Air quality',
      optional: true,
      configured: Boolean(airNowKey),
      url: `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=46.8523&longitude=-121.7603&distance=25&API_KEY=${encodeURIComponent(airNowKey)}`,
    },
    {
      id: 'nasa-firms',
      name: 'NASA FIRMS',
      category: 'Wildfire',
      optional: true,
      configured: Boolean(firmsKey),
      url: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(firmsKey)}/VIIRS_SNPP_NRT/-122.0,46.7,-121.5,47.0/1`,
    },
    {
      id: 'sentinel-hub',
      name: 'Copernicus Sentinel Hub',
      category: 'Satellite',
      optional: true,
      configured: Boolean(sentinelClientId && sentinelClientSecret),
      url: 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: sentinelClientId,
          client_secret: sentinelClientSecret,
        }).toString(),
      },
    },
    {
      id: 'openai',
      name: 'OpenAI',
      category: 'AI',
      optional: true,
      configured: Boolean(openAIKey),
      url: 'https://api.openai.com/v1/models',
      options: { headers: { Authorization: `Bearer ${openAIKey}` } },
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      category: 'AI',
      optional: true,
      configured: Boolean(anthropicKey),
      url: 'https://api.anthropic.com/v1/models?limit=1',
      options: {
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
      },
    },
    {
      id: 'kimi',
      name: 'Kimi',
      category: 'AI',
      optional: true,
      configured: Boolean(kimiKey),
      url: `${kimiBaseURL}/models`,
      options: { headers: { Authorization: `Bearer ${kimiKey}` } },
    },
    {
      id: 'gemini',
      name: 'Gemini',
      category: 'AI',
      optional: true,
      configured: Boolean(geminiKey),
      url: `${geminiBaseURL}/models`,
      options: { headers: { Authorization: `Bearer ${geminiKey}` } },
    },
  ];
};

const releaseResponseBody = async (response) => {
  try {
    if (typeof response?.body?.cancel === 'function') await response.body.cancel();
    else if (typeof response?.body?.destroy === 'function') response.body.destroy();
  } catch {
    // The diagnostic only needs the response status; body cleanup is best effort.
  }
};

const isRetryableResponse = (response) => RETRYABLE_HTTP_STATUSES.has(response?.status);

const runCheck = async (check, fetchWithTimeout) => {
  if (check.optional && !check.configured) {
    return {
      id: check.id,
      name: check.name,
      category: check.category,
      status: 'not_configured',
      httpStatus: null,
      latencyMs: null,
      message: 'Optional service is not configured',
    };
  }

  const startedAt = Date.now();
  const headers = {
    'User-Agent': USER_AGENT,
    ...(check.options?.headers || {}),
  };

  for (let attempt = 1; attempt <= DIAGNOSTIC_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        check.url,
        { ...(check.options || {}), headers },
        DIAGNOSTIC_TIMEOUT_MS,
      );
      const latencyMs = Date.now() - startedAt;
      await releaseResponseBody(response);
      if (!response.ok && isRetryableResponse(response) && attempt < DIAGNOSTIC_MAX_ATTEMPTS) {
        continue;
      }
      return {
        id: check.id,
        name: check.name,
        category: check.category,
        status: response.ok ? 'operational' : 'failed',
        httpStatus: Number.isInteger(response.status) ? response.status : null,
        latencyMs,
        message: response.ok ? 'Reachable' : `Upstream returned HTTP ${response.status || 'error'}`,
      };
    } catch (error) {
      if (attempt < DIAGNOSTIC_MAX_ATTEMPTS) continue;
      const timedOut = error?.name === 'AbortError';
      return {
        id: check.id,
        name: check.name,
        category: check.category,
        status: 'failed',
        httpStatus: null,
        latencyMs: Date.now() - startedAt,
        message: timedOut ? 'Timed out' : 'Request failed',
      };
    }
  }

  throw new Error('External diagnostic exhausted attempts without a result');
};

const runExternalDiagnostics = async ({ fetchWithTimeout, env = process.env } = {}) => {
  if (typeof fetchWithTimeout !== 'function') {
    throw new TypeError('fetchWithTimeout is required');
  }
  const startedAt = new Date();
  const checks = buildExternalServiceChecks(env);
  const services = await Promise.all(checks.map((check) => runCheck(check, fetchWithTimeout)));
  const summary = services.reduce((result, service) => {
    result.total += 1;
    if (service.status === 'operational') result.operational += 1;
    else if (service.status === 'not_configured') result.notConfigured += 1;
    else result.failed += 1;
    return result;
  }, { total: 0, operational: 0, failed: 0, notConfigured: 0 });

  return {
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    summary,
    services,
  };
};

module.exports = {
  runExternalDiagnostics,
};
