import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockApi } from "./mock-api.mjs";
import { makeReport } from "./mock-data.mjs";
const snapshot = () => ({
  version: 3,
  savedAt: new Date().toISOString(),
  plan: {
    lat: 36.5786,
    lon: -118.2923,
    objectiveName: "Demo",
    forecastDate: "2026-09-05",
    alpineStartTime: "07:00",
    travelWindowHours: 10,
  },
  safetyData: makeReport(),
  ai: { aiBriefNarrative: null },
  route: {},
});
test("Premium session returns unlimited reports, AI and multi-day usage", async () => {
  const api = createMockApi();
  const { payload } = await api.handle("/api/auth/session");
  assert.equal(payload.accountTier.key, "premium");
  assert.equal(payload.user.email, "admin@example.test");
  for (const [usage, limit] of [
    [payload.reportUsage, "limitReports"],
    [payload.multiDayUsage, "limitRuns"],
    [payload.aiUsage, "limitTokens"],
  ]) {
    assert.equal(usage.unlimited, true);
    assert.equal(usage[limit], null);
    assert.equal(usage.exhausted, false);
  }
  const users = await api.handle("/api/admin/users");
  assert.equal(users.payload.users[0].isOwner, true);
  assert.equal(users.payload.summary.premium, 1);
});
test("saved reports, watches, preferences and mock outbox persist across server restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "conditions-mock-"));
  try {
    const databasePath = join(dir, "database.json");
    const api = createMockApi({ databasePath });
    const created = await api.handle("/api/account/reports", "POST", {
      report: snapshot(),
    });
    const id = created.payload.report.id;
    await api.handle("/api/account/preferences", "PATCH", {
      preferences: { temperatureUnit: "c" },
    });
    const saved = await api.handle("/api/account/objective-watches", "POST", {
      report: snapshot(),
    });
    const watchId = saved.payload.watch.id;
    await api.handle(
      `/api/account/objective-watches/${watchId}/refresh`,
      "POST",
    );
    await api.handle("/api/account/reports/email", "POST", {
      shareToken: created.payload.report.shareToken,
    });
    const restored = createMockApi({ databasePath });
    assert.equal(
      (await restored.handle(`/api/account/reports/${id}`)).payload.report
        .snapshot.plan.objectiveName,
      "Demo",
    );
    assert.equal(
      (await restored.handle("/api/auth/session")).payload.user.preferences
        .temperatureUnit,
      "c",
    );
    assert.equal(
      (
        await restored.handle(
          `/api/account/objective-watches/${watchId}/checks`,
        )
      ).payload.checks.length,
      1,
    );
    assert.equal(
      (await restored.handle("/api/dev/mock")).payload.outbox.length,
      1,
    );
    await restored.handle(
      `/api/account/objective-watches/${watchId}`,
      "DELETE",
    );
    assert.equal(
      (await restored.handle("/api/account/objective-watches")).payload.watches
        .length,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("scenario changes return missing data, actionable fields, errors, and recover", async () => {
  const api = createMockApi();
  const path =
    "/api/safety?lat=36.5&lon=-118.2&date=2026-09-05&start=22:00&travel_window_hours=10";
  await api.handle("/api/dev/mock", "POST", { scenario: "missing" });
  const missing = (await api.handle(path)).payload;
  assert.equal(missing.weather.trend[0].temp, null);
  assert.equal(missing.weather.trend[0].isDaytime, false);
  assert.equal(missing.weather.trend[2].timeIso.slice(0, 10), "2026-09-06");
  await api.handle("/api/dev/mock", "POST", { scenario: "field-alerts" });
  assert.equal(
    (await api.handle(path)).payload.localConditions.access.closedRoadCount,
    1,
  );
  await api.handle("/api/dev/mock", "POST", { scenario: "error" });
  assert.equal((await api.handle(path)).status, 500);
  await api.handle("/api/dev/mock", "POST", { scenario: "clear" });
  assert.equal((await api.handle(path)).status, 200);
  assert.equal((await api.handle("/api/not-a-real-endpoint")).status, 501);
});
test("admin feature flags persist and appear in report responses", async () => {
  const api = createMockApi();
  await api.handle("/api/admin/feature-flags", "PATCH", {
    flags: { heatRiskDetails: false },
  });
  assert.equal(
    (await api.handle("/api/feature-flags")).payload.heatRiskDetails,
    false,
  );
  assert.equal(
    (await api.handle("/api/safety?lat=36&lon=-118")).payload.featureFlags
      .heatRiskDetails,
    false,
  );
});
test("multi-day results preserve selected dates, coordinates and duration", async () => {
  const api = createMockApi();
  const { payload } = await api.handle("/api/trip-forecasts", "POST", {
    lat: 36,
    lon: -118,
    startDate: "2026-09-05",
    startTime: "05:00",
    durationDays: 3,
    travelWindowHours: 6,
  });
  assert.deepEqual(
    payload.days.map((day) => day.forecast.selectedDate),
    ["2026-09-05", "2026-09-06", "2026-09-07"],
  );
  assert.equal(payload.days[0].weather.trend.length, 6);
  assert.equal(payload.multiDayUsage.unlimited, true);
});

test("AI model and provider selections survive reads and unrelated updates", async () => {
  const api = createMockApi();
  await api.handle("/api/admin/ai-settings", "PATCH", {
    models: { openai: { primary: "demo-reasoning", fast: "demo-fast" } },
  });
  await api.handle("/api/admin/ai-settings", "PATCH", {
    provider: "gemini",
    models: { gemini: { primary: "custom-gemini", fast: "demo-fast" } },
  });
  await api.handle("/api/admin/ai-settings", "PATCH", {
    features: { snowVision: false },
  });
  const result = (await api.handle("/api/admin/ai-settings")).payload;
  assert.equal(result.provider, "gemini");
  assert.equal(result.primaryModel, "custom-gemini");
  assert.equal(result.providers.openai.primary, "demo-reasoning");
  assert.equal(result.providers.gemini.fast, "demo-fast");
  assert.equal(result.features.snowVision.available, false);
});

test("multi-day responses use production forecast-period timestamp fields", async () => {
  const api = createMockApi();
  const result = await api.handle("/api/trip-forecasts", "POST", {
    lat: 46.8523, lon: -121.7603, startDate: "2026-09-05", startTime: "07:30", durationDays: 2, travelWindowHours: 10,
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.days.length, 2);
  for (const day of result.payload.days) {
    assert.match(day.forecast.selectedStartTime, /^2026-09-0[56]T07:30:00-07:00$/);
    assert.equal(day.forecast.selectedStartTime, day.weather.forecastStartTime);
    assert.equal(day.forecast.selectedEndTime, day.weather.forecastEndTime);
  }
});
