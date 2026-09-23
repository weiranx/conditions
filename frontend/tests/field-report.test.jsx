import { bluebirdPercentage } from "../src/app/bluebird";
import { SurfacePrediction } from "../src/field/SurfacePrediction";
import { evaluateBackcountryDecision } from '../src/app/decision';
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Forecast } from "../src/field/Forecast";
import Compare from "../src/field/Compare";
import { buildPersistedReport } from "../src/app/report-storage";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { emptyAi } from "../src/field/data";
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
test("bluebird share excludes night and respects cloud, precipitation, and visibility limits", () => {
  const result = bluebirdPercentage([
    weatherHour,
    { ...weatherHour, cloudCover: 20, precipChance: 10 },
    { ...weatherHour, cloudCover: 21 },
    { ...weatherHour, precipChance: 11 },
    { ...weatherHour, condition: 'Fog' },
    { ...weatherHour, condition: 'Snow showers' },
    { ...weatherHour, isDaytime: false },
  ]);
  assert.equal(result.percent, 33);
  assert.equal(result.daylightHours, 6);
  assert.equal(result.bluebirdHours, 2);
});
test("bluebird share preserves missing evidence and genuine zeroes", () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 101]) {
    assert.equal(bluebirdPercentage([{ ...weatherHour, cloudCover: value }]).percent, null);
    assert.equal(bluebirdPercentage([{ ...weatherHour, precipChance: value }]).percent, null);
  }
  assert.equal(bluebirdPercentage([]).percent, null);
  assert.equal(bluebirdPercentage([{ ...weatherHour, isDaytime: false }]).percent, null);
  assert.equal(bluebirdPercentage([weatherHour, { ...weatherHour, isDaytime: null }]).percent, null);
  assert.equal(bluebirdPercentage([{ ...weatherHour, cloudCover: 100 }]).percent, 0);
  assert.equal(bluebirdPercentage([{ ...weatherHour, cloudCover: 0, precipChance: 0 }]).percent, 100);
});
test("forecast explains bluebird percentage and partial coverage", () => {
  const html = renderToStaticMarkup(<Forecast report={report([weatherHour])} />);
  assert.match(html, /Bluebird day <strong>100%/);
  assert.match(html, /1\/1 daylight hours/);
  assert.match(html, /Available forecast: 1\/3 requested hours/);
  assert.match(html, /not the probability of a whole bluebird day/);
  const missing = renderToStaticMarkup(<Forecast report={report([{ ...weatherHour, cloudCover: null }])} />);
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
    { weather: { trend }, capabilities: { ai: false } },
    emptyAi,
    { preferences: customPreferences },
  );
}
test("hourly forecast converts temperature and wind using the report preferences", () => {
  const html = renderToStaticMarkup(
    <Forecast
      report={report([weatherHour], {
        ...preferences,
        temperatureUnit: "c",
        windSpeedUnit: "kph",
      })}
    />,
  );
  assert.match(html, /10°C/);
  assert.match(html, /16 kph/);
  assert.doesNotMatch(html, /50°F/);
});
test("a missing hourly forecast is explicitly unavailable", () => {
  const html = renderToStaticMarkup(<Forecast report={report([])} />);
  assert.match(html, /Hourly forecast is unavailable/);
  assert.doesNotMatch(html, /within limits|NaN|Infinity/);
});
test("sparse chart readings never create invalid SVG coordinates", () => {
  const html = renderToStaticMarkup(
    <Forecast
      report={report([
        weatherHour,
        { ...weatherHour, time: "10:00", temp: null },
        { ...weatherHour, time: "11:00", temp: 55 },
      ])}
    />,
  );
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /Hour by hour/);
  assert.match(html, /Hourly evidence is incomplete/);
  assert.doesNotMatch(html, />0°F</);
});
function comparison(decisions, overrides = {}) {
  const days = decisions.map((day) => ({
    decisionHeadline: `Decision for ${day.date}`,
    safetyData: { weather: { trend: [] }, capabilities: { ai: false } },
    windGustMph: 10,
    precipChance: 5,
    travelPassHours: 3,
    travelTotalHours: 3,
    tempLowF: 40,
    tempHighF: 50,
    expectedRainIn: 1,
    expectedSnowIn: 1,
    alertCount: 0,
    ...day,
  }));
  const w = {
    preferences: { ...preferences, elevationUnit: "m" },
    tripForecastRows: days,
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
    { date: "2026-09-06", decisionLevel: "CAUTION", score: 75, windGustMph: 0, precipChance: 0, travelPassHours: 1, travelTotalHours: 1 },
    { date: "2026-09-07", decisionLevel: "GO", score: 70, windGustMph: 0, precipChance: 0, travelPassHours: 2, travelTotalHours: 3 },
  ]);
  assert.match(html, /Every day, side by side/);
  assert.match(html, /All days tied/);
  assert.match(html, /Only 1 of 3 planned hours covered/);
  assert.match(html, /2 hours within limits/);
  assert.match(html, /Departure gust/);
  assert.match(html, /Avalanche conditions are excluded/);
});

