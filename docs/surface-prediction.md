# Surface prediction

The surface estimate is a weather-and-observation heuristic, not a calibrated probability or slope-stability forecast. The classifier preserves `terrainCondition` and adds `evidence`, `confidenceReasons`, `moisture`, and `outlook`. Old saved reports remain readable without these fields.

## Evidence and timing

Refreeze uses the most recent contiguous night before departure, with a known day-to-night boundary and at least four valid hourly temperatures. Missing temperatures, gaps, and truncated nights remain unknown. NOAA is supplemented with Open-Meteo's preceding-day hours when available. Future nighttime lows cannot establish preceding-night refreeze.

Refreeze strength uses hours below 32°F and Fahrenheit freezing degree-hours. Strong requires four freezing hours and 20 degree-hours; fair requires two hours and four degree-hours. These describe potential, not measured crust supportability.

Travel temperatures use timestamp intervals, including partial hours and gaps. Warming potential uses Fahrenheit degree-hours above freezing (moderate at 5, high at 18); incomplete coverage returns unknown. Cloud-adjusted daylight provides context, not slope radiation. Fixed sunrise-offset softening times have been removed: `softeningStart` and `wetSnowStart` remain null. A corn window cannot be established from these inputs.

## Snow and ground

Snow depth and SWE use weighted medians of individual SNOTEL stations, CDEC, and NOHRSC. Weight decays with observation age (72-hour scale), station distance (30-km scale), and elevation difference (1,500-foot scale). Observations older than seven days relative to the trip or stations beyond 80 km are excluded. Missing metadata reduces weight. Snow/no-snow disagreement is retained and limits confidence. These are initial engineering weights, not fitted accuracy claims. Legacy `maxSnowDepthIn`/`maxSweIn` fields carry representative estimates for existing consumers; `evidence.sources` preserves individual measurements.

A three-day rain-memory indicator weights the latest day fully, the previous day at 0.6, and the oldest day at 0.3. It retains wet-surface possibility after today's weather becomes dry. It is not measured soil moisture or a drainage model. Soil, canopy, substrate, and actual evaporation are unavailable; the report distinguishes possible slippery wet rock from soil-dependent mud. Missing precipitation conversions and incomplete accumulation windows remain null, never zero.

Dry/firm requires explicit low snow and rain evidence plus usable weather. Confidence uses essential weather coverage, precipitation availability, snow relevance, disagreement, and lead time. Surface confidence is capped at medium until validation against actual observations supports stronger claims.

## Display and validation boundary

The terrain report shows hourly possible surface states, coverage, travel effects, and evidence limitations. Route checkpoint reports inherit the point classifier; this does not interpolate snow coverage across a route or measure aspect, slope, shade, or soil. Coverage is a snow signal, not a measured snow-covered percentage.

Regression tests cover preceding versus following nights, missing values, sparse/duplicate hourly periods, snow-source age and elevation, contradictory observations, retained rain, changing hourly state, and old report rendering.

Further precision requires new inputs and field validation: route terrain/shading, measured radiation or a validated energy-balance model, soil/drainage data, and timestamped/geolocated observations of coverage, firmness, boot penetration, and wetness. Evaluate false dry/firm classifications and transition timing on trips held out by location and date before calibrating probabilities or restoring precise timing claims.
