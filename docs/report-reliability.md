# Report evidence and verification

Safety model 2.9.0 retains the numeric hazard score for compatibility and diagnosis,
but `assessmentStatus: insufficient_evidence` prevents a GO and suppresses that
score in the active report, recent report, and saved-report summary. Known blockers
remain NO-GO. The numeric score alone must not be used to clear a trip.

Critical evidence includes complete temperature, wind/gust and precipitation
coverage over the requested interval, a known weather issuance within 18 hours,
an available alert feed, and (when relevant and enabled) avalanche validity
through the return time. Missing timestamps do not count as valid coverage.
Overlapping hourly intervals are deduplicated; boundary hours contribute only
their overlapping duration. Provider end times are respected. Local Open-Meteo
timestamps use the objective timezone; ambiguous repeated local timestamps do not
establish two separate hours without distinct offsets.

Evidence quality is a heuristic category, not a calibrated probability of forecast
accuracy or trip safety. The legacy `confidence` number remains in the API for
compatibility. Weather provenance retains provider, field sources, issuance,
retrieval time, timezone, requested window and elevation source. Retrieval time
never substitutes for model issuance. Elevation bands remain modeled estimates.

AI briefs require structured sections and exact scalar report-field citations.
Unknown paths, mismatching cited values, unsupported numeric quantities and common
unsafe decision overrides trigger a deterministic report-derived brief. Responses
include `validation` and `evidence`. These checks do not prove every semantic claim
in natural language; report chat remains streamed and uses evidence instructions,
not the brief validator. Briefs quote source units to avoid unverifiable conversions.
Oversized reports are rejected rather than truncated into incomplete JSON.

## Regression and empirical verification

Run `npm --prefix backend test -- --runTestsByPath test/unit.report-reliability.test.js`
and the provider/payload suites when changing normalization or source timing.
`backend/test/fixtures/reliability/partial-window.json` is explicitly synthetic.
It is for regression replay, not evidence that forecast accuracy is calibrated.

To evaluate real forecasts, archive them before their valid time and pair them with
later observations at the same location, variable, unit and valid time. Run:

```
node backend/scripts/verify-forecasts.js /path/to/matched-pairs.json
```

Input is a JSON array containing `provider`, `forecastLocationId`,
`observationLocationId`, `variable`, `unit`, `issuedAt`, `validAt`, `observedAt`,
`forecast` and `observed`. Use ISO timestamps with explicit offsets. Location IDs
must agree and refer to a genuinely comparable forecast and observation site.
Never relabel a valley station as a summit. The verifier rejects unmatched,
missing, nonnumeric, duplicate and retrospective pairs, then reports count, bias,
MAE and RMSE separately by provider, variable, unit and forecast lead bucket.
Temperature error and precipitation probability calibration require different
metrics; do not interpret this numeric error summary as probability calibration.

No live observation archive is bundled, so no empirical accuracy claim is made.
