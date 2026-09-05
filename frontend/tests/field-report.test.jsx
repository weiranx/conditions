import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Forecast } from "../src/field/Forecast";
import Compare from "../src/field/Compare";
import { buildPersistedReport } from "../src/app/report-storage";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { emptyAi } from "../src/field/data";
const preferences = getDefaultUserPreferences();
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
  assert.match(html, /Hourly evidence is unavailable/);
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
function comparison(decisions) {
  const days = decisions.map((day) => ({
    ...day,
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
