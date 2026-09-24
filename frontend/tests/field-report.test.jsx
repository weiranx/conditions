import { SurfacePrediction } from "../src/field/SurfacePrediction";
import { evaluate } from './evaluation-fixtures';
import tripDays from '../../backend/src/utils/trip-days.js';
import verdict from '../../backend/src/utils/verdict.js';
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Forecast } from "../src/field/Forecast";
import Compare from "../src/field/Compare";
import { buildPersistedReport } from "../src/app/report-storage";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { dateLabel, emptyAi } from "../src/field/data";
import { ComfortScore } from "../src/field/ComfortScore";
const preferences = getDefaultUserPreferences();
test("comfort shows its outlook, coverage, and the reason for a limiting score", () => {
  const html = renderToStaticMarkup(<ComfortScore comfort={{
    score: 74, label: 'Mixed', confidence: 53, weightedScore: 98,
    summary: 'Limited forecast coverage (12/24 complete hours).',
    coverage: { completeHours: 12, requestedHours: 24 },
    confidenceReasons: ['Wind: hourly readings cover 12 of 24 planned hours.'],
    adjustments: [{ maximumScore: 74, reason: 'Incomplete coverage limits the rating to Mixed.' }],
    factors: [{ factor: 'Temperature', score: 100, weight: 30, impact: 0, message: 'Feels like 58°F.' }],
  }} localize={(text) => text.replace('58°F', '14°C')} />);
  for (const expected of [/74\/100/, /12\/24 hours/, /12 of 24 planned hours/, /Incomplete coverage limits/, /weighted estimate is 98\/100/, /14°C/, /What shapes this score/, /Missing forecast evidence/]) assert.match(html, expected);
  assert.doesNotMatch(html, /58°F|NaN|Infinity/);
});

test("legacy comfort reports do not invent coverage or confidence", () => {
  const html = renderToStaticMarkup(<ComfortScore comfort={{ score: 80, label: 'Pleasant', summary: 'Pleasant overall.' }} />);
  assert.match(html, /Hourly coverage was not recorded/);
  assert.match(html, /Evidence coverage<\/strong><span>Unknown/);
  assert.match(html, /No individual comfort factors/);
});

