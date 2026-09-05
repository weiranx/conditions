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
import type { Administration } from "./model/useAdministration";
import { AdminNotice, AdminStats } from "./Administration";
import { DetailValues, Details } from "./Details";
export function AdminAnalytics({ a }: { a: Administration }) {
  const { requestActivityRef, aiUsageRef } = a;
  return (
    <>
      <AdminStats a={a} />
      <section className="field-panel">
        <h2>Report reliability</h2>
        <p>
          Completed, partial, and failed requests over{" "}
          {a.selectedRange.label.toLowerCase()}.
        </p>
        <div className="field-admin-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.trendData}>
              <CartesianGrid vertical={false} stroke="var(--f-line)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={28} />
              <YAxis allowDecimals={false} width={35} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="healthy"
                name="Complete"
                stackId="reports"
                fill="#3980d9"
              />
              <Bar
                dataKey="partial"
                name="Partial"
                stackId="reports"
                fill="#dfaa49"
              />
              <Bar
                dataKey="errors"
                name="Errors"
                stackId="reports"
                fill="#d76b6b"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Details
          title="Request measurements and period comparison"
          value={a.metrics}
        />
      </section>
      <div className="field-detail-grid">
        <section className="field-panel">
          <h2>Planning patterns</h2>
          <DetailValues value={a.planningInsights} />
        </section>
        <section className="field-panel">
          <h2>Popular objectives</h2>
          <DetailValues value={a.topLocations} />
        </section>
        <section className="field-panel">
          <h2>Reliability by objective</h2>
          <DetailValues value={a.reliabilityHotspots} />
        </section>
        <section className="field-panel">
          <h2>Time of day</h2>
          <DetailValues value={a.hourlyDistribution} />
        </section>
      </div>
      <section className="field-panel" ref={requestActivityRef}>
        <h2>Report requests</h2>
        <div className="field-action-row">
          <label className="field-form-label">
            Search requests
            <input
              type="search"
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
          <button
            className="field-button"
            onClick={() => a.downloadReportCsv(a.filteredAndSorted)}
          >
            Export filtered requests
          </button>
        </div>
        <div className="field-table-wrap">
          <table className="field-table">
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
                    {entry.statusCode}
                    {entry.partialData ? " · Partial" : ""}
                  </td>
                  <td>{entry.safetyScore ?? "—"}</td>
                  <td>{a.formatDuration(entry.durationMs)}</td>
                  <td>
                    <Details title="Request details" value={entry} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {a.visibleLogs.length} of {a.filteredAndSorted.length} matching
          requests
        </p>
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
            onClick={() => a.downloadAIUsageCsv(a.rangeAIUsage)}
          >
            Export AI usage
          </button>
        </div>
        <AdminNotice message={a.aiUsageError} />
        <div className="field-admin-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={a.aiTrendData}>
              <CartesianGrid vertical={false} stroke="var(--f-line)" />
              <XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 11 }} />
              <YAxis width={55} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="inputTokens"
                name="Input tokens"
                stackId="tokens"
                stroke="#3980d9"
                fill="#3980d950"
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                name="Output tokens"
                stackId="tokens"
                stroke="#43a89d"
                fill="#43a89d50"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <DetailValues value={a.aiMetrics} />
        <Details title="Models and estimated costs" value={a.aiModels} />
        <Details title="Usage by feature" value={a.aiFeatures} />
        <Details title="Individual AI requests" value={a.rangeAIUsage} />
      </section>
    </>
  );
}