test("missing comparison readings stay unavailable and do not win weather highlights", () => {
  const html = comparison([
    { date: "2026-09-06", decisionLevel: "CAUTION", score: null, windGustMph: null, precipChance: null, travelPassHours: 0, travelTotalHours: 0, partialData: true },
  ]);
  assert.match(html, /Score unavailable/);
  assert.match(html, /Hourly forecast unavailable/);
  assert.match(html, /Partial data/);
  assert.doesNotMatch(html, /NaN|Infinity|0 \/ 0 hours|0 mph|unavailable%/);
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
import { fieldSignals } from "../src/field/field-signals";
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
  const html = renderToStaticMarkup(
    <Forecast
      report={report([
        { ...weatherHour, condition: "Snow showers", isDaytime: false },
      ])}
    />,
  );
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
  assert.match(html, /M\s*8/);
  assert.match(html, /M\s*292/);
  const missing = renderToStaticMarkup(
    <ConditionScale label="AQI" value={null} maximum={500} />,
  );
  assert.match(missing, /unavailable/i);
  assert.doesNotMatch(missing, /0 on a scale/);
  const zero = renderToStaticMarkup(
    <AccumulationBars
      label="Rain"
      rows={[{ label: "12h", value: 0, display: "0 in" }]}
    />,
  );
  assert.match(zero, /width:0%/);
});
test("field signals flag reported issues without treating missing or clear feeds as warnings", () => {
  const signals = fieldSignals(
    {
      access: { available: true, closedRoadCount: 1 },
      radar: {
        available: true,
        lightning: { available: true, detectionAtObjective: true },
      },
      streamflow: { available: true, trend: "rising" },
      smoke: {
        available: true,
        currentCategory: "Good",
        peakCategory: "Unhealthy for sensitive groups",
      },
    },
    { maxWindGustMph: 25 },
  );
  assert.deepEqual(
    signals.filter((s) => s.tone === "attention").map((s) => s.key),
    ["roads", "lightning", "water", "smoke"],
  );
  assert.equal(
    fieldSignals(null, { maxWindGustMph: 25 })[0].tone,
    "unavailable",
  );
  assert.equal(
    fieldSignals(
      {
        access: { available: true, closedRoadCount: 0 },
        radar: { available: true, echoDetected: false },
      },
      { maxWindGustMph: 25 },
    ).filter((s) => s.tone === "attention").length,
    0,
  );
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
  assert.match(html, /ai-explanation-detail is-watch[^>]*open/);
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
import { ReportVerdict } from '../src/field/ReportVerdict';
import { makeReport } from '../dev/mock-data.mjs';
test('verdict keeps caution, stale evidence, and field warnings visible beside the score', () => {
  const data = makeReport({}, 'field-alerts');
  const html = renderToStaticMarkup(<ReportVerdict data={data}
    decision={{ level: 'CAUTION', headline: 'Review conditions before committing.', blockers: [], cautions: [] }}
    primaryReason="Weather and precipitation timestamps need review."
    freshnessWarning="Weather and precipitation feeds are stale or missing timestamps."
    preferences={preferences} onSources={() => {}} />);
  const dom = new JSDOM(html);
  const root = dom.window.document;
  const reason = root.querySelector('.report-decision-reason');
  assert.match(reason.textContent, /timestamps need review/);
  assert.equal(reason.closest('details'), null);
  const warnings = root.querySelector('[aria-label="Warnings and evidence gaps"]');
  assert.match(warnings.textContent, /Some sources may be out of date/);
  assert.match(warnings.textContent, /Lightning detected at the objective/);
  assert.match(warnings.textContent, /road closure/);
  assert.match(warnings.textContent, /land-manager notice/);
  assert.equal(warnings.querySelector('details'), null);
  assert.match(warnings.querySelector('li').textContent, /Lightning/);
  dom.window.close();
});
test('verdict respects disabled field observations and does not invent field warnings', () => {
  const data = makeReport({}, 'field-alerts');
  const html = renderToStaticMarkup(<ReportVerdict data={{ ...data, featureFlags: { fieldObservations: false } }}
    decision={{ level: 'GO', headline: 'Within thresholds.', blockers: [], cautions: [] }}
    primaryReason="Within selected thresholds." freshnessWarning={null}
    preferences={preferences} onSources={() => {}} />);
  assert.doesNotMatch(html, /Lightning detected|Field reports to check|Warnings and evidence gaps/);
});

import { ScoreExplanation } from '../src/field/ScoreExplanation';
import { ReportSummary } from '../src/field/ReportSummary';
import { buildReportWeatherRows, buildPlannedReportWeatherRows } from '../src/field/report-weather';
import { buildTravelWindowInsights } from '../src/app/travel-window';

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

function summaryWorkspace(data, overrides = {}) {
  return {
    safetyData: data, preferences, travelWindowHours: 3, alpineStartTime: "09:00", forecastDate: "2026-09-06",
    formatWindDisplay: (v) => v == null ? '—' : `${v} mph`,
    formatClockForStyle: (v) => v || '—',
    expectedRainWindowDisplay: '0.1 in', expectedTravelWindowHours: 3,
    returnMinutes: 1260, sunsetMinutesForPlan: 1200,
    returnTimeDisplay: '21:00', returnExtendsPastMidnight: false,
    displayStartTime: '18:00', ...overrides,
  };
}
test('summary distinguishes missing hours from passing hours and highlights a return after sunset', () => {
  const data = makeReport({}, 'clear');
  data.weather.trend = [weatherHour, { ...weatherHour, time: '10:00', temp: null }];
  data.weather.windGust = 40;
  data.terrainCondition = undefined;
  data.snowpack = undefined;
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data)} onOpen={() => {}} />);
  assert.match(html, /1 of 3 hours within limits/);
  assert.match(html, /Complete weather data for 1 of 3 hours/);
  assert.match(html, /Return is after sunset/);
  assert.match(html, /15 mph/);
  assert.doesNotMatch(html, /40 mph/);
  assert.equal((html.match(/class="is-missing"/g) || []).length, 2);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
test('summary does not imply clear weather when the hourly forecast is absent', () => {
  const data = makeReport({}, 'missing');
  data.weather.trend = [];
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data)} onOpen={() => {}} />);
  assert.match(html, /Hourly forecast unavailable/);
  assert.doesNotMatch(html, /hours within limits/);
});
test('report weather coverage preserves zero measurements and excludes hazards outside the window', () => {
  const data = makeReport({}, 'clear');
  data.weather.trend = [{ ...weatherHour, precipChance: 0 }, { ...weatherHour, gust: 80 }];
  data.terrainCondition = undefined;
  data.snowpack = undefined;
  const rows = buildReportWeatherRows(data, preferences, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].pass, true);
});

