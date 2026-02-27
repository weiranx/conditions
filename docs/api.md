# API Reference

Base URL:

- Development: `http://localhost:3001`
- Production: your deployed backend origin

All API routes return `application/json`. All timestamps are ISO 8601 UTC strings.

---

## `GET /api/safety`

Returns a synthesized planning report for a coordinate, date, start time, and travel window.

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `lat` | number | Yes | Decimal latitude (`-90` to `90`) |
| `lon` | number | Yes | Decimal longitude (`-180` to `180`) |
| `date` | string | No | `YYYY-MM-DD` — defaults to today |
| `start` | string | No | `HH:mm` 24-hour start time — defaults to first available NOAA period |
| `travel_window_hours` | integer | No | Travel window length (`1`–`24`, default `12`) |
| `travelWindowHours` | integer | No | camelCase alias for `travel_window_hours` |

**Behavior notes:**
- If `start` is missing or invalid, the backend selects the first available NOAA hourly forecast period for the selected date.
- `travel_window_hours` values are rounded and clamped to `1`–`24`; invalid values fall back to `12`.

### HTTP Status Codes

| Status | Condition |
|---|---|
| `200` | Success (may include `partialData: true` if some upstream feeds failed) |
| `400` | Missing required parameters, invalid coordinate range, invalid date format, or date outside provider range |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

### Error Response Format

```json
{
  "error": "Missing required parameter: lat",
  "status": 400
}
```

For date range errors, an `availableRange` field is included:

```json
{
  "error": "Date outside available forecast range",
  "availableRange": { "start": "2026-02-21", "end": "2026-02-28" },
  "status": 400
}
```

### Example Request

```bash
curl "http://localhost:3001/api/safety?lat=46.8523&lon=-121.7603&date=2026-02-21&start=06:30&travel_window_hours=12"
```

### Response Shape (Top Level)

| Field | Description |
|---|---|
| `generatedAt` | ISO timestamp of backend response generation |
| `location` | `{ lat, lon }` — echoed request coordinates |
| `forecast` | Selected date/start/end times and available forecast range |
| `weather` | Weather snapshot, hourly trend, and source metadata |
| `solar` | `{ sunrise, sunset, dayLength }` |
| `avalanche` | Center, zone, danger ratings, problems, bottom-line text, and relevance metadata |
| `alerts` | Active NWS alerts filtered to the selected travel window |
| `airQuality` | AQI index and pollutant fields |
| `rainfall` | Rolling precipitation totals by time window and source metadata |
| `snowpack` | SNOTEL station observations and NOHRSC snow analysis summary |
| `fireRisk` | Synthesized fire-risk signal |
| `heatRisk` | Synthesized heat-risk signal |
| `terrainCondition` | Terrain-surface condition model |
| `trail` | Trail/terrain surface classification string |
| `gear` | Array of gear-focus suggestion strings |
| `safety` | Risk score, confidence level, contributing factors, and plain-language explanations |
| `aiAnalysis` | Plain-language condition summary |

**Partial data fields** (present when one or more upstream feeds failed):

| Field | Description |
|---|---|
| `partialData` | `true` when the response uses degraded/incomplete upstream data |
| `apiWarning` | Human-readable description of which feeds failed and why |

### `rainfall.totals` Fields

The precipitation model separates rain and snowfall:

| Field | Unit | Description |
|---|---|---|
| `rainPast12h` / `rainPast12hMm` | in / mm | Rain total, past 12 hours |
| `rainPast24h` / `rainPast24hMm` | in / mm | Rain total, past 24 hours |
| `rainPast48h` / `rainPast48hMm` | in / mm | Rain total, past 48 hours |
| `snowPast12h` / `snowPast12hCm` | in / cm | Snowfall total, past 12 hours |
| `snowPast24h` / `snowPast24hCm` | in / cm | Snowfall total, past 24 hours |
| `snowPast48h` / `snowPast48hCm` | in / cm | Snowfall total, past 48 hours |

Legacy rain aliases (`past12h*`, `past24h*`, `past48h*`) are included for compatibility.

### `safety` Field

| Field | Description |
|---|---|
| `score` | Numeric risk score (higher = more risk) |
| `confidence` | Confidence level of the score (`high` / `medium` / `low`) |
| `factors` | Array of individual risk factor objects with name, value, and weight |
| `explanations` | Array of plain-language explanation strings for each contributing factor |

---

## `GET /api/sat-oneliner`

Returns a satellite-friendly one-line condition summary derived from `/api/safety`. Useful for sending condition reports via satellite communicators with character limits.

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `lat` | number | Yes | Decimal latitude (`-90` to `90`) |
| `lon` | number | Yes | Decimal longitude (`-180` to `180`) |
| `date` | string | No | `YYYY-MM-DD` |
| `start` | string | No | `HH:mm` 24-hour start time |
| `objective` | string | No | Objective label to include in the one-liner (alias: `name`) |
| `maxLength` | integer | No | Output character cap (`80`–`320`, default `170`) |

### Example Request

```bash
curl "http://localhost:3001/api/sat-oneliner?lat=46.8523&lon=-121.7603&date=2026-02-21&start=06:30&objective=Mount%20Rainier"
```

### Response Shape

| Field | Description |
|---|---|
| `line` | Final one-liner text |
| `length` | Character length of `line` |
| `maxLength` | Applied max length cap |
| `generatedAt` | ISO timestamp of SAT endpoint generation |
| `sourceGeneratedAt` | ISO timestamp of the upstream `/api/safety` payload |
| `partialData` | `true` when the upstream report used degraded data |
| `source` | Always `"/api/safety"` |
| `params` | Normalized request params used to build the line |

---

## `GET /api/search`

Searches objectives using a local peak catalog plus Nominatim geocoding.

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `q` | string | No | Search text |

**Behavior:**
- No `q`: returns top 5 popular peaks
- Short `q` (< 3 chars): local peak catalog matches only
- Longer `q`: local matches + Nominatim US geocoding (deduplicated)

### Example Requests

```bash
# Top peaks (no query)
curl "http://localhost:3001/api/search"

# Search by name
curl "http://localhost:3001/api/search?q=rainier"
```

### Response Shape

Array of result objects, each with:

| Field | Description |
|---|---|
| `name` | Peak or place name |
| `lat` | Decimal latitude |
| `lon` | Decimal longitude |
| `elevation` | Elevation in feet (when available) |
| `source` | `"local"` or `"nominatim"` |

---

## Health Endpoints

All four aliases return the same response:

- `GET /healthz`
- `GET /health`
- `GET /api/healthz`
- `GET /api/health`

### Example Response

```json
{
  "ok": true,
  "service": "summitsafe-backend",
  "env": "development",
  "timestamp": "2026-02-21T00:00:00.000Z"
}
```

---

## Headers

| Header | Description |
|---|---|
| `X-Request-Id` | Unique ID generated for each backend request — use for correlating logs |

Include this ID in bug reports and support requests to aid troubleshooting.
