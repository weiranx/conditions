# API Reference

Base URL:

- Development: `http://localhost:3001`
- Production: your deployed backend origin

All API routes are JSON.

## `GET /api/safety`

Returns a synthesized planning report for a coordinate, date, and start time.

### Query Parameters

- `lat` (required): decimal latitude (`-90..90`)
- `lon` (required): decimal longitude (`-180..180`)
- `date` (optional): `YYYY-MM-DD`
- `start` (optional): `HH:mm` (24-hour format)

### Validation Behavior

- Missing `lat`/`lon` -> `400` with error message
- Invalid coordinate range -> `400`
- Invalid date format -> `400`
- Date outside provider forecast range -> `400` with `availableRange`

### Example

```bash
curl "http://localhost:3001/api/safety?lat=46.8523&lon=-121.7603&date=2026-02-21&start=06:30"
```

### Response Shape (Top Level)

- `generatedAt`: backend response generation timestamp
- `location`: `{ lat, lon }`
- `forecast`: selected date/start/end and available range
- `weather`: weather snapshot + trend + source details
- `solar`: sunrise/sunset/dayLength
- `avalanche`: center/zone/danger/problems/relevance metadata
- `alerts`: active alerts at selected start-time window
- `airQuality`: AQI and pollutant fields
- `rainfall`: rolling precipitation totals and source metadata
- `snowpack`: SNOTEL + NOHRSC observations and summary
- `fireRisk`: synthesized fire-risk signal
- `gear`: list of gear-focus suggestions
- `trail`: terrain/trail surface classification
- `safety`: score, confidence, factors, explanations
- `aiAnalysis`: plain-language summary

Potential additional fields:

- `partialData: true` when one or more upstream feeds failed
- `apiWarning` with degradation context

### `rainfall.totals` Fields

Current precipitation model includes separate rain and snowfall totals:

- Rain: `rainPast12h*`, `rainPast24h*`, `rainPast48h*` (in/mm)
- Snowfall: `snowPast12h*`, `snowPast24h*`, `snowPast48h*` (in/cm)

Compatibility aliases are also included:

- Legacy rain aliases: `past12h*`, `past24h*`, `past48h*`

## `GET /api/search`

Searches objectives using local peak catalog + Nominatim geocoding.

### Query Parameters

- `q` (optional): search text

Behavior:

- No `q`: returns top 5 popular peaks
- Short `q` (< 3 chars): local peak matches only
- Longer `q`: local matches + Nominatim US geocoding (deduped)

### Example

```bash
curl "http://localhost:3001/api/search?q=rainier"
```

## Health Endpoints

- `GET /healthz`
- `GET /health`
- `GET /api/healthz`
- `GET /api/health`

Response:

```json
{
  "ok": true,
  "service": "summitsafe-backend",
  "env": "development",
  "timestamp": "2026-02-21T00:00:00.000Z"
}
```

## Headers

- `X-Request-Id`: generated for each backend request; use for tracing logs.
