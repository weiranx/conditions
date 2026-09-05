import { paginateReportHistory } from "./saved-report-history.mjs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { makeReport, peaks, scenarios } from "./mock-data.mjs";

const now = () => new Date().toISOString();
const featureKeys = [
  "tripPlanning",
  "routeAnalysis",
  "satelliteImagery",
  "startTimeComparisons",
  "terrainWindow",
  "objectiveWatch",
  "gpxImport",
  "reportHistory",
  "reportSharing",
  "hourlyWeatherCharts",
  "elevationForecast",
  "heatRiskDetails",
  "fireRiskDetails",
  "snowpackDetails",
  "fieldObservations",
  "airQualityDetails",
  "gearRecommendations",
  "windLoadingDetails",
  "daylightTimeline",
  "scoreBreakdown",
  "weatherContextDetails",
  "avalancheDetails",
];
const policy = {
  tierKey: "premium",
  activeWatchLimit: 100,
  automaticChecks: true,
  emailAlerts: true,
  historyDays: 90,
  manualRefreshCooldownMinutes: 1,
  schedulerEnabled: false,
  checkIntervalMinutes: 180,
};
const tier = {
  key: "premium",
  label: "Premium",
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};
function seed() {
  return {
    version: 1,
    scenario: "mixed",
    signedIn: true,
    user: {
      id: "mock-admin",
      email: "admin@example.test",
      displayName: "Demo Admin",
      createdAt: now(),
      emailVerified: true,
      preferences: {},
    },
    reports: [],
    watches: [],
    outbox: [],
    logs: [],
    audit: [],
    flags: Object.fromEntries(featureKeys.map((key) => [key, true])),
  };
}
export function createMockApi({ databasePath } = {}) {
  let db =
    databasePath && existsSync(databasePath)
      ? JSON.parse(readFileSync(databasePath, "utf8"))
      : seed();
  if (db.version !== 1)
    throw new Error(
      "Unsupported mock database version. Reset the local mock database.",
    );
  function persist() {
    if (!databasePath) return;
    mkdirSync(dirname(databasePath), { recursive: true });
    writeFileSync(`${databasePath}.tmp`, JSON.stringify(db, null, 2));
    renameSync(`${databasePath}.tmp`, databasePath);
  }
  persist();
  const usage = (kind) => ({
    tierKey: "premium",
    unlimited: true,
    [`used${kind}`]:
      kind === "Reports"
        ? db.reports.length
        : kind === "Runs"
          ? db.usedRuns || 0
          : 0,
    [`limit${kind}`]: null,
    [`remaining${kind}`]: null,
    percentUsed: null,
    exhausted: false,
    periodStart: now(),
    periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    resetAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  const session = () => ({
    available: true,
    authenticated: db.signedIn,
    user: db.signedIn ? db.user : null,
    accountTier: db.signedIn ? tier : null,
    reportCount: db.reports.length,
    reportUsage: usage("Reports"),
    multiDayUsage: usage("Runs"),
    aiUsage: { ...usage("Tokens"), usedRequests: 0 },
  });
  const health = () => ({
    ok: true,
    service: "backcountry-conditions-mock",
    version: "local",
    env: "development",
    uptime: 120,
    nodeVersion: process.version,
    memory: { heapUsedMb: 32, rssMb: 64 },
    database: { configured: true, connected: true, latencyMs: 0 },
    caches: [],
    timestamp: now(),
    ai: {
      available: db.aiSettings?.enabled !== false,
      configured: true,
      provider: "mock",
      primaryModel: "fixture",
      fastModel: "fixture",
      features: Object.fromEntries(
        ["aiBrief", "reportChat", "routeAnalysis", "snowVision"].map((k) => [
          k,
          {
            available:
              db.aiSettings?.enabled !== false &&
              db.aiSettings?.features?.[k] !== false,
          },
        ]),
      ),
    },
  });
  const reportSummary = (item) => {
    const { snapshot, ...summary } = item;
    return {
      ...summary,
      objectiveName: snapshot.plan.objectiveName,
      forecastDate: snapshot.plan.forecastDate,
      alpineStartTime: snapshot.plan.alpineStartTime,
      score: snapshot.safetyData.safety.score,
      hasAi: Boolean(snapshot.ai.aiBriefNarrative),
    };
  };
  async function handle(path, method = "GET", body = {}) {
    const url = new URL(path, "http://localhost");
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    const scenario = scenarios.includes(q.mock_scenario)
      ? q.mock_scenario
      : db.scenario;
    const ok = (payload) => ({ status: 200, payload });
    const fail = (status, error) => ({ status, payload: { error } });
    if (p === "/api/dev/mock") {
      if (method === "POST") {
        if (body.reset) db = seed();
        else if (scenarios.includes(body.scenario)) db.scenario = body.scenario;
        else return fail(400, "Unknown mock scenario.");
        persist();
      }
      return ok({
        scenario: scenario,
        scenarios,
        user: "Premium / Admin",
        outbox: db.outbox,
      });
    }
    if (["/api/healthz", "/api/health"].includes(p)) return ok(health());
    if (p === "/api/feature-flags") return ok(db.flags);
    if (p === "/api/auth/google/config") return ok({ available: false });
    if (p === "/api/auth/session") return ok(session());
    if (p.startsWith("/api/auth/")) {
      if (method !== "POST") return fail(405, "Use POST.");
      db.signedIn = !p.endsWith("/logout");
      persist();
      return ok({
        ...session(),
        message: "Mock account action completed. No email sent.",
      });
    }
    if (p.startsWith("/api/account/") && !db.signedIn)
      return fail(401, "Sign in to the demo account.");
    if (p === "/api/account/preferences" && method === "PATCH") {
      db.user.preferences = {
        ...db.user.preferences,
        ...(body.preferences || body),
      };
      persist();
      return ok({ user: db.user, ...session() });
    }
    if (p === "/api/search")
      return ok(
        peaks.filter(
          (peak) =>
            !q.q ||
            peak.name
              .toLowerCase()
              .includes(q.q.toLowerCase().replace(/^mt\.? /, "mount ")),
        ),
      );
    if (p === "/api/reverse-geocode") return ok(peaks[0]);
    if (p === "/api/safety") {
      if (
        !q.lat ||
        !q.lon ||
        !Number.isFinite(Number(q.lat)) ||
        !Number.isFinite(Number(q.lon)) ||
        Math.abs(Number(q.lat)) > 90 ||
        Math.abs(Number(q.lon)) > 180
      )
        return fail(400, "Valid coordinates are required.");
      if (scenario === "error")
        return fail(
          500,
          "Simulated forecast failure. Choose a different mock scenario to recover.",
        );
      const report = makeReport(q, scenario);
      report.featureFlags = db.flags;
      db.logs.unshift({
        timestamp: now(),
        lat: report.location.lat,
        lon: report.location.lon,
        date: q.date,
        startTime: q.start,
        statusCode: 200,
        safetyScore: report.safety.score,
        partialData: report.partialData,
        durationMs: 35,
        name: q.name || "Demo objective",
        ip: null,
        userAgent: "Local mock",
      });
      db.logs = db.logs.slice(0, 100);
      persist();
      return ok(report);
    }
    if (p === "/api/trip-forecasts" && method === "POST") {
      if (scenario === "error") return fail(500, "Simulated forecast failure.");
      const days = Array.from(
        { length: Math.max(2, Math.min(7, Number(body.durationDays) || 3)) },
        (_, i) => {
          const d = new Date(`${body.startDate}T12:00:00Z`);
          d.setUTCDate(d.getUTCDate() + i);
          const report = makeReport(
            {
              ...body,
              date: d.toISOString().slice(0, 10),
              start: body.startTime,
            },
            scenario === "mixed"
              ? ["clear", "rain", "snow"][i % 3]
              : scenario,
          );
          return {
            ...report,
            // The production API reports provider period timestamps, not the request clock.
            forecast: {
              ...report.forecast,
              selectedStartTime: report.weather.forecastStartTime,
              selectedEndTime: report.weather.forecastEndTime,
            },
            featureFlags: db.flags,
          };
        },
      );
      db.usedRuns = (db.usedRuns || 0) + 1;
      persist();
      return ok({ days, multiDayUsage: usage("Runs") });
    }
    if (p === "/api/account/reports/comparison-baseline") {
      const item = db.reports.find(
        (r) =>
          r.id !== q.excludeReportId &&
          String(r.snapshot.plan.lat) === q.lat &&
          String(r.snapshot.plan.lon) === q.lon &&
          r.snapshot.plan.forecastDate === q.forecastDate &&
          r.snapshot.plan.alpineStartTime === q.alpineStartTime,
      );
      return ok({
        baseline: item
          ? {
              reportId: item.id,
              snapshot: item.snapshot,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }
          : null,
      });
    }
    if (p === "/api/account/reports/email") {
      db.outbox.push({
        type: "report",
        to: db.user.email,
        createdAt: now(),
        shareToken: body.shareToken,
      });
      persist();
      return ok({
        message: "Mock email added to the local outbox. Nothing was sent.",
      });
    }
    if (p === "/api/account/reports") {
      if (method === "GET")
        return ok(paginateReportHistory(db.reports.map(reportSummary).map((summary, index) => ({
          ...summary, generatedAt: db.reports[index].snapshot.safetyData.generatedAt || null,
        })), url.searchParams));
      if (method === "POST") {
        if (!body.report?.plan || !body.report?.safetyData?.safety)
          return fail(400, "A report snapshot is required.");
        const item = {
          id: randomUUID(),
          shareToken: `demo-${randomUUID()}`,
          title: body.report.plan.objectiveName,
          snapshot: body.report,
          createdAt: now(),
          updatedAt: now(),
        };
        db.reports.unshift(item);
        persist();
        return ok({
          report: item,
          reportCount: db.reports.length,
          reportUsage: usage("Reports"),
        });
      }
    }
    if (
      p.startsWith("/api/account/reports/") ||
      p.startsWith("/api/reports/shared/")
    ) {
      const id = p.split("/").at(-1);
      const item = db.reports.find((r) => r.id === id || r.shareToken === id);
      if (!item) return fail(404, "Mock report not found.");
      if (method === "PUT") {
        if (!body.report?.plan) return fail(400, "Report required.");
        item.snapshot = body.report;
        item.updatedAt = now();
        persist();
      }
      if (method === "DELETE") {
        db.reports = db.reports.filter((r) => r !== item);
        persist();
      }
      return ok({ report: item });
    }
    if (p === "/api/account/objective-watches") {
      if (method === "GET") {
        if (q.lat)
          return ok({
            watch:
              db.watches.find(
                (w) =>
                  String(w.plan.lat) === q.lat &&
                  String(w.plan.lon) === q.lon &&
                  w.plan.forecastDate === q.forecastDate,
              ) || null,
            policy,
          });
        return ok({ watches: db.watches.map((watch) => ({ ...watch, latestCheck: watch.checks?.[0] || null })), policy });
      }
      if (method === "POST") {
        if (!body.report?.plan) return fail(400, "Report required.");
        let watch = db.watches.find(
          (w) => JSON.stringify(w.plan) === JSON.stringify(body.report.plan),
        );
        if (!watch) {
          watch = {
            id: randomUUID(),
            title: body.report.plan.objectiveName,
            plan: body.report.plan,
            baselineReport: body.report,
            lastAttemptedAt: null,
            lastCheckedAt: null,
            nextCheckAt: null,
            lastChange: null,
            consecutiveFailures: 0,
            notificationsEnabled: true,
            createdAt: now(),
            updatedAt: now(),
            checks: [],
          };
          db.watches.unshift(watch);
        }
        persist();
        return ok({ watch, policy });
      }
    }
    if (p.startsWith("/api/account/objective-watches/")) {
      const [, id, action] = p
        .split("/objective-watches/")
        .flatMap((part, i) => (i ? part.split("/") : [part]));
      const watch = db.watches.find((w) => w.id === id);
      if (!watch) return fail(404, "Mock watch not found.");
      if (action === "events") return ok({ events: [], policy });
      if (action === "checks") return ok({ checks: watch.checks, policy });
      if (action === "refresh") {
        watch.lastCheckedAt = now();
        watch.lastAttemptedAt = watch.lastCheckedAt;
        watch.checks.unshift({
          id: randomUUID(),
          checkType: "manual",
          status: "unchanged",
          summary: { score: watch.baselineReport.safetyData.safety.score },
          change: null,
          error: null,
          checkedAt: now(),
        });
      }
      if (method === "PATCH")
        watch.notificationsEnabled = Boolean(body.notificationsEnabled);
      if (method === "DELETE")
        db.watches = db.watches.filter((w) => w.id !== id);
      persist();
      return ok({ watch, policy });
    }
    if (p === "/api/ai-brief")
      return ok({
        narrative:
          "BIG PICTURE: This is a synthetic local briefing for testing the report layout. The selected fixture supplies the weather and field observations. WHY IT MATTERS: Large values and hourly charts show how this sample changes through the outing. These are demonstration values, not live observations. WATCH CLOSELY: Review the selected hour and any highlighted field signals in the sample report. DATA CONFIDENCE: All data in this briefing is mocked. No live forecast or AI provider was contacted. COMFORT CHECK: The comfort card is separate from the safety decision. BEST MOVE: Use the scenario selector to test clear skies, storms, snow, and missing data. Use a real report before making an outing decision.",
        cached: false,
      });
    if (p === "/api/snow-vision")
      return ok({
        analysis:
          "**Demo snow analysis.** Sample snow coverage is concentrated on upper slopes. This fixture does not inspect satellite imagery.",
        image: null,
        zoom: 12,
        generatedAt: now(),
      });
    if (p === "/api/report-chat")
      return {
        status: 200,
        stream: true,
        payload:
          "Demo response: compare the hourly gust and precipitation charts, then check the terrain and daylight panels. This is a canned local response, not live advice.",
      };
    if (p === "/api/route-suggestions")
      return ok([
        {
          name: "Demo summit trail",
          distance_rt_miles: 10.8,
          elev_gain_ft: 3200,
          class: "Class 1",
          description: "Synthetic route for testing.",
        },
      ]);
    if (p === "/api/route-analysis") {
      const report = makeReport(body, scenario);
      const waypoints = [
        {
          name: "Demo trailhead",
          lat: body.lat,
          lon: body.lon,
          elev_ft: 6500,
          progress_percent: 0,
        },
        {
          name: "Demo summit",
          lat: Number(body.lat) + 0.01,
          lon: Number(body.lon) + 0.01,
          elev_ft: 10000,
          progress_percent: 100,
        },
      ];
      return ok({
        waypoints,
        summaries: waypoints.map((w) => ({
          ...w,
          dataAvailable: true,
          score: report.safety.score,
          weather: report.weather,
          activeAlerts: 0,
        })),
        analysis:
          "Synthetic route assessment. Upper terrain is exposed to wind.",
        analysisSource: "deterministic",
        partialData: false,
        routeSource: "generated",
      });
    }
    if (p.startsWith("/api/admin/") && !db.signedIn)
      return fail(401, "Sign in to the mock admin account.");
    if (p === "/api/report-logs") return ok(db.logs);
    if (p === "/api/ai-usage") return ok([]);
    if (p === "/api/admin/audit-log") return ok(db.audit);
    if (p === "/api/admin/users")
      return ok({
        users: [
          {
            ...db.user,
            tier: "premium",
            status: "active",
            authProvider: "mock",
            authMethods: ["password"],
            updatedAt: now(),
            lastActivityAt: now(),
            activeSessions: 1,
            savedReports: db.reports.length,
            aiCalls: 0,
            aiTokens: 0,
            aiTokenLimitOverride: null,
            reportUsageLimitOverride: null,
            isOwner: true,
          },
        ],
        total: 1,
        limit: 500,
        summary: {
          active: 1,
          suspended: 0,
          free: 0,
          premium: 1,
          verified: 1,
          unverified: 0,
          activeSessions: 1,
        },
      });
    if (p === "/api/admin/feature-flags") {
      if (method === "PATCH") {
        db.flags = { ...db.flags, ...body.flags };
        persist();
      }
      return ok({ flags: db.flags, persistent: true });
    }
    if (p.startsWith("/api/admin/") && !db.signedIn)
      return fail(401, "Sign in to the mock admin account.");
    if (p === "/api/admin/usage-settings") {
      if (method === "PATCH") {
        db.usageSettings = { ...db.usageSettings, ...body };
        persist();
      }
      return ok({
        persistent: true,
        freeMonthlyAITokenLimit: 100000,
        environmentFreeMonthlyAITokenLimit: 100000,
        freeMonthlyReportUsageLimit: 20,
        environmentFreeMonthlyReportUsageLimit: 20,
        maxMonthlyAITokenLimit: 10000000,
        maxFreeMonthlyUsageLimit: 10000,
        ...db.usageSettings,
      });
    }
    if (p === "/api/admin/system-resources")
      return ok({
        memory: {
          totalBytes: 8589934592,
          usedBytes: 2147483648,
          freeBytes: 6442450944,
          availableBytes: 6442450944,
          usagePercent: 25,
        },
        disk: {
          totalBytes: 100000000000,
          usedBytes: 20000000000,
          freeBytes: 80000000000,
          availableBytes: 80000000000,
          usagePercent: 20,
        },
        timestamp: now(),
      });
    if (p === "/api/admin/health-monitor-history")
      return ok({
        entries: [
          {
            checkedAt: now(),
            healthy: true,
            summary: "Local mock healthy",
            statusCode: 200,
            durationMs: 3,
            action: "none",
            alertError: null,
          },
        ],
        summary: {
          total: 1,
          healthy: 1,
          unhealthy: 0,
          availabilityPercent: 100,
          lastCheckAt: now(),
          lastUnhealthyAt: null,
        },
      });
    if (p === "/api/admin/runtime-environment")
      return ok({
        persistent: true,
        restartRequired: false,
        entries: [
          {
            key: "MOCK_API",
            label: "Local mock API",
            category: "Development",
            description: "Synthetic responses and a local JSON database.",
            type: "boolean",
            options: null,
            min: null,
            max: null,
            secret: false,
            editable: false,
            configured: true,
            value: "true",
            source: "deployment environment",
            overridden: false,
            restartRequired: false,
          },
        ],
      });
    if (p === "/api/admin/maintenance/backend-restart")
      return ok({
        available: false,
        scheduled: false,
        scheduledAt: null,
        restartDelayMs: 0,
        reason: "The Vite mock has no backend process to restart.",
      });
    if (p === "/api/admin/objective-watch-scheduler")
      return ok({
        enabled: false,
        configured: true,
        running: false,
        health: "stopped",
        message:
          "Mock watches refresh manually; no background emails are sent.",
        lastHeartbeatAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastStatus: "idle",
        lastError: null,
        lastSummary: null,
        checkIntervalMinutes: 180,
        expectedIntervalMinutes: 180,
        staleAfterMinutes: 360,
        updatedAt: now(),
      });
    if (p === "/api/admin/diagnostics")
      return ok({
        startedAt: now(),
        completedAt: now(),
        durationMs: 0,
        summary: { total: 1, operational: 1, failed: 0, notConfigured: 0 },
        services: [
          {
            id: "mock",
            name: "Local mock API",
            category: "Development",
            status: "operational",
            httpStatus: 200,
            latencyMs: 0,
            message: "Fixture data; no external services called.",
          },
        ],
      });
    if (p === "/api/admin/ai-models" || p === "/api/admin/ai-models/refresh")
      return ok({
        fetchedAt: now(),
        providers: Object.fromEntries(
          ["openai", "anthropic", "kimi", "gemini"].map((provider) => [
            provider,
            {
              models: ["demo-fixture", "demo-reasoning", "demo-fast"],
              source: "configured",
              error: null,
            },
          ]),
        ),
      });
    if (p === "/api/admin/ai-settings") {
      db.aiSettings ??= {
        enabled: true,
        failoverEnabled: false,
        provider: "openai",
        features: {
          aiBrief: true,
          reportChat: true,
          routeAnalysis: true,
          snowVision: true,
        },
      };
      if (method === "PATCH") {
        db.aiSettings = {
          ...db.aiSettings,
          ...body,
          features: { ...db.aiSettings.features, ...body.features },
          models: Object.fromEntries(
            ["openai", "anthropic", "kimi", "gemini"].map((provider) => [
              provider,
              {
                primary:
                  body.models?.[provider]?.primary ??
                  db.aiSettings.models?.[provider]?.primary ??
                  "demo-fixture",
                fast:
                  body.models?.[provider]?.fast ??
                  db.aiSettings.models?.[provider]?.fast ??
                  "demo-fixture",
              },
            ]),
          ),
        };
        persist();
      }
      return ok({
        ...db.aiSettings,
        available: db.aiSettings.enabled,
        persistent: true,
        defaultProvider: "openai",
        primaryModel:
          db.aiSettings.models?.[db.aiSettings.provider]?.primary ||
          "demo-fixture",
        fastModel:
          db.aiSettings.models?.[db.aiSettings.provider]?.fast ||
          "demo-fixture",
        configured: true,
        fallbackProvider: "anthropic",
        fallbackConfigured: true,
        providers: Object.fromEntries(
          ["openai", "anthropic", "kimi", "gemini"].map((provider) => [
            provider,
            {
              primary:
                db.aiSettings.models?.[provider]?.primary || "demo-fixture",
              fast: db.aiSettings.models?.[provider]?.fast || "demo-fixture",
              options: ["demo-fixture", "demo-reasoning", "demo-fast"],
              configured: true,
            },
          ]),
        ),
        features: Object.fromEntries(
          Object.entries(db.aiSettings.features).map(([key, enabled]) => [
            key,
            { enabled, available: enabled && db.aiSettings.enabled },
          ]),
        ),
      });
    }
    // Unsupported operations fail explicitly; never forward to a real backend.
    return fail(
      501,
      `Local mock does not implement ${method} ${p}. No external request was made.`,
    );
  }
  return { handle };
}
export function mockApiPlugin({ databasePath }) {
  return {
    name: "conditions-local-mock",
    apply: "serve",
    configureServer(server) {
      const api = createMockApi({ databasePath });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 5_000_000) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: "Mock payload too large." }));
              return;
            }
          }
          const body = raw ? JSON.parse(raw) : {};
          const result = await api.handle(req.url, req.method || "GET", body);
          res.statusCode = result.status;
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("x-conditions-mock", "true");
          if (result.stream) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("x-vercel-ai-ui-message-stream", "v1");
            for (const event of [
              { type: "start", messageId: randomUUID() },
              { type: "text-start", id: "demo-text" },
              { type: "text-delta", id: "demo-text", delta: result.payload },
              { type: "text-end", id: "demo-text" },
              { type: "finish", finishReason: "stop" },
            ])
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            res.end("data: [DONE]\n\n");
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result.payload));
        } catch (error) {
          res.statusCode = error instanceof SyntaxError ? 400 : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Local mock request failed." }));
        }
      });
    },
  };
}
