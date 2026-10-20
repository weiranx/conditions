// The report's reference material waits in folds whose one line carries the key
// number, so a closed report still says what is inside and nothing is lost.
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Fold } from "../src/field/sky/Fold";
import { ContingencyCard } from "../src/field/ContingencyCard";
import { ScoreExplanation } from "../src/field/ScoreExplanation";
import { SupplementalEvidence } from "../src/field/SupplementalEvidence";
import { Conditions } from "../src/field/Conditions";
import { Sources } from "../src/field/Sources";
import { GearActions, GearLead } from "../src/field/GearActions";
import { AiLead, SourcesLead } from "../src/field/chapter-leads";
import { aiChapterText } from "../src/app/ai-evidence";
import { SUMMIT_TERMS } from "../src/app/objective-terms";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { interpret } from "./evaluation-fixtures";

/** The text on a fold's closed line: its label and its hint. */
const foldLine = (html, id) => {
  const start = html.indexOf(`<h2 id="${id}"`);
  assert.ok(start >= 0, `fold ${id} is present`);
  return html.slice(start, html.indexOf("</summary>", start)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};
const foldOpen = (html, id) => {
  const summary = html.lastIndexOf("<details", html.indexOf(`<h2 id="${id}"`));
  return /^<details[^>]* open/.test(html.slice(summary));
};

test("a fold is a small label and its key fact on one closed line", () => {
  const html = renderToStaticMarkup(<Fold id="sky-x" title="Rain and snow" hint="0.07 in rain · 0.8 in snow expected"><p>Detail</p></Fold>);
  assert.match(html, /<details><summary><span class="sky-fold-text"><h2 id="sky-x" class="sky-subhead">Rain and snow<\/h2><span class="sky-fold-hint">0.07 in rain · 0.8 in snow expected<\/span>/);
  assert.match(html, /Detail/, "the detail is in the page, only folded");
});

const clock = (minute) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const contingency = {
  status: "ok", plannedReturnIso: "2026-09-24T01:00:00.000Z", summary: "",
  delayBuffer: { hours: 3, startIso: null, endIso: null, coveredHours: 3, complete: true, minFeelsLikeF: 40, peakGustMph: 35, peakPrecipChance: 70,
    onsetHazards: [{ key: "storm", label: "Thunderstorms", onsetIso: null, hoursAfterReturn: 1 }], nightfall: { onsetIso: null, hoursAfterReturn: 2 }, summary: "" },
  overnight: { status: "ok", relevant: true, reasons: [], reasonCodes: ["longDay"], summary: "", complete: true, hoursToDark: 2, lowTempF: 26, minFeelsLikeF: 13,
    peakWindMph: 18, peakGustMph: 30, peakPrecipChance: 80, snow: true, severity: "high" },
};

test("the delay plan folds shut with what a delay brings on its line", () => {
  const html = renderToStaticMarkup(<ContingencyCard contingency={contingency} returnMinutes={18 * 60} clock={clock}
    formatTemp={(f) => `${f}°F`} formatWind={(m) => `${m} mph`} folded />);
  assert.equal(foldLine(html, "sky-timing-contingency-fold"), "If you’re delayed 3 h late: Thunderstorms from 19:00 · Dark by 20:00 · Unplanned night: serious");
  assert.equal(foldOpen(html, "sky-timing-contingency-fold"), false);
  assert.match(html, /back by 21:00/, "the card itself is unchanged inside");
});

test("the score breakdown folds shut with the score and its largest deductions", () => {
  const html = renderToStaticMarkup(<ScoreExplanation folded safety={{ score: 46.3, tier: "High",
    groupImpacts: { airQuality: { effective: 46 }, weather: { effective: 7.7 }, terrain: { effective: 2 } } }} />);
  assert.equal(foldLine(html, "sky-sources-score"), "What drives this score Score 46.3 · Air quality −46 · Weather &amp; exposure −7.7");
  assert.equal(foldOpen(html, "sky-sources-score"), false);
  assert.doesNotMatch(html, /Understanding the assessment/, "the fold names it once");
  const insufficient = renderToStaticMarkup(<ScoreExplanation folded safety={{ score: 50, assessmentStatus: "insufficient_evidence" }} />);
  assert.match(foldLine(insufficient, "sky-sources-score"), /Insufficient evidence$/);
});

test("extra source evidence folds shut naming its sources, with each source shut too", () => {
  const html = renderToStaticMarkup(<SupplementalEvidence folded evidence={{
    synoptic: { source: "Synoptic Weather", kind: "observation", available: false, status: "not_configured" },
    nbm: { source: "NOAA NBM", kind: "probabilistic_forecast", available: true, status: "ok", points: [{ validTime: "2026-09-17T12:00:00Z", windMph: { p10: 0, p50: 5, p90: 12 } }] },
    discussion: { source: "NWS discussion", kind: "regional_context", available: true, status: "ok", office: "SGX", text: "Regional discussion." },
  }} />);
  assert.equal(foldLine(html, "sky-sources-evidence"), "Additional source evidence 2 sources: NOAA NBM, NWS discussion");
  assert.equal((html.match(/<details class="supplemental-source"><summary class="supplemental-evidence-heading"><h3>/g) || []).length, 2);
  assert.doesNotMatch(html, /<details class="supplemental-source" open/);
  assert.match(html, /Not available for this report/);
});

function workspace(overrides = {}, dataOverrides = {}) {
  const preferences = getDefaultUserPreferences();
  const trend = Array.from({ length: 4 }, (_, i) => ({
    time: `${String(7 + i).padStart(2, "0")}:00`, temp: 50 + i, wind: 5, gust: 12, precipChance: 10, humidity: 50, cloudCover: 20, condition: "Clear",
  }));
  const safetyData = {
    safety: { score: 74, tier: "Low risk", evidenceQuality: "Good" },
    weather: { elevation: 9000, trend },
    alerts: { status: "none", activeCount: 0, alerts: [] },
    airQuality: { usAqi: 32, category: "Good" },
    rainfall: { expected: { rainWindowIn: 0.07, snowWindowIn: 0.8 } },
    solar: { sunrise: "06:52", sunset: "19:30" },
    heatRisk: { level: 0, label: "Low" },
    fireRisk: { level: 1, label: "Low" },
    ...dataOverrides,
  };
  return {
    preferences, safetyData,
    interpretation: interpret(safetyData, { travel_window_hours: "4" }),
    evaluation: { fieldSignals: [] },
    travelWindowHours: 4,
    objectiveTerms: SUMMIT_TERMS,
    planApproach: null,
    formatWindDisplay: (v) => `${v} mph`, formatTempDisplay: (v) => `${v}°F`, formatElevationDisplay: (v) => `${v} ft`,
    formatClockForStyle: (v) => v || "—", formatPubTime: (v) => v, formatAgeFromNow: () => "just now", localizeUnitText: (t) => t,
    nwsAlertCount: 0, nwsTotalAlertCount: 0, nwsAlerts: [], nwsTopAlerts: [],
    weatherSourceDisplay: "NOAA", objectiveTimezone: "America/Denver", rawReportPayload: "{}", copiedRawPayload: false, handleCopyRawPayload() {},
    reportSnapshot: null, activeSavedReportId: null, accountUserId: null, dayOverDay: null,
    decision: { level: "CAUTION", checks: [] },
    ...overrides,
  };
}

test("the Weather chapter's reference folds shut, each line carrying the numbers its cards show", () => {
  const html = renderToStaticMarkup(<Conditions workspace={workspace()} hours={[]} />);
  assert.match(foldLine(html, "sky-precip-title"), /^Rain and snow 0\.07 in rain · 0\.8 in snow expected in your 4-hour window$/);
  assert.equal(foldLine(html, "sky-exposure-title"), "Heat, fire, air and visibility Heat low · Fire low · AQI 32 good · Visibility minimal");
  assert.match(foldLine(html, "sky-field-title"), /^Field reports and access /);
  for (const id of ["sky-precip-title", "sky-exposure-title", "sky-field-title"]) assert.equal(foldOpen(html, id), false, id);
  // The six cards are still there, quieter than a chapter's main picture.
  assert.match(html, /sky-card is-secondary sky-exposure condition-card is-heat/);
  assert.doesNotMatch(html, /Beyond the weather/);
});

test("the checklist shows what needs review and keeps the passing checks behind one line", () => {
  const checks = [
    { key: "wind", label: "Wind gusts are at or below 25 mph", ok: false, detail: "Peak 31 mph.", action: "Use sheltered terrain." },
    ...Array.from({ length: 10 }, (_, i) => ({ key: `ok-${i}`, label: `Passing check ${i}`, ok: true, detail: "Fine." })),
  ];
  const html = renderToStaticMarkup(<Sources workspace={workspace({ decision: { level: "CAUTION", checks } })} />);
  const passed = html.indexOf('<details class="sky-check-passed">');
  assert.ok(passed > html.indexOf("Wind gusts are at or below 25 mph"), "the check to review comes first, open");
  assert.match(html, /<details open="" class="is-over">[^]*Wind gusts are at or below 25 mph/);
  assert.match(html.slice(passed), /^<details class="sky-check-passed"><summary>[^]*10 passed[^]*Passing check 0[^]*Passing check 9/);
  assert.doesNotMatch(html, /<p class="sky-lead"/, "the lead sits in the chapter heading");
  assert.equal(foldOpen(html, "sky-sources-fresh"), false);
  assert.match(html, /sky-card is-secondary" aria-labelledby="sky-sources-alerts"/, "the alerts anchor stays where the brief points");
  // Every check passing: the list is just the one line.
  const clear = renderToStaticMarkup(<Sources workspace={workspace({ decision: { level: "GO", checks: checks.slice(1) } })} />);
  assert.match(clear, /10 passed[^]*All pass/);
});

test("a chapter's lead is the checks' counts, or the AI's analysis, marked, when it wrote one", () => {
  const checks = [{ key: "a", label: "A", ok: false }, { key: "b", label: "B", ok: true }];
  const lead = renderToStaticMarkup(<SourcesLead workspace={workspace({ decision: { level: "CAUTION", checks } })} />);
  assert.match(lead, /<strong>1 of 2 checks<\/strong> pass · <strong class="is-over">1 need review<\/strong>/);
  const narrative = "BIG PICTURE: Wind builds.";
  const details = { narrative, validation: "evidence_checked", chapters: { terrain: { text: "Firm snow above the col.", evidence: [] } } };
  assert.equal(aiChapterText(narrative, details, "terrain"), "Firm snow above the col.");
  assert.equal(aiChapterText(narrative, details, "forecast"), null, "no analysis, no AI lead");
  assert.equal(aiChapterText(narrative, { ...details, validation: "deterministic_fallback" }, "terrain"), null);
  assert.equal(aiChapterText(narrative, details, "gear"), null);
  const ai = renderToStaticMarkup(<AiLead text="Firm snow above the col." onReadAll={() => {}} />);
  assert.match(ai, /^<p class="sky-lead is-ai"><span class="sky-ai-mark">[^]*AI<\/span> Firm snow above the col\. <button type="button" class="sky-lead-link">Full AI read<\/button><\/p>$/);
  assert.doesNotMatch(ai, /Based on|aside/, "no chips, no bordered aside");
  assert.match(renderToStaticMarkup(<GearLead decision={{ level: "NO-GO" }} actionLine="Change the window." />),
    /<strong class="is-over">Change the plan before packing<\/strong> Change the window\./);
});

test("the standard kit waits in a fold under what the forecast adds, and still packs and clears", async (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<GearActions hidden={false} lead={false} actionLine="Go." onSources={() => {}}
    decision={{ level: "GO", blockers: [], cautions: [], checks: [] }}
    recommendations={[
      { title: "Shell", detail: "Wind.", reason: "Gusts", category: "Clothing", tone: "caution" },
      { title: "Ten Essentials", detail: "Map.", category: "Essentials", tone: "go" },
      { title: "Water", detail: "2 L.", category: "Essentials", tone: "go" },
    ]} />));
  assert.equal(document.querySelector(".gear-decision"), null, "the decision is the chapter's lead, in its heading");
  const fold = document.querySelector(".gear-standard details");
  assert.equal(fold.open, false);
  assert.match(fold.querySelector("summary").textContent, /^Standard kit2 items · bring these on every trip like this one$/);
  assert.equal(document.querySelector(".gear-group.is-conditions").closest("details"), null, "what the forecast adds stays open");
  await act(async () => fold.querySelector("input").click());
  assert.equal(document.querySelector("progress").value, 1);
  assert.match(fold.querySelector("summary").textContent, /2 items, 1 packed/);
  await act(async () => document.querySelector(".gear-progress button").click());
  assert.equal(document.querySelectorAll("input:checked").length, 0);
});