test("unknown comfort remains unavailable and a genuine zero remains visible", () => {
  const unknown = renderToStaticMarkup(<ComfortScore comfort={{ score: null, label: 'Unknown', confidence: 0, summary: 'Insufficient weather data.' }} />);
  assert.match(unknown, /Weather comfort score unavailable/);
  assert.doesNotMatch(unknown, /0\/100/);
  const zero = renderToStaticMarkup(<ComfortScore comfort={{ score: 0, label: 'Harsh', summary: 'Harsh weather.' }} />);
  assert.match(zero, /0\/100/);
  assert.match(zero, /does not change the safety score/);
});
const weatherHour = {
  time: "09:00",
  temp: 50,
  wind: 10,
  gust: 15,
  precipChance: 0,
  feelsLike: 48,
  condition: "Clear",
  cloudCover: 5,
  humidity: 50,
  pressure: 1e3,
  dewPoint: 32,
  windDirection: "NW",
  isDaytime: true,
};
// Bluebird shares are computed by the backend (unit.report-interpretation).
test("forecast explains bluebird percentage and partial coverage", () => {
  const html = forecast(report([weatherHour]));
  assert.match(html, /Bluebird day <strong>100%/);
  assert.match(html, /1\/1 daylight hours/);
  assert.match(html, /Available forecast: 1\/3 requested hours/);
  assert.match(html, /not the probability of a whole bluebird day/);
  const missing = forecast(report([{ ...weatherHour, cloudCover: null }]));
  assert.match(missing, /Bluebird day <strong>Unavailable/);
});
function report(trend, customPreferences = preferences) {
  return buildPersistedReport(
    {
      lat: 46.85,
      lon: -121.76,
      objectiveName: "Test mountain",
      searchQuery: "Test mountain",
      forecastDate: "2026-09-06",
      alpineStartTime: "09:00",
      travelWindowHours: 3,
      targetElevationInput: "",
    },
    { weather: { trend }, safety: { score: 80 }, capabilities: { ai: false } },
    emptyAi,
    { preferences: customPreferences },
  );
}
// The Weather chapter as the app renders it: readings checked by the backend for the report's plan.
function forecast(saved) {
  const evaluation = evaluate(saved.safetyData, {
    date: saved.plan.forecastDate,
    start: saved.plan.alpineStartTime,
    travel_window_hours: String(saved.plan.travelWindowHours),
    temp_unit: saved.preferences.temperatureUnit,
    wind_unit: saved.preferences.windSpeedUnit,
  });
  return renderToStaticMarkup(<Forecast report={saved} evaluation={evaluation} />);
}
test("hourly forecast converts temperature and wind using the report preferences", () => {
  const html = forecast(report([weatherHour], {
    ...preferences,
    temperatureUnit: "c",
    windSpeedUnit: "kph",
  }));
  assert.match(html, /10°C/);
  assert.match(html, /16 kph/);
  assert.doesNotMatch(html, /50°F/);
});
test("a missing hourly forecast is explicitly unavailable", () => {
  const html = forecast(report([]));
  assert.match(html, /Hourly forecast is unavailable/);
  assert.doesNotMatch(html, /within limits|NaN|Infinity/);
});
test("sparse chart readings never create invalid SVG coordinates", () => {
  const html = forecast(report([
    weatherHour,
    { ...weatherHour, time: "10:00", temp: null },
    { ...weatherHour, time: "11:00", temp: 55 },
  ]));
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /Hour by hour/);
  assert.match(html, /Hourly evidence is incomplete/);
  assert.doesNotMatch(html, />0°F</);
});
function comparison(decisions, overrides = {}) {
  const days = decisions.map((day) => ({
    decisionHeadline: `Decision for ${day.date}`,
    limitingChecks: [],
    safetyData: { weather: { trend: [] }, capabilities: { ai: false } },
    windGustMph: 10,
    peakGustMph: 12,
    precipChance: 5,
    peakPrecipChance: 8,
    travelPassHours: 3,
    travelCompletePassHours: 3,
    travelTotalHours: 3,
    travelBestWindow: null,
    hourlyWeather: [],
    tempLowF: 40,
    tempHighF: 50,
    expectedRainIn: 1,
    expectedSnowIn: 1,
    alertCount: 0,
    ...day,
  })).map((day) => ({
    ...day,
    concerns: [...new Set(day.limitingChecks.map(verdict.checkSummary).filter(Boolean))],
    rankValue: tripDays.rankValue(day),
  }));
  const w = {
    preferences: { ...preferences, elevationUnit: "m" },
    tripForecastRows: days,
    tripRanking: tripDays.rankDays(days),
    tripHighlights: tripDays.buildHighlights(days),
    tripChatContext: null,
    position: { lat: 46.85, lng: -121.76 },
    objectiveName: "Test mountain",
    searchQuery: "Test mountain",
    tripStartTime: "09:00",
    tripStartDate: "2026-09-06",
    tripDurationDays: 2,
    travelWindowHours: 3,
    travelWindowHoursDraft: "3",
    hasObjective: true,
    objectiveDraftDirty: false,
    showSuggestions: false,
    featureFlags: { hourlyWeatherCharts: false, gpxImport: false },
    formatTempDisplay: (n) => `${n}\xB0F`,
    formatWindDisplay: (n) => `${n} mph`,
    handlePlannerTimeChange: () => () => void 0,
    objectiveTimezone: "America/Los_Angeles",
    handleInputChange: () => void 0,
    ...overrides,
  };
  return renderToStaticMarkup(<Compare workspace={w} />);
}
test("comparison ranks decision level ahead of numeric score", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "NO-GO", score: 99 },
    { date: "2026-09-07", decisionLevel: "GO", score: 70 },
  ]);
  assert.match(html, /Most favorable weather window/);
  assert.ok(
    html.indexOf("Decision for 2026-09-07") <
      html.indexOf("Decision for 2026-09-06") ||
      !html.includes("Decision for 2026-09-06"),
  );
  assert.match(html, /25\.4 mm/);
  assert.match(html, /2\.5 cm/);
  assert.match(html, /Copy trip brief/);
  assert.match(html, /Open this day/);
});
test("a comparison with only blocked days never presents a favorable recommendation", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "NO-GO", score: 99 },
    { date: "2026-09-07", decisionLevel: "NO-GO", score: 70 },
  ]);
  assert.match(html, /Least unfavorable window · still blocked/);
  assert.doesNotMatch(html, /Most favorable weather window/);
});

