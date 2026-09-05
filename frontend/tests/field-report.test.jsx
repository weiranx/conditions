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
