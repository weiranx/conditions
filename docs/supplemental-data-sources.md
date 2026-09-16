# Supplemental report data sources

The report's **Checks and source evidence** chapter includes four additional sources. The API exposes them under `supplementalEvidence`. These are corroborating evidence and do not alter safety scores or count a second observation as an independent forecast.

| Source | Report content | Coverage and limits |
| --- | --- | --- |
| Synoptic Weather | Up to three nearby stations: temperature, wind, gust, per-reading time, distance and elevation difference | Requires `SYNOPTIC_API_TOKEN`; active unrestricted stations within 50 km, readings no older than two hours, provider QC enabled. Current observations, even for a future trip. |
| NOAA National Blend of Models (NBM) | Published P10, median and P90 wind-speed samples, station identity/elevation, model run and valid times | NBP station bulletin matched to nearby NWS station metadata. Samples within 12 hours of the requested departure; no hourly interpolation, gust probability, summit correction or whole-trip uncertainty claim. P10–P90 describes the central 80% of the model distribution, not all possible outcomes. |
| NWS Area Forecast Discussion | Latest office discussion, issuance time and source link | Regional prose issued within 24 hours. Its individual paragraphs have their own locations and forecast periods; it is not converted to a point forecast. |
| NOAA HRRR-Smoke | Near-surface smoke at 8 m (µg/m³), total-column smoke (mg/m²), run, valid time and grid distance | Contiguous US; nearest hourly sample from a recent 00/06/12/18 UTC run through forecast hour 48. Grid point must be within 10 km. Smoke is not total PM2.5 or AQI, and one sample does not describe exposure throughout a trip. |

The existing USGS integration now uses the [Water Data OGC v1 API](https://api.waterdata.usgs.gov/docs/ogcapi/), replacing legacy WaterServices. It queries discharge and stage separately, rejects observations older than three hours, fetches metadata for the selected station and computes a trend only when history is available. Truncated station searches are marked incomplete. An optional `USGS_API_KEY` is sent in `X-Api-Key` for increased quotas. NWPS enrichment remains separate.

AirNow now uses the monitoring-site `/aq/data/` endpoint, replacing the retiring reporting-area lat/long endpoint. It selects the latest AQI per site and pollutant within 75 km, requires a UTC observation within three hours and never treats concentration as AQI. The model forecast remains separate. `AIRNOW_API_KEY` is still required.

## Runtime setup

Set provider keys in the backend environment or the owner administration credentials UI, then restart the backend. Do not put real keys in Git. Synoptic requires an account/token with appropriate data access; missing configuration appears explicitly in the report. USGS works without a key subject to its public quota. No key is required for NWS, NBM or HRRR.

The backend Docker image includes Python and ecCodes using Debian packages. Both build stages use Debian to preserve compatibility with native Node dependencies. The runtime retains the existing app UID 100 and GID 101 so deployed report-log volumes remain writable. Local development needs a Python environment with the `eccodes` package:

```sh
python3 -m venv .venv-grib
.venv-grib/bin/pip install eccodes
# In the backend environment (use an absolute path):
GRIB_PYTHON=/path/to/.venv-grib/bin/python
```

The Python helper decodes downloaded GRIB messages and has no network responsibilities. Downloads use validated HTTP byte ranges and size limits; a single decoder runs at a time with a 12-second deadline. A busy or missing decoder yields unavailable evidence. All four supplemental sources share a 25-second request budget. Requests and metadata are cached; observation age checks still use the provider timestamps. NBP bulletins are bounded at 45 MB and at most two cycles are retained in memory. No raw GRIB or full bulletin is returned to the frontend.

`fieldObservations` controls Synoptic, `weatherContextDetails` controls NBM and AFD, and `airQualityDetails` controls HRRR. Disabled sources are neither fetched nor retained by report feature filtering. Saved older reports remain valid without these fields.

## Provider specifications

- [Synoptic Latest API and quality control](https://docs.synopticdata.com/services/latest)
- [NBM text guidance and element definitions](https://vlab.noaa.gov/web/mdl/nbm-textcard-v4.1), [current product availability](https://vlab.noaa.gov/web/mdl/nbm-text-products)
- [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- [NOAA HRRR public archive](https://registry.opendata.aws/noaa-hrrr-pds/)
- [NCEP GRIB parameter table 4.2-0-20](https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_doc/grib2_table4-2-0-20.shtml): MASSDEN = kg/m³, COLMD = kg/m². HRRR's older GRIB table version can cause ecCodes to label these fields unknown; the decoder validates numeric parameter and level codes before conversion.
- [USGS migration guide](https://api.waterdata.usgs.gov/docs/ogcapi/migration/)
- [AirNow web services](https://docs.airnowapi.org/webservices), [DOE ACT monitoring-site client](https://arm-doe.github.io/ACT/_modules/act/discovery/airnow.html)

## Verification

`backend/test/unit.supplemental-evidence.test.js` covers freshness, QC, missing values, valid zeroes, fixed-width probability parsing, GRIB parameter/time/units, byte-range enforcement, gauge migration, AirNow deduplication and feature filtering. Field rendering coverage verifies unavailable states, probability labels, zero smoke and escaped discussion text. Public live checks are reproducible with `node backend/scripts/verify-supplemental-sources.js LAT LON`; configure `GRIB_PYTHON` for HRRR. Keys are never printed.