function weatherData(trend) { return { weather: { trend } }; }
const plannedWindow = { start: '06:00', date: '2026-09-06' };
test('summary peak gust follows the planned interval including the final partial hour', () => {
  const data = weatherData([5, 6, 7, 8, 9, 10].map(hour => ({ ...weatherHour,
    time: `${hour}:00`, gust: hour === 5 || hour === 10 ? 100 : hour === 9 ? 65 : 5,
  })));
  data.weather.windGust = 95;
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:30' })} onOpen={() => {}} />);
  assert.match(html, /<strong>65 mph<\/strong>/);
  assert.doesNotMatch(html, /<strong>(?:5|95|100) mph<\/strong>/);
});

test('summary peak gust stays unavailable without measured gusts inside the plan', () => {
  for (const trend of [[], [{ ...weatherHour, time: '05:00', gust: 90 }],
    [{ ...weatherHour, time: '06:00', gust: null }]]) {
    const data = weatherData(trend);
    data.weather.windGust = 95;
    const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:00' })} onOpen={() => {}} />);
    assert.match(html, /<strong>—<\/strong>/);
    assert.doesNotMatch(html, /<strong>\d+ mph<\/strong>/);
  }
  const data = weatherData([{ ...weatherHour, time: '06:00', gust: 0 }]);
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:00' })} onOpen={() => {}} />);
  assert.match(html, /<strong>0 mph<\/strong>/);
});