test("comparison exposes weather tradeoffs, ties and incomplete coverage", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: 75, peakGustMph: 0, peakPrecipChance: 0, travelPassHours: 1, travelTotalHours: 1 },
    { date: "2026-09-07", decisionLevel: "GO", score: 70, peakGustMph: 0, peakPrecipChance: 0, travelPassHours: 2, travelTotalHours: 3 },
  ]);
  assert.match(html, /Every day, side by side/);
  assert.match(html, /All days tied/);
  assert.match(html, /Only 1 of 3 planned hours covered/);
  assert.match(html, /2 hours within limits/);
  assert.match(html, /Peak gust/);
  assert.match(html, /Departure gust/);
  assert.match(html, /Avalanche conditions are excluded/);
});

test("missing comparison readings stay unavailable and do not win weather highlights", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: null, windGustMph: null, peakGustMph: null, precipChance: null, peakPrecipChance: null, travelPassHours: 0, travelTotalHours: 0, partialData: true },
  ]);
  assert.match(html, /Score unavailable/);
  assert.match(html, /Hourly forecast unavailable/);
  assert.match(html, /Partial data/);
  assert.doesNotMatch(html, /NaN|Infinity|0 \/ 0 hours|0 mph|unavailable%/);
});

test("each compared day names the checks behind its decision", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: 91, limitingChecks: [
      "Wind gusts reach about 31 mph. Shorten ridge exposure and secure loose gear.",
      "Precipitation chance reaches 80%. Allow extra travel time.",
      "Some sources are out of date or missing timestamps (weather). Refresh the report.",
    ] },
    { date: "2026-09-07", decisionLevel: "GO", score: 80, travelPassHours: 2, travelTotalHours: 3 },
  ]);
  // A glance row leads with the first check and counts the rest.
  assert.match(html, /<span class="sky-day-note"><span>Wind gusts reach about 31 mph<\/span><small>\+2 more<\/small><\/span>/);
  // The table lists two; a Go day with an hour over a limit says so.
  assert.match(html, /Main concerns/);
  assert.match(html, /<li>Precipitation chance reaches 80%<\/li><li class="compare-concerns-more">\+1 more<\/li>/);
  assert.match(html, /1 h outside your limits/);
  // The comparison states each check; the actions stay in the full report.
  assert.doesNotMatch(html, /Shorten ridge exposure/);
});

test("a Caution recommendation lists its checks", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: 91, limitingChecks: ["Wind gusts reach about 31 mph. Shorten ridge exposure."] },
  ]);
  const recommendation = html.slice(html.indexOf("compare-recommendation"), html.indexOf("Your days at a glance"));
  assert.match(recommendation, /<ul class="sky-limiting compare-limiting" aria-label="Checks setting this day&#x27;s decision"><li>Wind gusts reach about 31 mph<\/li><\/ul>/);
});

test("days with equal decisions and scores rank by complete hours within limits, and ties are named", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: 80, travelPassHours: 3, travelCompletePassHours: 1 },
    { date: "2026-09-07", decisionLevel: "CAUTION", score: 80, travelCompletePassHours: 3 },
    { date: "2026-09-08", decisionLevel: "CAUTION", score: 80, travelCompletePassHours: 3 },
  ]);
  assert.equal(html.match(/<h2 id="[^"]*-best">([^<]+)<\/h2>/)?.[1], dateLabel("2026-09-07"));
  const ties = html.slice(html.indexOf("Also ranked first"), html.indexOf("daily departure"));
  assert.match(ties, new RegExp(`<button type="button">${dateLabel("2026-09-08")}</button>`));
  assert.doesNotMatch(ties, new RegExp(dateLabel("2026-09-06")), "hours counted only because a reading was missing do not tie");
  assert.match(html, /then score, then hours with every reading within your limits/);
});

