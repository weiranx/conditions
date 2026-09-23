import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContingencyCard } from "../src/field/ContingencyCard";
import { buildFieldBrief } from "../src/app/field-brief";
import { evaluateBackcountryDecision } from "../src/app/decision";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { makeReport } from "../dev/mock-data.mjs";

const clock = (minute) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const fahrenheit = (value) => (Number.isFinite(value) ? `${Math.round(value)}°F` : "—");
const celsius = (value) => (Number.isFinite(value) ? `${Math.round(((value - 32) * 5) / 9)}°C` : "—");
const mph = (value) => (Number.isFinite(value) ? `${Math.round(value)} mph` : "—");

const contingency = {
  status: "ok",
  plannedReturnIso: "2026-09-24T01:00:00.000Z",
  summary: "",
  delayBuffer: {
    hours: 3,
    startIso: null,
    endIso: null,
    coveredHours: 3,
    complete: true,
    minFeelsLikeF: 40,
    peakGustMph: 35,
    peakPrecipChance: 70,
    onsetHazards: [{ key: "storm", label: "Thunderstorms", onsetIso: null, hoursAfterReturn: 1 }],
    nightfall: { onsetIso: null, hoursAfterReturn: 2 },
    summary: "If you're delayed up to 3 h, expect thunderstorms from about 1 h after your planned return.",
  },
  overnight: {
    status: "ok",
    relevant: true,
    reasons: ["Long day (9 h)", "Night feels like 13°F"],
    reasonCodes: ["longDay", "coldNight"],
    summary: "An unplanned night would be serious: feels like 13°F at the coldest.",
    complete: true,
    hoursToDark: 2,
    lowTempF: 26,
    minFeelsLikeF: 13,
    peakWindMph: 18,
    peakGustMph: 30,
    peakPrecipChance: 80,
    snow: true,
    severity: "high",
  },
};

const render = (props = {}) => renderToStaticMarkup(
  <ContingencyCard contingency={contingency} returnMinutes={18 * 60} clock={clock} formatTemp={fahrenheit} formatWind={mph} {...props} />,
);

test("the delay card anchors new hazards to clock times after the planned return", () => {
  const html = render();
  assert.match(html, /If you(&#x27;|')re delayed/);
  assert.match(html, /back by 21:00/);
  assert.match(html, /Thunderstorms from 19:00 · Dark by 20:00/);
  assert.match(html, /Unplanned night/);
  assert.match(html, /Serious/);
  assert.match(html, /13°F/);
  assert.match(html, /a long day · a night that feels like 13°F/);
});

test("the delay card formats temperatures with the viewer's unit, not the backend's °F text", () => {
  const html = render({ formatTemp: celsius });
  assert.match(html, /-11°C/);
  assert.doesNotMatch(html, /13°F/);
});

test("the delay card says so when the buffer adds nothing", () => {
  const quiet = { ...contingency, delayBuffer: { ...contingency.delayBuffer, onsetHazards: [], nightfall: null }, overnight: null };
  const html = render({ contingency: quiet });
  assert.match(html, /the forecast adds no new hazards/);
  assert.doesNotMatch(html, /Unplanned night/);
});

test("the delay card renders nothing without a usable assessment", () => {
  assert.equal(render({ contingency: null }), "");
  assert.equal(render({ contingency: { ...contingency, status: "unavailable" } }), "");
});

test("the field brief carries the late-return scenarios unless the feature is off", () => {
  const preferences = getDefaultUserPreferences();
  const data = makeReport({ start: "09:00", travel_window_hours: 9 }, "mixed");
  assert.equal(data.contingency?.status, "ok");
  const input = {
    objectiveName: "Test", forecastDate: "2026-09-23", startTime: "09:00", returnTime: "18:00", travelWindowHours: 9,
    activity: "hiking", safetyData: data, decision: evaluateBackcountryDecision(data, "18:00", preferences), actionLine: "",
  };
  const brief = buildFieldBrief(input);
  assert.match(brief.text, /IF YOU'RE DELAYED/);
  assert.ok(brief.text.includes(data.contingency.overnight.summary));
  assert.match(brief.html, /If you(&#39;|&#x27;|')re delayed/);

  const disabled = { ...data, featureFlags: { ...data.featureFlags, contingencyPlanning: false } };
  const off = buildFieldBrief({ ...input, safetyData: disabled });
  assert.doesNotMatch(off.text, /IF YOU'RE DELAYED/);
});
