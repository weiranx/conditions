const { createCache, normalizeCoordKey, normalizeTextKey } = require('../utils/cache');
const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { assertFeatureEnabled, getFeatureFlags } = require('../utils/feature-flags');
const { logger } = require('../utils/logger');
const { describeUnitsInstruction } = require('../utils/units-instruction');
const {
  getDisabledScoreFeatureLabels,
  removeDisabledNarrativeReferences,
  sanitizeReportForFeatureFlags,
} = require('../utils/report-feature-filter');
const { createRouteDataService, buildRouteTerrainProfile } = require('../utils/route-data');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

const withTimeout = (promise, ms, label) => {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
};

// Bounds the combined raw per-waypoint report JSON before it's interpolated into the
// AI prompt, so a route with several waypoints can't blow up prompt size.
const MAX_WAYPOINT_REPORTS_LENGTH = 30000;
const MAX_SUPPLIED_WAYPOINTS = 8;
const MAX_WAYPOINT_DISTANCE_FROM_OBJECTIVE_KM = 200;
const ROUTE_ANALYSIS_MAX_TOKENS = 8192;

const routeSuggestionsCache = createCache({ name: 'route-suggestions', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 100 });
const waypointCache = createCache({ name: 'waypoints', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 200 });
const nominatimGeocodeCache = createCache({ name: 'nominatim-geocode', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 500 });

const pick = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return {};
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
};

const buildCheckpointSchedule = (waypoints, date, start = '06:00', travelWindowHours = 12) => {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(start || '06:00').split(':').map(Number);
  const baseMs = Date.UTC(year, month - 1, day, hour, minute);
  const safeHours = Math.max(1, Math.min(24, Math.round(Number(travelWindowHours) || 12)));
  return waypoints.map((waypoint, index) => {
    const fallbackProgress = waypoints.length > 1 ? (index / (waypoints.length - 1)) * 100 : 0;
    const progress = Number.isFinite(Number(waypoint.progress_percent))
      ? Math.max(0, Math.min(100, Number(waypoint.progress_percent)))
      : fallbackProgress;
    const offsetMinutes = Math.round(safeHours * 60 * progress / 100);
    const eta = new Date(baseMs + offsetMinutes * 60 * 1000);
    return {
      date: eta.toISOString().slice(0, 10),
      time: eta.toISOString().slice(11, 16),
      offsetMinutes,
      progressPercent: Math.round(progress),
    };
  });
};

const buildDeterministicRouteBriefing = (summaries, failedWaypointNames = []) => {
  const available = summaries.filter((summary) => summary.dataAvailable);
  const scored = available.filter((summary) => Number.isFinite(Number(summary.score)));
  const worst = scored.reduce((current, summary) => (!current || Number(summary.score) < Number(current.score) ? summary : current), null);
  const peakGust = available.reduce((peak, summary) => Math.max(peak, Number(summary.weather?.windGust) || 0), 0);
  const peakPrecip = available.reduce((peak, summary) => Math.max(peak, Number(summary.weather?.precipChance) || 0), 0);
  const first = available[0];
  const last = available[available.length - 1];
  const timing = first && last ? `${first.name} at ${first.etaTime} to ${last.name} at ${last.etaTime}` : 'the planned route window';
  const missing = failedWaypointNames.length
    ? ` Data is missing at ${failedWaypointNames.join(', ')} and must be treated as unknown.`
    : '';
  return [
    `HAZARD ZONES: ${worst ? `${worst.name} has the least modeled margin at ${worst.etaTime} with a score of ${Math.round(worst.score)}.` : 'No checkpoint score is available.'}${missing}`,
    `WEATHER WINDOW: Checkpoint forecasts follow estimated arrival times from ${timing}. Peak modeled gust is ${Math.round(peakGust)} mph and peak precipitation chance is ${Math.round(peakPrecip)}%.`,
    'OTHER CONCERNS: This briefing uses forecast and modeled checkpoint data. Verify official alerts, route access, surface conditions, and any unavailable checkpoint before departure.',
    `DECISION POINTS: Reassess at each timed checkpoint${worst ? `, especially before ${worst.name}` : ''}. Turn around when observed conditions arrive earlier or are worse than the checkpoint forecast.`,
    'GEAR CHECK: Offline route and navigation backup; emergency communication; weather protection matched to the report; lighting and reserve power; normal backcountry emergency kit.',
    `BOTTOM LINE: ${worst && Number(worst.score) < 40 ? 'The route contains a low-margin checkpoint and should not be treated as a go.' : 'Use the timed checkpoints as verification gates rather than a guarantee.'} Rebuild the route brief when timing or pace changes.`,
  ].join('\n');
};