test("comparison tradeoffs use the peak over the trip window", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "GO", score: 80, windGustMph: 5, peakGustMph: 30, precipChance: 0, peakPrecipChance: 40 },
    { date: "2026-09-07", decisionLevel: "GO", score: 80, windGustMph: 10, peakGustMph: 12, precipChance: 10, peakPrecipChance: 10 },
  ]);
  const highlights = html.slice(html.indexOf("Calmest day"), html.indexOf("Every day, side by side"));
  assert.match(highlights, new RegExp(`Calmest day</span></span><span class="sky-big is-small">${dateLabel("2026-09-07")}</span><p class="sky-cap">Gusts peak at 12 mph</p>`));
  assert.match(highlights, new RegExp(`Lowest rain / snow chance</span></span><span class="sky-big is-small">${dateLabel("2026-09-07")}</span><p class="sky-cap">Chance peaks at 10%</p>`));
  assert.match(html, /<th scope="row">Peak gust<\/th><td[^>]*>30 mph<\/td><td[^>]*>12 mph<\/td>/);
});

test("refresh hides the previous comparison and its hourly detail", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "GO", score: 90 },
  ], { tripForecastLoading: true, featureFlags: { hourlyWeatherCharts: true } });
  assert.match(html, /Comparing forecasts/);
  assert.doesNotMatch(html, /Most favorable weather window|Every day, side by side|Hourly detail/);
});

import {
  ConditionTrend,
  ConditionScale,
  AccumulationBars,
} from "../src/field/ConditionCharts";
import { weatherAppearance } from "../src/field/weather-appearance";
import { DaylightChart } from "../src/field/DaylightChart";
test("weather appearance distinguishes precipitation and nighttime without treating missing text as clear", () => {
  assert.deepEqual(
    weatherAppearance({ condition: "Chance Snow Showers", isDaytime: false }),
    { condition: "snow", night: true },
  );
  for (const [condition, expected] of [
    ["Partly Cloudy", "partly"],
    ["Thunderstorms and Rain", "storm"],
    ["Overcast", "cloudy"],
    ["Drizzle", "rain"],
    ["Fog", "fog"],
    ["", "neutral"],
  ])
    assert.equal(
      weatherAppearance({ condition, isDaytime: true }).condition,
      expected,
    );
  const html = forecast(report([
    { ...weatherHour, condition: "Snow showers", isDaytime: false },
  ]));
  assert.match(html, /weather-snow weather-night/);
});
test("compact charts distinguish gaps and unavailable values from real zero", () => {
  const html = renderToStaticMarkup(
    <ConditionTrend
      label="Clouds"
      values={[5, null, 30]}
      format={String}
      start="7 AM"
      end="9 AM"
    />,
  );
  assert.doesNotMatch(html, /NaN|Infinity/);
  // The missing middle hour splits the line into two separate runs.
  assert.equal((html.match(/class="condition-line"/g) || []).length, 2);
  const missing = renderToStaticMarkup(
    <ConditionScale label="AQI" value={null} maximum={500} />,
  );
  assert.match(missing, /unavailable/i);
  assert.doesNotMatch(missing, /0 on a scale/);
  const banded = renderToStaticMarkup(
    <ConditionScale label="AQI" value={33} maximum={500}
      bands={[{ from: 0, label: "Good" }, { from: 51, label: "Moderate" }, { from: 101, label: "Sensitive" }]} />,
  );
  assert.match(banded, /in the Good range \(0 to 51\)/);
  assert.equal((banded.match(/condition-band-seg is-active/g) || []).length, 1);
  const zero = renderToStaticMarkup(
    <AccumulationBars
      label="Rain"
      rows={[{ label: "12h", value: 0, display: "0 in" }]}
    />,
  );
  assert.match(zero, /width:0%/);
});
test("daylight chart accepts solar times with seconds from the report", () => {
  const html = renderToStaticMarkup(
    <DaylightChart start="07:00" hours={9} sunrise="6:26:22 AM" sunset="7:08:07 PM" />,
  );
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector('.daylight-track'));
  assert.doesNotMatch(html, /unavailable|NaN/);
  const sun = document.querySelector('.daylight-sun');
  assert.ok(Math.abs(parseFloat(sun.style.left) - 386 / 1440 * 100) < 0.001);
  assert.ok(Math.abs(parseFloat(sun.style.width) - 762 / 1440 * 100) < 0.001);
});

