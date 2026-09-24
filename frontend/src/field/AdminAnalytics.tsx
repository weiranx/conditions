import { Download } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AIProvider, Administration } from "./model/useAdministration";
import { AdminNotice, AdminStats } from "./Administration";
import { Details } from "./Details";

/** Counts as horizontal bars, each with its share of the total. */
function ShareBars({ items, empty = "No requests in this period." }: {
  items: { label: string; count: number; share: number }[];
  empty?: string;
}) {
  const max = Math.max(0, ...items.map((item) => item.count));
  if (!max) return <p className="sky-empty admin-empty-line">{empty}</p>;
  return (
    <ul className="admin-bars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="admin-bar-label">{item.label}</span>
          <span className="admin-bar-track" aria-hidden="true">
            <i style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="admin-bar-value">
            <strong>{item.count.toLocaleString()}</strong>
            <small>{Math.round(item.share)}%</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Requests by hour of day as a small column chart. */
function HourColumns({ hours, empty }: {
  hours: { hour: number; label: string; requests: number }[];
  empty: string;
}) {
  const max = Math.max(0, ...hours.map((h) => h.requests));
  const total = hours.reduce((sum, h) => sum + h.requests, 0);
  const peak = hours.reduce((best, h) => (h.requests > best.requests ? h : best), hours[0]);
  if (!max) return <p className="sky-empty admin-empty-line">{empty}</p>;
  return (
    <figure className="admin-hours">
      <figcaption className="sky-cap">
        Busiest hour <strong>{peak.label}</strong> · {peak.requests.toLocaleString()} of {total.toLocaleString()} requests
      </figcaption>
      <div className="admin-hours-cols" role="img" aria-label={`Requests by hour of day; busiest at ${peak.label}`}>
        {hours.map((h) => (
          <span key={h.hour} title={`${h.label}: ${h.requests}`} className={h === peak ? "is-peak" : undefined}>
            <i style={{ height: `${Math.max(h.requests ? 4 : 0, (h.requests / max) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="admin-hours-axis" aria-hidden="true">
        {hours.filter((h) => h.hour % 6 === 0).map((h) => <span key={h.hour}>{h.label}</span>)}
      </div>
    </figure>
  );
}

const CHART = { grid: "var(--sky-separator)", tick: { fontSize: 11, fill: "var(--sky-secondary)" } };

/** Tooltip heading: the hovered bucket's time span rather than its axis label. */
const bucketPeriod = (
  label: unknown,
  payload: ReadonlyArray<{ payload?: { period?: string } }>,
) => payload?.[0]?.payload?.period ?? String(label ?? "");

/**
 * Charts key their category axis by bucket start time: categories must be
 * unique, or hovering a bucket whose label repeats (including the blank ones)
 * shows the first bucket with that label.
 */
const bucketTick =
  (buckets: ReadonlyArray<{ timestamp: number; label: string }>) =>
  (timestamp: number) =>
    buckets.find((bucket) => bucket.timestamp === timestamp)?.label ?? "";

const RECENT_AI_REQUESTS = 10;

export function AdminAnalytics({ a }: { a: Administration }) {
  const { requestActivityRef, aiUsageRef } = a;
  const period = a.selectedRange.label.toLowerCase();
  // 12-hour buckets label only the midnight ones, so every tick must render.
  const tickInterval = a.analyticsRange === "7d" ? 0 : "preserveStartEnd";
  const requestsEmpty = a.loading
    ? "Loading report requests…"
    : a.error
      ? "Report requests are unavailable."
      : `No report requests in the ${period}.`;
  const aiEmpty = a.loading
    ? "Loading AI usage…"
    : a.aiUsageError
      ? "AI usage is unavailable."
      : `No AI requests in the ${period}.`;
  const hasRequests = !a.loading && !a.error && a.metrics.total > 0;
  const hasAIUsage = !a.loading && !a.aiUsageError && a.aiMetrics.calls > 0;
  const requestFilters = !!a.query || a.statusFilter !== "all";
  const providerName = (provider: string) =>
    (a.AI_PROVIDERS as readonly string[]).includes(provider)
      ? a.aiProviderLabel(provider as AIProvider)
      : provider;
  const cost = (value: number, pricedCalls: number) =>
    pricedCalls ? a.formatEstimatedCost(value) : "—";
  return (
    <>
      <AdminStats a={a} />
      <section className="field-panel">
        <h2>Report reliability</h2>
        <p>Completed, partial, and failed requests over {period}.</p>
        {hasRequests ? (
          <div className="field-admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.trendData}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="timestamp" tickFormatter={bucketTick(a.trendData)} tick={CHART.tick} tickLine={false} axisLine={false} interval={tickInterval} minTickGap={28} />
                <YAxis allowDecimals={false} width={35} tick={CHART.tick} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--sky-fill)" }} labelFormatter={bucketPeriod} />
                <Legend iconType="circle" iconSize={8} />
                <Bar
                  dataKey="healthy"
                  name="Complete"
                  stackId="reports"
                  fill="var(--sky-accent)"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="partial"
                  name="Partial"
                  stackId="reports"
                  fill="color-mix(in srgb, var(--sky-caution) 45%, var(--sky-surface))"
                />
                <Bar
                  dataKey="errors"
                  name="Errors"
                  stackId="reports"
                  fill="var(--sky-caution)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="sky-empty admin-chart-empty">{requestsEmpty}</p>
        )}
        <Details
          title="Request measurements and period comparison"
          value={a.metrics}
        />
      </section>
      <div className="admin-analytics-grid">
        <section className="field-panel">
          <h2>Popular objectives</h2>
          <ShareBars
            items={a.topLocations.map((l) => ({ label: l.name, count: l.count, share: l.share }))}
            empty={requestsEmpty}
          />
        </section>
        <section className="field-panel">
          <h2>Time of day</h2>
          <HourColumns hours={a.hourlyDistribution} empty={requestsEmpty} />
        </section>
        <section className="field-panel">
          <h2>How far ahead people plan</h2>
          <ShareBars items={a.planningInsights.leadTime.items} empty="No completed reports with a planned date." />
        </section>
        <section className="field-panel">
          <h2>Planned start times</h2>
          <ShareBars items={a.planningInsights.startTimes.items} empty="No completed reports with a start time." />
        </section>
        <section className="field-panel admin-span">
          <h2>Reliability by objective</h2>
          {!hasRequests ? (
            <p className="sky-empty admin-empty-line">{requestsEmpty}</p>
          ) : a.reliabilityHotspots.length ? (
            <ul className="admin-hotspots">
              {a.reliabilityHotspots.map((spot) => (
                <li key={spot.name}>
                  <span>
                    <strong>{spot.name}</strong>
                    <small>
                      {spot.issues} of {spot.total} requests partial or failed
                      {spot.p95Duration !== null ? ` · P95 ${a.formatDuration(spot.p95Duration)}` : ""}
                    </small>
                  </span>
                  <b>{Math.round(spot.issueRate)}%</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-all-clear">Every objective returned complete data in this period.</p>
          )}
        </section>
      </div>
      <section className="field-panel" ref={requestActivityRef}>
        <div className="field-section-heading">
          <h2>Report requests</h2>
          <button
            className="field-button"
            disabled={!a.filteredAndSorted.length}
            onClick={() => a.downloadReportCsv(a.filteredAndSorted)}
          >
            <Download size={16} aria-hidden="true" />
            Export requests
          </button>
        </div>
        <div className="field-action-row admin-filters">
          <label className="field-form-label">
            Search requests
            <input
              type="search"
              placeholder="Objective, date, status, or network"
              value={a.query}
              onChange={(e) => a.setQuery(e.target.value)}
            />
          </label>
          <label className="field-form-label">
            Response filter
            <select
              value={a.statusFilter}
              onChange={(e) =>
                a.setStatusFilter(e.target.value as typeof a.statusFilter)
              }
            >
              {a.STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-table-wrap">
          <table className="field-table sky-table admin-table admin-requests">
            <thead>
              <tr>
                {(
                  [
                    { key: "timestamp", label: "Requested" },
                    { key: "name", label: "Objective" },
                    { key: "statusCode", label: "Response" },
                    { key: "safetyScore", label: "Score" },
                    { key: "durationMs", label: "Duration" },
                  ] as const
                ).map((c) => (
                  <th
                    key={c.key}
                    aria-sort={
                      a.sortKey === c.key
                        ? a.sortAsc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      className="field-text-button"
                      onClick={() => a.handleSort(c.key)}
                    >
                      {c.label}
                      {a.sortKey === c.key ? (a.sortAsc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {a.visibleLogs.map((entry, i) => (
                <tr key={`${entry.timestamp}-${i}`}>
                  <td>{new Date(entry.timestamp).toLocaleString()}</td>
                  <td>
                    {entry.lat !== null && entry.lon !== null ? (
                      <a
                        href={`/planner?${new URLSearchParams({ lat: String(entry.lat), lon: String(entry.lon), ...(entry.name ? { name: entry.name } : {}), ...(entry.date ? { date: entry.date } : {}), ...(entry.startTime ? { start: entry.startTime } : {}) })}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {entry.name || `${entry.lat}, ${entry.lon}`}
                      </a>
                    ) : (
                      entry.name || "Unknown"
                    )}
                  </td>
                  <td>
                    <span className={`admin-code${entry.statusCode >= 400 || entry.partialData ? " is-issue" : ""}`}>
                      {entry.statusCode}
                      {entry.partialData ? " · Partial" : ""}
                    </span>
                  </td>
                  <td>{entry.safetyScore ?? "—"}</td>
                  <td>{a.formatDuration(entry.durationMs)}</td>
                  <td>
                    <Details title="Request details" value={entry} />
                  </td>
                </tr>
              ))}
              {!a.visibleLogs.length && (
                <tr>
                  <td colSpan={6} className="admin-table-empty">
                    {hasRequests && requestFilters
                      ? "No requests match these filters."
                      : requestsEmpty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-result-summary admin-table-foot" role="status">
          <span>
            {a.visibleLogs.length} of {a.filteredAndSorted.length} matching
            requests
          </span>
          {requestFilters && (
            <button
              className="field-text-button"
              onClick={() => {
                a.setQuery("");
                a.setStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {a.visibleLogs.length < a.filteredAndSorted.length && (
          <button
            className="field-button"
            onClick={() => a.setVisibleLogCount((n) => n + a.LOG_PAGE_SIZE)}
          >
            Load more requests
          </button>
        )}
      </section>
      <section className="field-panel" ref={aiUsageRef}>
        <div className="field-section-heading">
          <h2>AI usage</h2>
          <button
            className="field-button"
            disabled={!a.rangeAIUsage.length}
            onClick={() => a.downloadAIUsageCsv(a.rangeAIUsage)}
          >
            <Download size={16} aria-hidden="true" />
            Export AI usage
          </button>
        </div>
        <AdminNotice message={a.aiUsageError} />
        {hasAIUsage ? (
          <div className="field-admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={a.aiTrendData}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="timestamp" tickFormatter={bucketTick(a.aiTrendData)} interval={tickInterval} minTickGap={28} tick={CHART.tick} tickLine={false} axisLine={false} />
                <YAxis width={55} tick={CHART.tick} tickLine={false} axisLine={false} tickFormatter={(value: number) => a.formatTokenCount(value)} />
                <Tooltip labelFormatter={bucketPeriod} formatter={(value) => (typeof value === "number" ? value.toLocaleString() : value)} />
                <Legend iconType="circle" iconSize={8} />
                <Area
                  type="monotone"
                  dataKey="inputTokens"
                  name="Input tokens"
                  stackId="tokens"
                  stroke="var(--sky-accent)"
                  fill="color-mix(in srgb, var(--sky-accent) 28%, transparent)"
                />
                <Area
                  type="monotone"
                  dataKey="outputTokens"
                  name="Output tokens"
                  stackId="tokens"
                  stroke="var(--sky-secondary)"
                  fill="color-mix(in srgb, var(--sky-secondary) 22%, transparent)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="sky-empty admin-chart-empty">{aiEmpty}</p>
        )}
        <dl className="admin-mini-stats">
          {(
            [
              ["Calls", a.aiMetrics.calls.toLocaleString()],
              ["Input tokens", a.aiMetrics.inputTokens.toLocaleString()],
              ["Output tokens", a.aiMetrics.outputTokens.toLocaleString()],
              ["Success rate", a.aiMetrics.successRate === null ? "—" : `${Math.round(a.aiMetrics.successRate)}%`],
              ["Failures", a.aiMetrics.failures.toLocaleString()],
              [
                "Estimated cost",
                a.aiMetrics.calls > 0 && a.aiMetrics.pricedCalls === 0
                  ? "—"
                  : a.formatEstimatedCost(a.aiMetrics.estimatedCostUsd),
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{a.loading || a.aiUsageError ? "—" : value}</dd>
            </div>
          ))}
        </dl>
        {hasAIUsage && (
          <>
            <h3 className="admin-subheading">By model</h3>
            <div className="field-table-wrap">
              <table className="field-table sky-table admin-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="is-num">Calls</th>
                    <th className="is-num">Tokens</th>
                    <th className="is-num">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {a.aiModels.map((m) => (
                    <tr key={`${m.provider}:${m.model}`}>
                      <td>
                        <strong>{m.model}</strong>
                        <small>{providerName(m.provider)}</small>
                      </td>
                      <td className="is-num">{m.calls.toLocaleString()}</td>
                      <td className="is-num">{a.formatTokenCount(m.tokens)}</td>
                      <td className="is-num">{cost(m.estimatedCostUsd, m.pricedCalls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="admin-subheading">By feature</h3>
            <div className="field-table-wrap">
              <table className="field-table sky-table admin-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th className="is-num">Calls</th>
                    <th className="is-num">Failed</th>
                    <th className="is-num">Tokens</th>
                    <th className="is-num">Avg time</th>
                    <th className="is-num">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {a.aiFeatures.map((f) => (
                    <tr key={f.feature}>
                      <td>{a.aiUsageFeatureLabel(f.feature)}</td>
                      <td className="is-num">{f.calls.toLocaleString()}</td>
                      <td className={`is-num${f.errors ? " is-over" : ""}`}>{f.errors.toLocaleString()}</td>
                      <td className="is-num">{a.formatTokenCount(f.tokens)}</td>
                      <td className="is-num">{a.formatDuration(f.averageDurationMs)}</td>
                      <td className="is-num">{cost(f.estimatedCostUsd, f.pricedCalls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="admin-subheading">Recent requests</h3>
            <div className="field-table-wrap">
              <table className="field-table sky-table admin-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Feature</th>
                    <th>Model</th>
                    <th className="is-num">Tokens</th>
                    <th className="is-num">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recentAIRequests.slice(0, RECENT_AI_REQUESTS).map((entry, i) => (
                    <tr key={`${entry.timestamp}-${i}`}>
                      <td>
                        {new Date(entry.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {entry.status === "error" && <b className="admin-code is-issue"> · Failed</b>}
                      </td>
                      <td>{a.aiUsageFeatureLabel(entry.feature)}</td>
                      <td>
                        {entry.model}
                        <small>{providerName(entry.provider)}</small>
                      </td>
                      <td className="is-num">{a.formatTokenCount(entry.totalTokens)}</td>
                      <td className="is-num">{a.formatDuration(entry.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {a.recentAIRequests.length > RECENT_AI_REQUESTS && (
              <p className="sky-cap admin-table-foot">
                Latest {RECENT_AI_REQUESTS} of {a.recentAIRequests.length.toLocaleString()} requests. Export AI usage for the full list.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