const parseJsonArrayFromAI = (text) => {
  // Strip markdown code fences and XML-like tags that models sometimes wrap around JSON
  let cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<\/?[a-z][\w-]*>/gi, '');

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in AI response: ${text.slice(0, 200)}`);
  }
  let raw = cleaned.slice(start, end + 1);

  // Fix trailing commas before } or ]
  raw = raw.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON from AI: ${e.message}\nRaw: ${raw.slice(0, 300)}`);
  }
};

const sanitizeGeneratedWaypoints = (rawWaypoints) => {
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length < 2 || rawWaypoints.length > MAX_SUPPLIED_WAYPOINTS) {
    throw new Error(`AI waypoints must contain between 2 and ${MAX_SUPPLIED_WAYPOINTS} entries`);
  }

  return rawWaypoints.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`AI waypoint ${index + 1} must be an object`);
    }
    const name = String(raw.name || '').trim().slice(0, 100);
    if (!name || /\b(?:checkpoint|waypoint)\s*(?:#\s*)?\d+\b/i.test(name)) {
      throw new Error(`AI waypoint ${index + 1} must use a specific place name`);
    }
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`AI waypoint ${index + 1} must have valid coordinates`);
    }
    const elevation = raw.elev_ft == null ? null : Number(raw.elev_ft);
    return {
      ...raw,
      name,
      lat,
      lon,
      ...(Number.isFinite(elevation) ? { elev_ft: Math.round(elevation) } : {}),
    };
  });
};

// Haversine distance in km between two lat/lon points
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const sanitizeSuppliedWaypoints = (rawWaypoints, peakLat, peakLon) => {
  if (rawWaypoints == null) return null;
  if (!Array.isArray(rawWaypoints)) {
    throw new Error('waypoints must be an array');
  }
  if (rawWaypoints.length < 2 || rawWaypoints.length > MAX_SUPPLIED_WAYPOINTS) {
    throw new Error(`waypoints must contain between 2 and ${MAX_SUPPLIED_WAYPOINTS} entries`);
  }

  return rawWaypoints.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`waypoints[${index}] must be an object`);
    }
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`waypoints[${index}] must have valid lat and lon coordinates`);
    }
    if (haversineKm(peakLat, peakLon, lat, lon) > MAX_WAYPOINT_DISTANCE_FROM_OBJECTIVE_KM) {
      throw new Error(`waypoints[${index}] is too far from the selected objective`);
    }
    const elevation = raw.elev_ft == null ? null : Number(raw.elev_ft);
    if (elevation !== null && (!Number.isFinite(elevation) || elevation < -2000 || elevation > 30000)) {
      throw new Error(`waypoints[${index}].elev_ft must be a plausible elevation in feet`);
    }
    const distance = raw.distance_miles == null ? null : Number(raw.distance_miles);
    if (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 1000)) {
      throw new Error(`waypoints[${index}].distance_miles must be between 0 and 1000`);
    }
    const progress = raw.progress_percent == null ? null : Number(raw.progress_percent);
    if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      throw new Error(`waypoints[${index}].progress_percent must be between 0 and 100`);
    }
    return {
      name: String(raw.name || `Route checkpoint ${index + 1}`).trim().slice(0, 100) || `Route checkpoint ${index + 1}`,
      lat,
      lon,
      ...(elevation !== null ? { elev_ft: Math.round(elevation) } : {}),
      ...(distance !== null ? { distance_miles: Number(distance.toFixed(2)) } : {}),
      ...(progress !== null ? { progress_percent: Math.round(progress) } : {}),
      source: 'gpx',
    };
  });
};

const sanitizeRouteMetadata = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const finiteOrNull = (value, min, max, precision = 0) => {
    if (value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) return null;
    return Number(number.toFixed(precision));
  };
  return {
    fileName: String(raw.fileName || 'Imported route.gpx').slice(0, 200),
    pointCount: finiteOrNull(raw.pointCount, 2, 100000),
    distanceMiles: finiteOrNull(raw.distanceMiles, 0, 1000, 2),
    elevationGainFt: finiteOrNull(raw.elevationGainFt, 0, 100000),
    minElevationFt: finiteOrNull(raw.minElevationFt, -2000, 30000),
    maxElevationFt: finiteOrNull(raw.maxElevationFt, -2000, 30000),
    routeShape: raw.routeShape === 'closed route' || raw.routeShape === 'point-to-point' ? raw.routeShape : null,
  };
};