test("daylight chart marks overnight trips and refuses missing solar data", () => {
  assert.match(
    renderToStaticMarkup(
      <DaylightChart start="22:00" hours={8} sunrise="06:30" sunset="19:30" />,
    ),
    /returning the following day/,
  );
  assert.match(
    renderToStaticMarkup(<DaylightChart start="22:00" hours={8} />),
    /unavailable/,
  );
});

import { parseExplanation } from "../src/field/ai-explanation";
import { AiExplanation } from "../src/field/AiExplanation";
test("AI explanation splits inline labels without losing long continuation paragraphs", () => {
  const continuation =
    "A separate observation needs verification before departure. "
      .repeat(12)
      .trim();
  const parts = [
    ["BIG PICTURE", "Wind builds after noon."],
    ["WHY IT MATTERS", `Gusts reach 35 mph.\n\n${continuation}`],
    ["WATCH CLOSELY", "Watch the 2 PM window."],
    ["DATA CONFIDENCE", "The station report is 3 hours old."],
    ["COMFORT CHECK", "Temperatures stay near 50°F."],
    ["BEST MOVE", "Choose sheltered terrain."],
  ];
  const parsed = parseExplanation(
    parts.map(([label, text]) => `${label}: ${text}`).join(" "),
  );
  assert.equal(parsed.length, 6);
  assert.deepEqual(
    parsed.map((section) => section.text),
    parts.map(([, text]) => text),
  );
  const html = renderToStaticMarkup(
    <AiExplanation
      text={parts.map(([label, text]) => `${label}: ${text}`).join(" ")}
    />,
  );
  assert.match(html, /<h3>Big picture<\/h3>/);
  assert.match(html, /<h3>Best move<\/h3>/);
  assert.match(html, /Choose sheltered terrain/);
  // Inverted pyramid: overview, then the recommended move, then support in brief order.
  assert.deepEqual(
    [...html.matchAll(/ai-explanation-section is-(\w+)/g)].map((m) => m[1]),
    ["overview", "action", "evidence", "watch", "confidence", "comfort"],
  );
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /Not a safety factor/);
  assert.doesNotMatch(html, /BIG PICTURE:/);
});
test("AI explanation retains legacy text, preambles, markdown labels and unknown sections", () => {
  const text =
    "A plain legacy explanation.\n\nAnother paragraph with 0.5 in of rain.";
  assert.equal(parseExplanation(text)[0].text, text);
  const sections = parseExplanation(
    "Intro remains.\n## BIG PICTURE: Calm early.\n**BEST MOVE:** Turn back before noon.\nOTHER NOTES: Keep this too.",
  );
  assert.equal(sections.length, 3);
  assert.equal(sections[0].text, "Intro remains.");
  assert.equal(
    sections[2].text,
    "Turn back before noon.\nOTHER NOTES: Keep this too.",
  );
  assert.deepEqual(parseExplanation("  "), []);
});

import { parseSnowAnalysis } from "../src/field/ai-explanation";
import { SnowAnalysis } from "../src/field/AiExplanation";
test("snow analysis splits upper-case labels only and leads with coverage and takeaway", () => {
  const text =
    "SNOW COVERAGE: About 60% snow above 7,500 ft. TERRAIN PATTERN: Continuous in the upper basin; the main uncertainty: shadow on north aspects. GROUND CHECK: Paradise reports 38 in. UNCERTAINTY: Imagery is 9 days old. TRAVEL TAKEAWAY: Expect a transition near 7,000 ft.";
  const sections = parseSnowAnalysis(text);
  assert.deepEqual(
    sections.map((s) => s.kind),
    ["coverage", "terrain", "ground", "uncertainty", "takeaway"],
  );
  assert.match(sections[1].text, /the main uncertainty: shadow on north aspects/);
  assert.deepEqual(parseSnowAnalysis("Legacy **snow** notes."), [
    { kind: "note", title: "Snow analysis", text: "Legacy **snow** notes." },
  ]);
  const html = renderToStaticMarkup(
    <SnowAnalysis text={text} image="data:image/png;base64,AA==" />,
  );
  assert.deepEqual(
    [...html.matchAll(/ai-explanation-section is-(\w+)/g)].map((m) => m[1]),
    ["coverage", "takeaway", "terrain", "ground", "uncertainty"],
  );
  assert.match(html, /ai-explanation-supporting is-three/);
  assert.match(html, /<figcaption>Sentinel-2/);
  assert.doesNotMatch(renderToStaticMarkup(<SnowAnalysis text={text} />), /<figure/);
});