test('summary keeps a known gust warning visible alongside missing coverage', () => {
  const data = weatherData([{ ...weatherHour, time: '07:00', gust: 90, precipChance: null }]);
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:00' })} onOpen={() => {}} />);
  assert.match(html, /Complete weather data for 0 of 3 hours/);
  assert.match(html, /First hour outside your limits: 07:00 \(gust 90/);
});

test('summary rejects complete forecast readings outside the planned window', () => {
  const data = weatherData([9, 10, 11].map(hour => ({ ...weatherHour, time: `${hour}:00` })));
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:00' })} onOpen={() => {}} />);
  assert.match(html, /0 of 3 hours within limits/);
  assert.equal((html.match(/class="is-missing"/g) || []).length, 3);
});

test('planned weather rows preserve gaps and ignore duplicates and out-of-window hazards', () => {
  const data = weatherData([6, 6, 8, 9].map(hour => ({ ...weatherHour, time: `${hour}:00`, gust: hour === 9 ? 90 : 5 })));
  const rows = buildPlannedReportWeatherRows(data, preferences, 3, plannedWindow);
  assert.deepEqual(rows.map(row => [row.time, row.complete, row.pass]), [
    ['06:00', true, true], ['07:00', false, false], ['08:00', true, true],
  ]);
  assert.match(rows[1].reasonSummary, /No hourly forecast covers/);
  assert.equal(buildTravelWindowInsights(rows).passHours, 2);
});

test('Timing and summary both reject missing gust and precipitation but preserve measured zero', () => {
  const data = weatherData([{ ...weatherHour, time: '06:00', gust: null, precipChance: null },
    { ...weatherHour, time: '07:00', gust: 0, wind: 0, precipChance: 0 }]);
  const rows = buildPlannedReportWeatherRows(data, preferences, 2, plannedWindow);
  assert.deepEqual(rows.map(row => row.pass), [false, true]);
  assert.equal(buildTravelWindowInsights(rows).passHours, 1);
  const html = renderToStaticMarkup(<ReportSummary workspace={summaryWorkspace(data, { alpineStartTime: '06:00', travelWindowHours: 2 })} onOpen={() => {}} />);
  assert.match(html, /1 of 2 hours within limits/);
  assert.match(rows[0].reasonSummary, /incomplete/);
});

test('planned coverage uses dates and objective timezone across midnight', () => {
  const data = weatherData([
    { ...weatherHour, time: '11 PM', timeIso: '2026-09-07T06:00:00Z' },
    { ...weatherHour, time: '12 AM', timeIso: '2026-09-07T07:00:00Z' },
    { ...weatherHour, time: '1 AM', timeIso: '2026-09-08T08:00:00Z' },
  ]);
  data.weather.timezone = 'America/Los_Angeles';
  const rows = buildPlannedReportWeatherRows(data, preferences, 3, { ...plannedWindow, start: '23:00' });
  assert.deepEqual(rows.map(row => [row.time, row.pass]), [['23:00', true], ['00:00', true], ['01:00', false]]);
});

test('legacy clock labels roll over midnight and fractional starts do not borrow future readings', () => {
  const data = weatherData(['11 PM', '12 AM', '1 AM'].map(time => ({ ...weatherHour, time })));
  assert.deepEqual(buildPlannedReportWeatherRows(data, preferences, 3, { ...plannedWindow, start: '23:00' }).map(row => row.pass), [true, true, true]);
  const later = weatherData(['07:00', '08:00', '09:00'].map(time => ({ ...weatherHour, time })));
  assert.deepEqual(buildPlannedReportWeatherRows(later, preferences, 3, { ...plannedWindow, start: '06:30' }).map(row => row.pass), [false, true, true]);
});

test('missing weather does not erase known high-wind warnings', () => {
  const rows = buildReportWeatherRows(weatherData([{ ...weatherHour, gust: 90, precipChance: null }]), preferences, 1);
  assert.match(rows[0].reasonSummary, /incomplete/);
  assert.match(rows[0].reasonSummary, /gust/);
});

test('missing temperature never invents a freezing reading in the reasons', () => {
  const rows = buildReportWeatherRows(weatherData([{ ...weatherHour, temp: null }]), preferences, 1);
  assert.match(rows[0].reasonSummary, /incomplete/);
  assert.doesNotMatch(rows[0].reasonSummary, /feels|0°F/);
  assert.deepEqual(rows[0].failedRuleLabels, ['Incomplete hourly evidence']);
});

test('fractional departures include hazards in the final partial hour', () => {
  const data = weatherData([7, 8, 9].map(hour => ({ ...weatherHour, time: `${hour}:00`,
    gust: hour === 9 ? 90 : 5, condition: hour === 9 ? 'Thunderstorms' : 'Clear' })));
  const rows = buildPlannedReportWeatherRows(data, preferences, 3, { ...plannedWindow, start: '06:30' });
  assert.deepEqual(rows.map(row => [row.complete, row.pass]), [[false, false], [true, true], [true, false]]);
  assert.equal(rows[2].gust, 90);
  assert.equal(rows[2].lightningRisk, true);
  assert.match(rows[2].reasonSummary, /Thunderstorms/);
  assert.match(rows[2].reasonSummary, /gust/);
});

test('a gap in the final half hour is incomplete even when the slot starts with data', () => {
  const data = weatherData([6, 7, 8].map(hour => ({ ...weatherHour, time: `${hour}:00` })));
  const rows = buildPlannedReportWeatherRows(data, preferences, 3, { ...plannedWindow, start: '06:30' });
  assert.deepEqual(rows.map(row => row.complete), [true, true, false]);
  assert.equal(rows[2].pass, false);
  assert.match(rows[2].reasonSummary, /coverage is incomplete/);
});

test('interval checks retain cold and heat extremes and exclude hazards at the return boundary', () => {
  const data = weatherData([
    { ...weatherHour, time: '06:00', temp: -20 },
    { ...weatherHour, time: '07:00', temp: 110 },
    { ...weatherHour, time: '07:30', gust: 100, condition: 'Thunderstorms' },
  ]);
  const [row] = buildPlannedReportWeatherRows(data, preferences, 1, { ...plannedWindow, start: '06:30' });
  assert.equal(row.complete, true);
  assert.equal(row.pass, false);
  assert.ok(row.failedRuleLabels.includes('Feels-like below limit'));
  assert.ok(row.failedRuleLabels.includes('Heat above limit'));
  assert.equal(row.lightningRisk, false);
  assert.equal(row.gust, weatherHour.gust);
});

test('fractional intervals cross midnight without losing the next day storm', () => {
  const data = weatherData(['23:00', '00:00', '01:00'].map((time, index) => ({ ...weatherHour, time,
    timeIso: `2026-09-${index === 0 ? '06' : '07'}T${time}:00-07:00`,
    condition: index === 2 ? 'Thunderstorms' : 'Clear' })));
  const rows = buildPlannedReportWeatherRows(data, preferences, 2, { ...plannedWindow, start: '23:30' });
  assert.deepEqual(rows.map(row => row.complete), [true, true]);
  assert.equal(rows[1].lightningRisk, true);
  assert.equal(rows[1].pass, false);
});

test('insufficient report evidence suppresses the score and cannot produce GO', () => {
  const data = makeReport({}, 'field-alerts');
  data.safety = { ...data.safety, score: 99, confidence: 95, assessmentStatus: 'insufficient_evidence', evidenceQuality: 'Insufficient', coverage: { completeHours: 1.5, requestedHours: 2 }, evidenceReasons: ['Wind unavailable for the return.'] };
  const decision = evaluateBackcountryDecision(data, '12:00', preferences);
  assert.notEqual(decision.level, 'GO');
  assert.ok(decision.checks.some(check => check.key === 'evidence-coverage' && !check.ok));
  const html = renderToStaticMarkup(<ReportVerdict data={data} decision={decision} primaryReason="" freshnessWarning={null} preferences={preferences} onSources={() => {}} />);
  assert.match(html, /Insufficient evidence/);
  assert.match(html, /1.5 of 2 hours covered/);
  assert.doesNotMatch(html, /95%|>99</);
});

test('verdict explains a high score under a stricter decision only when they disagree', () => {
  const data = makeReport({}, 'clear');
  data.safety = { ...data.safety, score: 91, assessmentStatus: undefined };
  const render = (decision) => renderToStaticMarkup(<ReportVerdict data={data} decision={{ headline: 'Headline', blockers: [], cautions: [], checks: [], ...decision }} primaryReason="" freshnessWarning={null} preferences={preferences} onSources={() => {}} />);
  assert.match(render({ level: 'CAUTION', cautions: ['Cold', 'Wind'] }), /The score of 91 rates conditions overall\. The decision is set by 2 checks that need attention\./);
  assert.match(render({ level: 'NO-GO', blockers: ['Storm'] }), /The decision is set by a blocking check\./);
  assert.doesNotMatch(render({ level: 'GO' }), /report-decision-bridge/);
  data.safety.score = 78;
  assert.doesNotMatch(render({ level: 'CAUTION', cautions: ['Cold'] }), /report-decision-bridge/);
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
import { buildFieldBrief } from '../src/app/field-brief';
const accessInsight = { id: 'access', tone: 'caution', title: 'Verify the approach before committing', meaning: 'Nearby closures have not been matched to your route.', action: 'Check road names and choose an alternate approach if needed.', features: ['fieldObservations'], decisionRelevant: true, evidence: [{ source: 'Land manager', detail: '<script>bad()</script> Road work', url: 'https://www.nps.gov/alerts' }] };
test('source insights are actionable, traceable and escape provider text', () => {
  const data = makeReport({}, 'field-alerts');
  data.reportInsights = { version: 1, summary: 'Access needs review', items: [accessInsight] };
  const html = renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />);
  assert.match(html, /What this means for your trip/);
  assert.match(html, /For your plan/);
  assert.match(html, /Why the report says this/);
  assert.match(html, /not been matched to your route/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /https:\/\/www.nps.gov\/alerts/);
});
test('access review propagates into decision checks without changing safety score', () => {
  const data = makeReport({}, 'field-alerts');
  const original = data.safety.score;
  data.reportInsights = { version: 1, summary: '', items: [accessInsight] };
  const decision = evaluateBackcountryDecision(data, '12:00', preferences);
  assert.notEqual(decision.level, 'GO');
  assert.ok(decision.checks.some(check => check.key === 'source-access' && !check.ok));
  assert.ok(decision.cautions.some(text => text.includes(accessInsight.action)));
  assert.equal(data.safety.score, original);
  data.featureFlags = { ...data.featureFlags, fieldObservations: false };
  assert.equal(reportInsightItems(data).length, 0);
  assert.equal(renderToStaticMarkup(<ReportInsights data={data} onSources={() => {}} />), '');
  assert.ok(!evaluateBackcountryDecision(data, '12:00', preferences).checks.some(check => check.key === 'source-access'));
});
test('offline field brief carries interpreted findings and actions', () => {
  const data = makeReport({}, 'field-alerts'); data.reportInsights = { version: 1, summary: '', items: [accessInsight] };
  const brief = buildFieldBrief({ objectiveName: 'Test', forecastDate: '2026-09-16', startTime: '07:00', returnTime: '12:00', travelWindowHours: 5, activity: 'hiking', safetyData: data, decision: evaluateBackcountryDecision(data, '12:00', preferences), actionLine: '' });
  assert.match(brief.text, /REPORT INSIGHTS/); assert.ok(brief.text.includes(accessInsight.action)); assert.ok(brief.html.includes(accessInsight.meaning));
});
test('older reports without synthesis retain compatible rendering', () => {
  assert.equal(renderToStaticMarkup(<ReportInsights data={makeReport({}, 'field-alerts')} onSources={() => {}} />), '');
});

test('a source review changes an otherwise GO decision to CAUTION, never weakens NO-GO', () => {
  const data = makeReport({}, 'clear');
  data.featureFlags = { avalancheDetails: false, daylightTimeline: false, snowpackDetails: false, airQualityDetails: false, heatRiskDetails: false, fireRiskDetails: false, weatherContextDetails: false, fieldObservations: true };
  data.rainfall = { ...data.rainfall, anchorTime: new Date().toISOString() };
  const relaxed = { ...preferences, maxWindGustMph: 100, maxPrecipChance: 100, minFeelsLikeF: -100, maxFeelsLikeF: 150 };
  const before = evaluateBackcountryDecision(data, '23:59', relaxed);
  assert.equal(before.level, 'GO', JSON.stringify(before));
  data.reportInsights = { version: 1, summary: '', items: [accessInsight] };
  assert.equal(evaluateBackcountryDecision(data, '23:59', relaxed).level, 'CAUTION');
  data.weather.description = 'Weather data unavailable';
  assert.equal(evaluateBackcountryDecision(data, '23:59', relaxed).level, 'NO-GO');
});