// Geocode a waypoint name near the peak using Nominatim (cached 24h), return { lat, lon } or null
const geocodeWaypoint = async (name, peakLat, peakLon, fetchWithTimeout, fetchHeaders) => {
  const cacheKey = `${normalizeTextKey(name)}|${normalizeCoordKey(peakLat, peakLon)}`;
  return nominatimGeocodeCache.getOrFetch(cacheKey, async () => {
    const viewbox = `${peakLon - 0.5},${peakLat + 0.5},${peakLon + 0.5},${peakLat - 0.5}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=3&bounded=1&viewbox=${viewbox}`;
    const res = await fetchWithTimeout(url, { headers: fetchHeaders });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;

    let best = null;
    let bestDist = Infinity;
    for (const r of results) {
      const d = haversineKm(peakLat, peakLon, parseFloat(r.lat), parseFloat(r.lon));
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    if (best && bestDist < 15) {
      return { lat: parseFloat(best.lat), lon: parseFloat(best.lon) };
    }
    return null;
  }).catch(() => null);
};

const registerRouteAnalysisRoutes = ({
  app,
  askAI,
  invokeSafetyHandler,
  fetchWithTimeout,
  fetchHeaders,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureRouteAnalysisEnabled = () => assertFeatureEnabled('routeAnalysis'),
  ensureGpxImportEnabled = () => assertFeatureEnabled('gpxImport'),
  ensureAIEnabled = () => assertAIFeatureEnabled('routeAnalysis'),
  getProductFeatureFlags = getFeatureFlags,
}) => {
  const routeDataService = createRouteDataService({
    fetchWithTimeout,
    fetchHeaders,
    haversineKm,
  });
  // GET /api/route-suggestions?peak=Mt+Whitney&lat=36.578&lon=-118.292
  app.get('/api/route-suggestions', async (req, res) => {
    const { peak, lat, lon } = req.query;
    if (!peak || !lat || !lon) {
      return res.status(400).json({ error: 'peak, lat, and lon are required' });
    }
    const safePeak = String(peak).slice(0, 200);
    const safeLat = Number(lat);
    const safeLon = Number(lon);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }
    try {
      ensureRouteAnalysisEnabled();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || 'Route analysis is unavailable' });
    }
    if (!(await ensureAccountAccess(req, res))) return;
    try {
      ensureAIEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    try {
      const suggestCacheKey = `${normalizeTextKey(safePeak)}|${normalizeCoordKey(safeLat, safeLon)}`;
      const routes = await routeSuggestionsCache.getOrFetch(suggestCacheKey, async () => {
        const text = await askAI(
          `List all well-known hiking, climbing, and scrambling routes for ${safePeak} near coordinates (${safeLat}, ${safeLon}) in the United States. Include 3 routes covering a range of difficulty levels.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Route Name","distance_rt_miles":22,"elev_gain_ft":6100,"class":"Class 1","description":"One sentence description."}]`,
          { maxTokens: 2048, tier: 'fast', feature: 'route-suggestions', userId: req.accountUser.id }
        );
        return parseJsonArrayFromAI(text);
      });
      return res.json(routes);
    } catch (err) {
      logger.error({ err }, 'route-suggestions error');
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/route-analysis
  // Body: { peak, route, lat, lon, date, start }
  app.post('/api/route-analysis', async (req, res) => {
    const { peak, route, lat, lon, date, start, travel_window_hours, units, waypoints, route_metadata } = req.body;
    if (!peak || !route || lat == null || lon == null || !date) {
      return res.status(400).json({ error: 'peak, route, lat, lon, and date are required' });
    }
    const safePeak = String(peak).slice(0, 200);
    const safeRoute = String(route).slice(0, 200);
    const safeLat = Number(lat);
    const safeLon = Number(lon);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });
    }
    if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      return res.status(400).json({ error: 'start must be HH:MM format (00:00–23:59)' });
    }
    let suppliedWaypoints;
    try {
      suppliedWaypoints = sanitizeSuppliedWaypoints(waypoints, safeLat, safeLon);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const routeMetadata = suppliedWaypoints ? sanitizeRouteMetadata(route_metadata) : null;
    try {
      ensureRouteAnalysisEnabled();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || 'Route analysis is unavailable' });
    }
    if (suppliedWaypoints) {
      try {
        ensureGpxImportEnabled();
      } catch (error) {
        return res.status(error.statusCode || 503).json({ error: error.message || 'GPX import is unavailable' });
      }
    }
    if (!(await ensureAccountAccess(req, res))) return;
    let aiFeatureEnabled = true;
    try {
      ensureAIEnabled();
    } catch (error) {
      aiFeatureEnabled = false;
    }

    try {
      // Step 1: Use authoritative GPX checkpoints when provided. For named routes,
      // AI-assisted analysis uses real named landmarks; mapped trail geometry is
      // the non-AI fallback.
      let routeSource = 'generated';
      let routeSourceDetails = null;
      let waypointsCopy;
      if (suppliedWaypoints) {
        routeSource = 'gpx';
        waypointsCopy = suppliedWaypoints.map((waypoint) => ({ ...waypoint }));
      } else if (aiFeatureEnabled) {
        // Version the cache key so older generic "checkpoint 2" results are not
        // reused after tightening the waypoint-name contract.
        const wpCacheKey = `named-v2|${normalizeTextKey(safePeak)}|${normalizeTextKey(safeRoute)}|${normalizeCoordKey(safeLat, safeLon)}`;
        const generatedWaypoints = await waypointCache.getOrFetch(wpCacheKey, async () => {
          let lastError;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const waypointText = await withTimeout(askAI(
              `Return 4-5 real, named landmarks along the "${safeRoute}" on ${safePeak} near (${safeLat}, ${safeLon}).
Use the specific proper name of each trailhead, junction, camp, lake, pass, ridge feature, or summit that a traveler would recognize on a map. The final entry must use the objective's proper name. Never use generic labels such as "Checkpoint 2", "Waypoint 3", "route start", or "route objective". If the route does not have enough reliably named landmarks, return fewer entries rather than inventing names.
List them in order from trailhead to summit.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Specific Place Name","lat":0.0,"lon":0.0,"elev_ft":0}]`,
              { maxTokens: 1024, tier: 'fast', feature: 'route-waypoints', userId: req.accountUser.id }
            ), 20000, 'Waypoint lookup');
            try {
              return sanitizeGeneratedWaypoints(parseJsonArrayFromAI(waypointText));
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        });
        // Clone so summit pinning doesn't mutate the cached array.
        waypointsCopy = generatedWaypoints.map((wp) => ({ ...wp }));
        const summit = waypointsCopy[waypointsCopy.length - 1];
        summit.lat = safeLat;
        summit.lon = safeLon;

        await Promise.all(
          waypointsCopy.slice(0, -1).map(async (wp) => {
            const geo = await geocodeWaypoint(wp.name, safeLat, safeLon, fetchWithTimeout, fetchHeaders);
            if (geo) {
              wp.lat = geo.lat;
              wp.lon = geo.lon;
              wp.geocodingVerified = true;
            } else {
              wp.geocodingVerified = false;
            }
          })
        );
      } else {
        const mappedRoute = await routeDataService.resolveMappedRoute({
          peak: safePeak,
          route: safeRoute,
          lat: safeLat,
          lon: safeLon,
        });
        if (mappedRoute?.waypoints?.length >= 2) {
          routeSource = mappedRoute.source;
          routeSourceDetails = {
            sourceLabel: mappedRoute.sourceLabel,
            matchedName: mappedRoute.matchedName,
            matchScore: mappedRoute.matchScore,
            metadata: mappedRoute.metadata,
          };
          waypointsCopy = mappedRoute.waypoints.map((waypoint) => ({ ...waypoint }));
        } else {
          return res.status(503).json({
            error: 'AI waypoint generation is unavailable. Import a GPX route or enter a mapped trail name.',
          });
        }
      }

      // Step 2: Estimate arrival time from route progress, then evaluate each
      // checkpoint at that ETA instead of applying the trailhead start time to
      // every point on the route.
      const checkpointSchedule = buildCheckpointSchedule(waypointsCopy, date, start || '06:00', travel_window_hours || 12);
      waypointsCopy.forEach((waypoint, index) => {
        waypoint.eta_date = checkpointSchedule[index].date;
        waypoint.eta_time = checkpointSchedule[index].time;
        waypoint.offset_minutes = checkpointSchedule[index].offsetMinutes;
      });
      const safetySettled = await withTimeout(
        Promise.allSettled(
          waypointsCopy.map((wp, index) =>
            invokeSafetyHandler(
              { lat: String(wp.lat), lon: String(wp.lon), date: checkpointSchedule[index].date, start: checkpointSchedule[index].time, travel_window_hours: '1', name: `Route waypoint: ${wp.name || 'unnamed'}` },
              { suppressReportLog: true },
            )
          )
        ),
        60000, 'Safety checks'
      );

      // Step 3: Build a compact per-waypoint summary for the UI (waypoint list,
      // elevation/score chart) — this is a display concern, separate from what
      // gets fed to the AI below.
      const featureFlags = getProductFeatureFlags();
      const avalancheEnabled = featureFlags.avalancheDetails !== false;
      const summaries = waypointsCopy.map((wp, i) => {
        const settled = safetySettled[i];
        const dataAvailable = settled.status === 'fulfilled' && settled.value?.statusCode === 200 && Boolean(settled.value?.payload);
        const rawPayload = dataAvailable ? settled.value.payload : {};
        const p = sanitizeReportForFeatureFlags(rawPayload, featureFlags);
        const resolvedElevationFt = Number.isFinite(Number(wp.elev_ft))
          ? Number(wp.elev_ft)
          : Number.isFinite(Number(p.weather?.elevation))
            ? Math.round(Number(p.weather.elevation))
            : 0;
        wp.elev_ft = resolvedElevationFt;
        const avyRelevant = Boolean(p.avalanche && p.avalanche.relevant !== false);
        const snowDepthIn = p.snowpack?.snotel?.snowDepthIn ?? p.snowpack?.nohrsc?.snowDepthIn ?? null;
        const hasSnow = snowDepthIn != null && snowDepthIn > 0;
        return {
          name: wp.name,
          elev_ft: resolvedElevationFt,
          ...(wp.distance_miles != null ? { distance_miles: wp.distance_miles } : {}),
          ...(wp.progress_percent != null ? { progress_percent: wp.progress_percent } : {}),
          etaDate: wp.eta_date,
          etaTime: wp.eta_time,
          offsetMinutes: wp.offset_minutes,
          dataAvailable,
          score: p.safety?.score ?? null,
          weather: pick(p.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'description', 'precipChance']),
          ...(avyRelevant && hasSnow ? { avalanche: pick(p.avalanche, ['risk', 'dangerLevel', 'bottomLine']) } : {}),
          activeAlerts: Array.isArray(p.alerts?.alerts) ? p.alerts.alerts.length : 0,
          ...(hasSnow ? { snowDepthIn } : {}),
        };
      });
      const terrainProfile = buildRouteTerrainProfile(waypointsCopy, haversineKm);

      // Step 4: Synthesize — feed the AI the raw safety report per waypoint (bounded),
      // the same raw-data approach used for the score card's AI analysis, instead of
      // pre-summarizing which signals matter.
      const rawWaypointReports = waypointsCopy.map((wp, i) => {
        const settled = safetySettled[i];
        const dataAvailable = settled.status === 'fulfilled' && settled.value?.statusCode === 200 && Boolean(settled.value?.payload);
        return {
          name: wp.name,
          elev_ft: wp.elev_ft,
          ...(wp.distance_miles != null ? { distance_miles: wp.distance_miles } : {}),
          ...(wp.progress_percent != null ? { progress_percent: wp.progress_percent } : {}),
          etaDate: wp.eta_date,
          etaTime: wp.eta_time,
          offsetMinutes: wp.offset_minutes,
          dataAvailable,
          report: dataAvailable ? sanitizeReportForFeatureFlags(settled.value.payload, featureFlags) : null,
        };
      });
      const failedWaypointNames = rawWaypointReports.filter((r) => !r.dataAvailable).map((r) => r.name).filter(Boolean);
      const partialData = failedWaypointNames.length > 0;
      const reportsJson = JSON.stringify(rawWaypointReports).slice(0, MAX_WAYPOINT_REPORTS_LENGTH);
      const disabledDomains = getDisabledScoreFeatureLabels(featureFlags);
      const disabledDomainInstruction = disabledDomains.length === 0
        ? ''
        : `\nDisabled product domains: ${disabledDomains.join(', ')}. Do not mention them, infer them, recommend domain-specific checks or gear, or refer the user to their sources.\n`;

      const generatedAnalysis = aiFeatureEnabled ? await withTimeout(askAI(
        `${describeUnitsInstruction(units)}

You are analyzing backcountry conditions for a trip on ${safePeak}.
Route: ${safeRoute}
Route source: ${routeSource === 'gpx'
          ? 'user-supplied GPX track with authoritative checkpoint coordinates'
          : routeSource === 'nps'
            ? 'National Park Service public trail geometry'
            : routeSource === 'openstreetmap'
              ? 'OpenStreetMap mapped trail geometry'
              : 'generated named-route waypoints'}
${routeSourceDetails ? `Mapped route match: ${JSON.stringify(routeSourceDetails)}` : ''}
${routeMetadata ? `Recorded GPX metadata: ${JSON.stringify(routeMetadata)}` : ''}
${terrainProfile ? `Sampled terrain profile: ${JSON.stringify(terrainProfile)}` : ''}
Date: ${date}${start ? `, Start time: ${start}` : ''}
${partialData ? `\nNo data is available for these waypoints: ${failedWaypointNames.join(', ')} (report is null below). Do not fabricate conditions for them — note the gap and reason from the waypoints that do have data.\n` : ''}
Raw safety report per waypoint, trailhead to summit (JSON):
${reportsJson}
${disabledDomainInstruction}

Turn the route data into a decision-ready field briefing rather than a compressed recap or raw-data inventory. Reference specific waypoint names, elevations, distances or progress, times, and actual values. Explain how and why conditions change along the route, how hazards may combine, and what the traveler should do with that information. Distinguish observed, forecast, modeled, and missing evidence when the reports provide that context. Do not assume pace or method of travel. Only discuss hazards present in the reports, and clearly note unavailable waypoint data. Never invent a terrain feature, route detail, timing threshold, or condition that is not supported by the supplied route metadata, terrain profile, or waypoint reports.

Return exactly these six labeled sections, each on its own line, with no other introduction or closing:
HAZARD ZONES: 3-5 sentences identifying where conditions materially change by named waypoint, elevation, distance, or progress and explaining the practical consequence of each change.
WEATHER WINDOW: 2-4 sentences explaining how conditions evolve across the selected travel window, the best-supported timing advantage, and the time-based signs that should trigger reassessment.
OTHER CONCERNS: 2-4 sentences covering only relevant secondary hazards such as ${avalancheEnabled ? 'avalanche conditions, ' : ''}terrain surface, freezing level, heat, fire, air quality, thunderstorms, or missing data, including interactions with the main hazard.
DECISION POINTS: 2-4 sentences naming specific checkpoints or condition thresholds where the traveler should pause, verify conditions, turn around, or choose lower-exposure terrain. If exact thresholds are unavailable, state what observable change matters instead of inventing a number.
GEAR CHECK: 4-7 short condition-specific items separated by semicolons, with no bullets; tie each item to a reported condition or a clearly identified verification need.
BOTTOM LINE: 2-3 sentences stating go, go-with-caution, or no-go, identifying the decisive evidence, and explaining what new observation or forecast change would alter that conclusion. Never soften a NO-GO reported at any relevant waypoint.

Aim for a substantive 300-550 word briefing when the route evidence supports it. Do not pad sparse data, repeat the same point in multiple sections, or give generic backcountry advice that is unrelated to the reports.

Use plain, calm language that feels like advice from an experienced trip partner. Plain text only: no markdown, headings, bullets, numbered lists, "#" characters, or asterisks.`,
        { maxTokens: ROUTE_ANALYSIS_MAX_TOKENS, feature: 'route-analysis', userId: req.accountUser.id }
      ), 60000, 'Route synthesis') : buildDeterministicRouteBriefing(summaries, failedWaypointNames);
      const analysis = removeDisabledNarrativeReferences(generatedAnalysis, featureFlags);

      return res.json({
        waypoints: waypointsCopy,
        summaries,
        analysis,
        analysisSource: aiFeatureEnabled ? 'ai' : 'deterministic',
        featureFlags,
        partialData,
        routeSource,
        ...(routeSourceDetails ? { routeSourceDetails } : {}),
        ...(terrainProfile ? { terrainProfile } : {}),
        ...(routeMetadata ? { routeMetadata } : {}),
      });
    } catch (err) {
      logger.error({ err }, 'route-analysis error');
      return res.status(500).json({ error: 'Failed to analyze route: ' + err.message });
    }
  });
};

module.exports = {
  ROUTE_ANALYSIS_MAX_TOKENS,
  buildCheckpointSchedule,
  buildDeterministicRouteBriefing,
  registerRouteAnalysisRoutes,
  withTimeout,
};