import {
  mergeModelDrafts,
  modelOptions,
} from "../src/field/model/model-drafts";
import { ModelSelect } from "../src/field/ModelSelect";
test("admin refresh preserves unsaved models while updating untouched fields", () => {
  const previous = {
    openai: { primary: "old-primary", fast: "old-fast" },
    gemini: { primary: "g-primary", fast: "g-fast" },
  };
  const current = {
    ...previous,
    openai: { ...previous.openai, primary: "my-unsaved-model" },
  };
  const next = {
    ...previous,
    openai: { primary: "remote-primary", fast: "remote-fast" },
  };
  const merged = mergeModelDrafts(current, previous, next);
  assert.equal(merged.openai.primary, "my-unsaved-model");
  assert.equal(merged.openai.fast, "remote-fast");
  assert.equal(merged.gemini.primary, "g-primary");
  assert.deepEqual(mergeModelDrafts(previous, null, next), next);
});
test("model selector exposes the full catalog and retains configured models", () => {
  const options = modelOptions(
    ["model-a", "model-b", "model-a"],
    ["older-configured-model", ""],
  );
  assert.deepEqual(options, ["model-a", "model-b", "older-configured-model"]);
  const html = renderToStaticMarkup(
    <ModelSelect
      label="OpenAI primary model"
      value="model-a"
      options={options}
      disabled={false}
      onChange={() => {}}
    />,
  );
  assert.match(html, /<select/);
  assert.match(html, /<option value="model-b"/);
  assert.match(html, /Enter a custom model ID/);
  assert.doesNotMatch(html, /<datalist/);
});

import { JSDOM } from 'jsdom';
import { makeReport } from '../dev/mock-data.mjs';
import { ScoreExplanation } from '../src/field/ScoreExplanation';

test('score explanation preserves canonical fractional scores, safeguards, and separate confidence reasons', () => {
  const html = renderToStaticMarkup(<ScoreExplanation safety={{
    score: 46.3, confidence: 64, scoreVersion: '2.8.0', tier: 'High',
    groupImpacts: { airQuality: { effective: 46, floor: 46, floorReason: 'US AQI 220' }, weather: { effective: 7.7 } },
    confidenceReasons: ['Complete hourly weather coverage for 4/8 travel-window hours.'],
    factors: [{ hazard: 'Wind', impact: 8, message: 'Wind increases late.', source: 'Hourly forecast' }],
  }} />);
  assert.match(html, /46\.3/);
  assert.match(html, /Air quality/);
  assert.match(html, /−46 pts/);
  assert.match(html, /Hazard safeguard:/);
  assert.match(html, /US AQI 220/);
  assert.match(html, /4\/8 travel-window hours/);
  assert.match(html, /Wind increases late/);
  assert.doesNotMatch(html, /airQuality|\+8|NaN|Infinity/);
  assert.ok(html.indexOf('Air quality') < html.indexOf('Weather &amp; exposure'));
});

test('older score reports use deduction aliases and missing evidence is explicit', () => {
  const html = renderToStaticMarkup(<ScoreExplanation safety={{ score: 80, groupImpacts: { weather: { capped: 20 } }, explanations: ['Legacy forecast explanation.'] }} />);
  assert.match(html, /−20 pts/);
  assert.match(html, /Not assessed/);
  assert.match(html, /Legacy forecast explanation/);
  assert.doesNotMatch(html, /Hazard safeguard|undefined|NaN/);
  const empty = renderToStaticMarkup(<ScoreExplanation safety={{ score: 100 }} />);
  assert.match(empty, /No group deductions were supplied/);
  assert.doesNotMatch(empty, /No hazards/);
});

