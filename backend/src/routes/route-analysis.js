const { createCache, normalizeCoordKey, normalizeTextKey } = require('../utils/cache');
const { logger } = require('../utils/logger');

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);

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
          { maxTokens: 1024, model: 'claude-haiku-4-5-20251001' }
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
    const { peak, route, lat, lon, date, start, travel_window_hours } = req.body;
    if (!peak || !route || !lat || !lon || !date) {
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
    if (start && !/^\d{2}:\d{2}$/.test(start)) {
      return res.status(400).json({ error: 'start must be HH:MM format' });
    }

    try {
      // Step 1: Get waypoints from Claude (cached 24h per peak+route)
      const wpCacheKey = `${normalizeTextKey(safePeak)}|${normalizeTextKey(safeRoute)}|${normalizeCoordKey(safeLat, safeLon)}`;
      const waypoints = await waypointCache.getOrFetch(wpCacheKey, async () => {
        const waypointText = await withTimeout(askClaude(
          `Return 4-5 key waypoints for the "${safeRoute}" on ${safePeak} near (${safeLat}, ${safeLon}).
List them in order from trailhead to summit.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Waypoint Name","lat":0.0,"lon":0.0,"elev_ft":0}]`,
          { maxTokens: 512, model: 'claude-haiku-4-5-20251001' }
        ), 20000, 'Waypoint lookup');
        return parseJsonArrayFromClaude(waypointText);
      });
      // Clone so summit pinning doesn't mutate cached array
      const waypointsCopy = waypoints.map((wp) => ({ ...wp }));

      // Pin the last waypoint (summit) to the user's actual peak coordinates
      // so its safety score matches the main report.
      if (waypointsCopy.length > 0) {
        const summit = waypointsCopy[waypointsCopy.length - 1];
        summit.lat = Number(lat);
        summit.lon = Number(lon);
      }

      // Step 1b: Geocode non-summit waypoints via Nominatim to correct
      // coordinates that Claude may have hallucinated.
      const peakLat = Number(lat);
      const peakLon = Number(lon);
      await Promise.all(
        waypointsCopy.slice(0, -1).map(async (wp) => {
          const geo = await geocodeWaypoint(wp.name, peakLat, peakLon, fetchWithTimeout, fetchHeaders);
          if (geo) {
            wp.lat = geo.lat;
            wp.lon = geo.lon;
          }
        })
      );

      // Step 2: Run safety checks for each waypoint in parallel
      const safetyResults = await withTimeout(
        Promise.all(
          waypointsCopy.map((wp) =>
            invokeSafetyHandler({ lat: String(wp.lat), lon: String(wp.lon), date, start: start || '06:00', travel_window_hours: String(travel_window_hours || 12) })
          )
        ),
        60000, 'Safety checks'
      );

      // Step 3: Strip each payload to key fields to keep synthesis prompt small
      const summaries = waypointsCopy.map((wp, i) => {
        const p = safetyResults[i]?.payload || {};
        const avyRelevant = p.avalanche?.relevant !== false;
        const snowDepthIn = p.snowpack?.snotel?.snowDepthIn ?? p.snowpack?.nohrsc?.snowDepthIn ?? null;
        const hasSnow = snowDepthIn != null && snowDepthIn > 0;
        return {
          name: wp.name,
          elev_ft: wp.elev_ft,
          score: p.safety?.score ?? null,
          weather: pick(p.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'description', 'precipChance']),
          ...(avyRelevant && hasSnow ? { avalanche: pick(p.avalanche, ['risk', 'dangerLevel', 'bottomLine']) } : {}),
          activeAlerts: Array.isArray(p.alerts?.alerts) ? p.alerts.alerts.length : 0,
          ...(hasSnow ? { snowDepthIn } : {}),
        };
      });

      // Step 4: Synthesize
      const hasAvalancheData = summaries.some((s) => s.avalanche);
      const analysis = await withTimeout(askClaude(
        `You are analyzing backcountry conditions for a trip on ${safePeak}.
Route: ${safeRoute}
Date: ${date}${start ? `, Start time: ${start}` : ''}
${hasAvalancheData ? '' : '\nNo snowpack or avalanche data is present — do NOT discuss avalanche hazards, snow conditions, or avalanche gear.\n'}
Waypoint conditions from trailhead to summit:
${JSON.stringify(summaries, null, 2)}

Write a concise route-wide briefing (3-5 short paragraphs) covering:
1. Key hazard zones by elevation and where conditions change significantly
2. Weather windows — when storms arrive, when winds intensify, or when conditions deteriorate (do NOT assume pace or method of travel)
3. Any gear needs specific to current route conditions
4. Overall go / go-with-caution / no-go recommendation with one-line reasoning`,
        { maxTokens: 700, model: 'claude-haiku-4-5-20251001' }
      ), 20000, 'Route synthesis');

      return res.json({ waypoints: waypointsCopy, summaries, analysis });
    } catch (err) {
      logger.error({ err }, 'route-analysis error');
      return res.status(500).json({ error: 'Failed to analyze route: ' + err.message });
    }
  });
};

module.exports = { registerRouteAnalysisRoutes };
