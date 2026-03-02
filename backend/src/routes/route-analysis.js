const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);

const pick = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return {};
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
};

const parseJsonArrayFromClaude = (text) => {
  // Extract the first JSON array found anywhere in the response
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in Claude response: ${text.slice(0, 200)}`);
  }
  let raw = text.slice(start, end + 1);

  // Fix common Claude JSON quirks: trailing commas, single-quoted keys
  raw = raw.replace(/,\s*([}\]])/g, '$1');
  raw = raw.replace(/(['"])?(\w+)(['"])?\s*:/g, (_, q1, key, q2) =>
    (q1 === '"' && q2 === '"') ? `"${key}":` : `"${key}":`
  );

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON from Claude: ${e.message}\nRaw: ${raw.slice(0, 300)}`);
  }
};

const registerRouteAnalysisRoutes = ({ app, askClaude, invokeSafetyHandler }) => {
  // GET /api/route-suggestions?peak=Mt+Whitney&lat=36.578&lon=-118.292
  app.get('/api/route-suggestions', async (req, res) => {
    const { peak, lat, lon } = req.query;
    if (!peak || !lat || !lon) {
      return res.status(400).json({ error: 'peak, lat, and lon are required' });
    }

    try {
      const text = await askClaude(
        `List the 2-3 most common hiking or climbing routes for ${peak} near coordinates (${lat}, ${lon}) in the United States.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Route Name","distance_rt_miles":22,"elev_gain_ft":6100,"class":"Class 1","description":"One sentence description."}]`,
        { maxTokens: 512 }
      );
      const routes = parseJsonArrayFromClaude(text);
      return res.json(routes);
    } catch (err) {
      console.error('[route-suggestions] error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/route-analysis
  // Body: { peak, route, lat, lon, date, start }
  app.post('/api/route-analysis', async (req, res) => {
    const { peak, route, lat, lon, date, start } = req.body;
    if (!peak || !route || !lat || !lon || !date) {
      return res.status(400).json({ error: 'peak, route, lat, lon, and date are required' });
    }

    try {
      // Step 1: Get waypoints from Claude
      const waypointText = await withTimeout(askClaude(
        `Return 4-5 key waypoints for the "${route}" on ${peak} near (${lat}, ${lon}).
List them in order from trailhead to summit.
Return ONLY a valid JSON array with no explanation, no markdown, no code fences:
[{"name":"Waypoint Name","lat":0.0,"lon":0.0,"elev_ft":0}]`,
        { maxTokens: 512 }
      ), 20000, 'Waypoint lookup');
      const waypoints = parseJsonArrayFromClaude(waypointText);

      // Step 2: Run safety checks for each waypoint in parallel
      const safetyResults = await withTimeout(
        Promise.all(
          waypoints.map((wp) =>
            invokeSafetyHandler({ lat: wp.lat, lon: wp.lon, date, start: start || '06:00' })
          )
        ),
        60000, 'Safety checks'
      );

      // Step 3: Strip each payload to key fields to keep synthesis prompt small
      const summaries = waypoints.map((wp, i) => {
        const p = safetyResults[i]?.payload || {};
        return {
          name: wp.name,
          elev_ft: wp.elev_ft,
          score: p.safety?.score ?? null,
          weather: pick(p.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'description', 'precipChance']),
          avalanche: pick(p.avalanche, ['risk', 'dangerLevel', 'bottomLine']),
          activeAlerts: Array.isArray(p.alerts?.alerts) ? p.alerts.alerts.length : 0,
          snowDepthIn: p.snowpack?.snotel?.snowDepthIn ?? p.snowpack?.nohrsc?.snowDepthIn ?? null,
        };
      });

      // Step 4: Synthesize
      const analysis = await withTimeout(askClaude(
        `You are analyzing backcountry conditions for a trip on ${peak}.
Route: ${route}
Date: ${date}${start ? `, Start time: ${start}` : ''}

Waypoint conditions from trailhead to summit:
${JSON.stringify(summaries, null, 2)}

Write a concise route-wide briefing (3-5 short paragraphs) covering:
1. Key hazard zones by elevation and where conditions change significantly
2. Timing concerns (weather windows, storm timing, turnaround pressure)
3. Any gear needs specific to current route conditions
4. Overall go / go-with-caution / no-go recommendation with one-line reasoning`,
        { maxTokens: 700 }
      ), 20000, 'Route synthesis');

      return res.json({ waypoints, summaries, analysis });
    } catch (err) {
      console.error('[route-analysis] error:', err.message);
      return res.status(500).json({ error: 'Failed to analyze route: ' + err.message });
    }
  });
};

module.exports = { registerRouteAnalysisRoutes };