test('supplemental sources distinguish unavailable data, probabilities, zero smoke and regional text', async () => {
  const { SupplementalEvidence } = await import('../src/field/SupplementalEvidence');
  const html = renderToStaticMarkup(<SupplementalEvidence evidence={{
    synoptic: { source: 'Synoptic Weather', kind: 'observation', available: false, status: 'not_configured', note: 'Not configured.' },
    nbm: { source: 'NOAA NBM', kind: 'probabilistic_forecast', available: true, status: 'ok', station: { id: 'KSAN', name: 'Airport', distanceKm: 12, elevationFt: 13 }, points: [{ validTime: '2026-09-17T12:00:00Z', windMph: { p10: 0, p50: 5, p90: 12 } }] },
    hrrrSmoke: { source: 'HRRR-Smoke', kind: 'modeled_forecast', available: true, status: 'ok', nearSurfaceUgM3: 0, columnMgM2: 0, validTime: '2026-09-17T12:00:00Z' },
    discussion: { source: 'NWS discussion', kind: 'regional_context', available: true, status: 'ok', office: 'SGX', text: '<script>untrusted</script>\nRegional discussion.' },
  }} />);
  for (const expected of [/Not configured/, /P10/, /Median/, /P90/, /0 mph/, /0 µg\/m³/, /0 mg\/m²/, /Regional forecaster context/, /&lt;script&gt;/, /do not change its safety score/]) assert.match(html, expected);
  assert.doesNotMatch(html, /<script>|NaN/);
  assert.equal(renderToStaticMarkup(<SupplementalEvidence />), '');
});

test('supplemental sources lead with trip-relevant evidence for a later start', async () => {
  const { SupplementalEvidence } = await import('../src/field/SupplementalEvidence');
  const timing = { checkedTime: '2026-09-16T21:00:00Z', targetTime: '2026-09-19T14:00:00Z' };
  const html = renderToStaticMarkup(<SupplementalEvidence evidence={{
    synoptic: { ...timing, source: 'Synoptic Weather', kind: 'observation', available: true, status: 'ok', stations: [{ id: 'RIDGE', name: 'Ridge', distanceKm: 4, readings: { windMph: { value: 20, observedTime: '2026-09-16T20:50:00Z' } } }] },
    nbm: { ...timing, source: 'NOAA NBM', kind: 'probabilistic_forecast', available: true, status: 'ok', points: [
      { validTime: '2026-09-19T00:00:00Z', windMph: { p10: 1, p50: 2, p90: 3 } },
      { validTime: '2026-09-19T12:00:00Z', windMph: { p10: 4, p50: 5, p90: 6 } },
    ] },
    hrrrSmoke: { ...timing, source: 'HRRR-Smoke', kind: 'modeled_forecast', available: false, status: 'out_of_range', note: 'Selected time is outside the latest 48-hour HRRR run.' },
    discussion: { ...timing, source: 'NWS discussion', kind: 'regional_context', available: true, status: 'ok', office: 'SGX', text: 'FULL TEXT', tripDayOffset: 3, sections: [
      { title: 'KEY MESSAGES', kind: 'key_messages', matchesTrip: null, text: 'Key point.' },
      { title: 'SHORT TERM', period: 'Tonight through Friday', kind: 'period', matchesTrip: false, text: 'Short stuff.' },
      { title: 'LONG TERM', period: 'Saturday through Tuesday', kind: 'period', matchesTrip: true, text: 'Long stuff.' },
      { title: 'AVIATION', kind: 'not_relevant', matchesTrip: null, text: 'Cloud bases.' },
    ] },
  }} />);
  // Forecasts for the trip come before current observations, which are collapsed.
  assert.ok(html.indexOf('NOAA NBM') < html.indexOf('NWS discussion'));
  assert.ok(html.indexOf('NWS discussion') < html.indexOf('Synoptic Weather'));
  assert.match(html, /show conditions now, not during the trip/);
  assert.match(html, /<details><summary>Show 1 current station reading<\/summary>/);
  // The NBM row nearest the start is marked and labeled relative to the start.
  assert.match(html, /<tr class="is-closest"><th scope="row">[^<]*<small>2 h before your start<\/small>/);
  // Only the matching period is expanded; aviation is left to the full text.
  assert.match(html, /<h4>Long term · Saturday through Tuesday<span class="supplemental-match">Includes your date<\/span><\/h4><pre>Long stuff.<\/pre>/);
  assert.match(html, /<summary>Short term · Tonight through Friday \(another period\)<\/summary>/);
  assert.doesNotMatch(html, /Aviation/);
  // Unavailable sources are listed compactly after the usable evidence.
  assert.match(html, /Not available for this report<\/h3><ul><li><strong>HRRR-Smoke<\/strong> · Outside coverage/);
  assert.doesNotMatch(html, /NaN/);
});

