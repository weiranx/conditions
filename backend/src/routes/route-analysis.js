const { createCache, normalizeCoordKey, normalizeTextKey } = require('../utils/cache');
const { logger } = require('../utils/logger');
const { describeUnitsInstruction } = require('../utils/units-instruction');

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
// Claude prompt, so a route with several waypoints can't blow up prompt size.
const MAX_WAYPOINT_REPORTS_LENGTH = 30000;
const MAX_SUPPLIED_WAYPOINTS = 8;
const MAX_WAYPOINT_DISTANCE_FROM_OBJECTIVE_KM = 200;

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

const parseJsonArrayFromClaude = (text) => {
  // Strip markdown code fences and XML-like tags that Claude sometimes wraps around JSON
  let cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<\/?[a-z][\w-]*>/gi, '');

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in Claude response: ${text.slice(0, 200)}`);
  }
  let raw = cleaned.slice(start, end + 1);

  // Fix trailing commas before } or ]
  raw = raw.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON from Claude: ${e.message}\nRaw: ${raw.slice(0, 300)}`);
  }
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

const registerRouteAnalysisRoutes = ({ app, askClaude, invokeSafetyHandler, fetchWithTimeout, fetchHeaders }) => {
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
      const suggestCacheKey = `${normalizeTextKey(safePeak)}|${normalizeCoordKey(safeLat, safeLon)}`;
      const routes = await routeSuggestionsCache.getOrFetch(suggestCacheKey, async () => {
        const text = await askClaude(
          `List all well-known hiking, climbing, and scrambling routes for ${safePeak} near coordinates (${safeLat}, ${safeLon}) in the United States. Include 3 routes covering a range of difficulty levels.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Route Name","distance_rt_miles":22,"elev_gain_ft":6100,"class":"Class 1","description":"One sentence description."}]`,
          { maxTokens: 2048, model: 'claude-haiku-4-5-20251001' }
        );
        return parseJsonArrayFromClaude(text);
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
      // Step 1: Use authoritative GPX checkpoints when provided. Otherwise retain
      // the existing generated-waypoint workflow for named routes.
      let routeSource = 'generated';
      let waypointsCopy;
      if (suppliedWaypoints) {
        routeSource = 'gpx';
        waypointsCopy = suppliedWaypoints.map((waypoint) => ({ ...waypoint }));
      } else {
        const wpCacheKey = `${normalizeTextKey(safePeak)}|${normalizeTextKey(safeRoute)}|${normalizeCoordKey(safeLat, safeLon)}`;
        const generatedWaypoints = await waypointCache.getOrFetch(wpCacheKey, async () => {
          const waypointText = await withTimeout(askClaude(
            `Return 4-5 key waypoints for the "${safeRoute}" on ${safePeak} near (${safeLat}, ${safeLon}).
List them in order from trailhead to summit.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Waypoint Name","lat":0.0,"lon":0.0,"elev_ft":0}]`,
            { maxTokens: 1024, model: 'claude-haiku-4-5-20251001' }
          ), 20000, 'Waypoint lookup');
          return parseJsonArrayFromClaude(waypointText);
        });
        // Clone so summit pinning doesn't mutate the cached array.
        waypointsCopy = generatedWaypoints.map((wp) => ({ ...wp }));
        if (waypointsCopy.length > 0) {
          const summit = waypointsCopy[waypointsCopy.length - 1];
          summit.lat = safeLat;
          summit.lon = safeLon;
        }

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
      }

      // Step 2: Run safety checks for each waypoint in parallel
      const safetySettled = await withTimeout(
        Promise.allSettled(
          waypointsCopy.map((wp) =>
            invokeSafetyHandler(
              { lat: String(wp.lat), lon: String(wp.lon), date, start: start || '06:00', travel_window_hours: String(travel_window_hours || 12), name: `Route waypoint: ${wp.name || 'unnamed'}` },
              { suppressReportLog: true },
            )
          )
        ),
        60000, 'Safety checks'
      );

      // Step 3: Build a compact per-waypoint summary for the UI (waypoint list,
      // elevation/score chart) — this is a display concern, separate from what
      // gets fed to the AI below.
      const summaries = waypointsCopy.map((wp, i) => {
        const settled = safetySettled[i];
        const dataAvailable = settled.status === 'fulfilled' && settled.value?.statusCode === 200 && Boolean(settled.value?.payload);
        const p = dataAvailable ? settled.value.payload : {};
        const resolvedElevationFt = Number.isFinite(Number(wp.elev_ft))
          ? Number(wp.elev_ft)
          : Number.isFinite(Number(p.weather?.elevation))
            ? Math.round(Number(p.weather.elevation))
            : 0;
        wp.elev_ft = resolvedElevationFt;
        const avyRelevant = p.avalanche?.relevant !== false;
        const snowDepthIn = p.snowpack?.snotel?.snowDepthIn ?? p.snowpack?.nohrsc?.snowDepthIn ?? null;
        const hasSnow = snowDepthIn != null && snowDepthIn > 0;
        return {
          name: wp.name,
          elev_ft: resolvedElevationFt,
          ...(wp.distance_miles != null ? { distance_miles: wp.distance_miles } : {}),
          ...(wp.progress_percent != null ? { progress_percent: wp.progress_percent } : {}),
          dataAvailable,
          score: p.safety?.score ?? null,
          weather: pick(p.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'description', 'precipChance']),
          ...(avyRelevant && hasSnow ? { avalanche: pick(p.avalanche, ['risk', 'dangerLevel', 'bottomLine']) } : {}),
          activeAlerts: Array.isArray(p.alerts?.alerts) ? p.alerts.alerts.length : 0,
          ...(hasSnow ? { snowDepthIn } : {}),
        };
      });

      // Step 4: Synthesize — feed Claude the raw safety report per waypoint (bounded),
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
          dataAvailable,
          report: dataAvailable ? settled.value.payload : null,
        };
      });
      const failedWaypointNames = rawWaypointReports.filter((r) => !r.dataAvailable).map((r) => r.name).filter(Boolean);
      const partialData = failedWaypointNames.length > 0;
      const reportsJson = JSON.stringify(rawWaypointReports).slice(0, MAX_WAYPOINT_REPORTS_LENGTH);

      const analysis = await withTimeout(askClaude(
        `${describeUnitsInstruction(units)}

You are analyzing backcountry conditions for a trip on ${safePeak}.
Route: ${safeRoute}
Route source: ${routeSource === 'gpx' ? 'user-supplied GPX track with authoritative checkpoint coordinates' : 'generated named-route waypoints'}
${routeMetadata ? `Recorded GPX metadata: ${JSON.stringify(routeMetadata)}` : ''}
Date: ${date}${start ? `, Start time: ${start}` : ''}
${partialData ? `\nNo data is available for these waypoints: ${failedWaypointNames.join(', ')} (report is null below). Do not fabricate conditions for them — note the gap and reason from the waypoints that do have data.\n` : ''}
Raw safety report per waypoint, trailhead to summit (JSON):
${reportsJson}

Write a thorough route-wide briefing covering:
1. Key hazard zones by elevation and where conditions change significantly — reference the specific waypoint names, in prose
2. Weather windows — when storms arrive, when winds intensify, or when conditions deteriorate (do NOT assume pace or method of travel), in prose
3. Any secondary hazards worth flagging from the reports (avalanche, terrain surface, fire/heat risk, air quality, freezing level, thunderstorm timing) — only discuss what's actually present in the data, in prose
4. Gear needs specific to current route conditions, as a short bullet list (- item)
5. Overall go / go-with-caution / no-go recommendation with one-line reasoning, in prose

Use plain paragraphs for 1-3 and 5 (**bold** a key phrase per paragraph if it helps scannability), and only use a bullet list for section 4. Do not add a title or heading at the start.`,
        { maxTokens: 4096, model: 'claude-sonnet-5' }
      ), 60000, 'Route synthesis');

      return res.json({
        waypoints: waypointsCopy,
        summaries,
        analysis,
        partialData,
        routeSource,
        ...(routeMetadata ? { routeMetadata } : {}),
      });
    } catch (err) {
      logger.error({ err }, 'route-analysis error');
      return res.status(500).json({ error: 'Failed to analyze route: ' + err.message });
    }
  });
};

module.exports = { registerRouteAnalysisRoutes, withTimeout };