test('surface outlook exposes coverage, changing footing, and missing evidence', () => {
  const html = renderToStaticMarkup(<SurfacePrediction condition={{
    confidenceReasons: ['Preceding-night refreeze evidence is incomplete.'],
    moisture: { state: 'unknown', summary: 'Drainage is unknown.', retainedRainIn: null, lookbackHours: null },
    outlook: { coverage: 'snow_signal', state: 'snow_mixed', travelEffects: ['Slippery footing possible'], coverageHours: 2.5, requestedHours: 4, terrainLimitations: 'Route aspect is not measured.', timeline: [{ time: '8 AM', durationHours: 0.5, state: 'firm_or_frozen_possible' }, { time: '9 AM', durationHours: 1, state: 'softening_possible' }] },
  }} />);
  for (const text of ['2.5 of 4', 'Route aspect is not measured', 'firm or frozen possible', 'softening possible', 'Preceding-night', 'Drainage is unknown']) assert.ok(html.includes(text));
  assert.equal(renderToStaticMarkup(<SurfacePrediction condition={{ label: 'Legacy surface' }} />), '');
});

import { ReportInsights } from '../src/field/ReportInsights';
import { reportInsightItems } from '../src/app/report-insights';
const accessInsight = { id: 'access', tone: 'caution', title: 'Verify the approach before committing', meaning: 'Nearby closures have not been matched to your route.', action: 'Check road names and choose an alternate approach if needed.', features: ['fieldObservations'], decisionRelevant: true, evidence: [{ source: 'Land manager', detail: '<script>bad()</script> Road work', url: 'https://www.nps.gov/alerts' }] };
test('source insights are actionable, traceable and escape provider text', () => {
  const data = makeReport({}, 'field-alerts');
  data.reportInsights = { version: 1, summary: 'Access needs review', items: [accessInsight] };
  const html = renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />);
  assert.match(html, /Before you commit/);
  assert.match(html, /1 check to resolve/);
  assert.match(html, /For your plan/);
  assert.match(html, /Why the report says this/);
  assert.match(html, /not been matched to your route/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /https:\/\/www.nps.gov\/alerts/);
});
test('access review hides with field observations turned off', () => {
  const data = makeReport({}, 'field-alerts');
  data.reportInsights = { version: 1, summary: '', items: [accessInsight] };
  assert.equal(reportInsightItems(data).length, 1);
  data.featureFlags = { ...data.featureFlags, fieldObservations: false };
  assert.equal(reportInsightItems(data).length, 0);
  assert.equal(renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />), '');
});
const contextInsight = (id, tone = 'context') => ({ id, tone, title: `${id} title`, meaning: `${id} meaning`, action: `${id} action`, features: ['fieldObservations'], decisionRelevant: false, evidence: [] });
test('insights panel leads with cautions and hides disclaimer-only notes', () => {
  const data = makeReport({}, 'field-alerts');
  data.reportInsights = { version: 1, summary: '', items: [accessInsight, contextInsight('tides'), contextInsight('evidence-gaps', 'gap'), contextInsight('water'), contextInsight('station-wind')] };
  const html = renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />);
  assert.match(html, /1 check to resolve/);
  assert.match(html, /1 background note</);
  assert.match(html, /tides title/);
  assert.doesNotMatch(html, /evidence-gaps title|water title|station-wind title/);
});
test('insights collapse to one line when nothing needs review', () => {
  const data = makeReport({}, 'field-alerts');
  data.reportInsights = { version: 1, summary: '', items: [contextInsight('tides'), contextInsight('smoke')] };
  const html = renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />);
  assert.match(html, /^<details class="report-insights report-insights-quiet">/);
  assert.match(html, /No field or access flags · 2 background notes/);
  assert.doesNotMatch(html, /Before you commit/);
  data.reportInsights.items = [contextInsight('access'), contextInsight('evidence-gaps', 'gap')];
  assert.equal(renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />), '');
});
test('older reports without synthesis retain compatible rendering', () => {
  assert.equal(renderToStaticMarkup(<ReportInsights data={makeReport({}, 'field-alerts')} onSources={() => {}} />), '');
});

