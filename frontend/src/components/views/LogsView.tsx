import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileClock,
  KeyRound,
  LoaderCircle,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { fetchApi } from '../../lib/api-client';
import type { AppView } from '../../hooks/useUrlState';
import { ProductNav } from './ProductNav';

interface ReportLogEntry {
  timestamp: string;
  lat: number | null;
  lon: number | null;
  date: string | null;
  startTime: string | null;
  statusCode: number;
  safetyScore: number | null;
  partialData: boolean | null;
  durationMs: number;
  name: string | null;
  ip: string | null;
  userAgent: string | null;
}

const LOGS_SESSION_KEY = 'summitsafe:logs-key';

interface LogsViewProps {
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

export function LogsView({ navigateToView, openPlannerView, openTripToolView }: LogsViewProps) {
  const [secretKey, setSecretKey] = useState<string>(() => sessionStorage.getItem(LOGS_SESSION_KEY) ?? '');
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  const lockLogs = useCallback((wasRejected = false) => {
    sessionStorage.removeItem(LOGS_SESSION_KEY);
    setSecretKey('');
    setRejected(wasRejected);
  }, []);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    sessionStorage.setItem(LOGS_SESSION_KEY, trimmed);
    setSecretKey(trimmed);
    setRejected(false);
    setDraft('');
  }, [draft]);

  return (
    <>
      <ProductNav
        active="logs"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <main className="logs-page">
        <header className="logs-page-head">
          <div>
            <div className="logs-kicker"><FileClock size={14} aria-hidden /> Operations</div>
            <h1>Report logs</h1>
            <p>Monitor safety report traffic, response health, and processing time from the last seven days.</p>
          </div>
          {secretKey && (
            <button type="button" className="logs-btn logs-btn-quiet" onClick={() => lockLogs()}>
              <Lock size={15} aria-hidden /> Lock
            </button>
          )}
        </header>

        {secretKey ? (
          <ReportLogsDashboard secretKey={secretKey} onUnauthorized={() => lockLogs(true)} />
        ) : (
          <section className="logs-unlock-card" aria-labelledby="logs-unlock-title">
            <div className="logs-unlock-icon"><KeyRound size={22} aria-hidden /></div>
            <div className="logs-unlock-copy">
              <h2 id="logs-unlock-title">Restricted access</h2>
              <p>Enter the server’s logs key. It is stored only for this browser session.</p>
            </div>
            <form onSubmit={handleSubmit} className="logs-unlock-form">
              <label htmlFor="logs-key-input">Access key</label>
              <div className="logs-unlock-controls">
                <input
                  id="logs-key-input"
                  type="password"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Enter access key"
                  autoComplete="current-password"
                  aria-invalid={rejected}
                  aria-describedby={rejected ? 'logs-unlock-error' : undefined}
                  autoFocus
                />
                <button type="submit" className="logs-btn logs-btn-primary" disabled={!draft.trim()}>
                  Unlock
                </button>
              </div>
              {rejected && <p id="logs-unlock-error" className="logs-unlock-error">That key was not accepted. Try again.</p>}
            </form>
          </section>
        )}
      </main>
    </>
  );
}

type LogSortKey = 'timestamp' | 'name' | 'date' | 'statusCode' | 'safetyScore' | 'durationMs' | 'ip';
type StatusFilter = 'all' | 'healthy' | 'issues' | 'errors' | 'partial';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'issues', label: 'Needs attention' },
  { value: 'errors', label: 'Errors' },
  { value: 'partial', label: 'Partial data' },
];

function getLogSortValue(entry: ReportLogEntry, key: LogSortKey): string | number {
  switch (key) {
    case 'timestamp': return entry.timestamp;
    case 'name': return entry.name ?? '';
    case 'date': return entry.date ?? '';
    case 'statusCode': return entry.statusCode;
    case 'safetyScore': return entry.safetyScore ?? -1;
    case 'durationMs': return entry.durationMs;
    case 'ip': return entry.ip ?? '';
  }
}

function matchesStatus(entry: ReportLogEntry, filter: StatusFilter): boolean {
  if (filter === 'healthy') return entry.statusCode === 200 && entry.partialData !== true;
  if (filter === 'issues') return entry.statusCode !== 200 || entry.partialData === true;
  if (filter === 'errors') return entry.statusCode !== 200;
  if (filter === 'partial') return entry.partialData === true;
  return true;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '—';
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s` : `${durationMs}ms`;
}

function formatLogTime(timestamp: string): { primary: string; secondary: string } {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { primary: 'Unknown', secondary: timestamp };
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return {
    primary: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    secondary: sameDay ? 'Today' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }),
  };
}

function escapeCsv(value: string | number | boolean | null): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(entries: ReportLogEntry[]) {
  const keys: Array<keyof ReportLogEntry> = ['timestamp', 'name', 'lat', 'lon', 'date', 'startTime', 'statusCode', 'safetyScore', 'partialData', 'durationMs', 'ip', 'userAgent'];
  const csv = [keys.join(','), ...entries.map((entry) => keys.map((key) => escapeCsv(entry[key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `report-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SortButton({ sortKey, activeKey, ascending, onSort, children }: {
  sortKey: LogSortKey;
  activeKey: LogSortKey;
  ascending: boolean;
  onSort: (key: LogSortKey) => void;
  children: React.ReactNode;
}) {
  const active = sortKey === activeKey;
  return (
    <button type="button" className={active ? 'logs-sort is-active' : 'logs-sort'} onClick={() => onSort(sortKey)}>
      {children}<span aria-hidden>{active ? (ascending ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

function ReportLogsDashboard({ secretKey, onUnauthorized }: { secretKey: string; onUnauthorized: () => void }) {
  const [logs, setLogs] = useState<ReportLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<LogSortKey>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchLogs = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const { response, payload } = await fetchApi('/api/report-logs', {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (response.status === 401 || response.status === 403) {
        onUnauthorized();
        return;
      }
      if (response.ok && Array.isArray(payload)) {
        setLogs(payload as ReportLogEntry[]);
        setError(null);
        setLastRefreshed(new Date());
      } else {
        setError('The server could not load report logs.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [secretKey, onUnauthorized]);

  useEffect(() => {
    void fetchLogs();
    const interval = window.setInterval(() => void fetchLogs(true), 30_000);
    return () => window.clearInterval(interval);
  }, [fetchLogs]);

  const metrics = useMemo(() => {
    const completed = logs.filter((entry) => entry.statusCode === 200).length;
    const partial = logs.filter((entry) => entry.partialData === true).length;
    const durations = logs.map((entry) => entry.durationMs).filter(Number.isFinite);
    return {
      successRate: logs.length ? Math.round((completed / logs.length) * 100) : 0,
      partial,
      averageDuration: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      uniqueVisitors: new Set(logs.map((entry) => entry.ip).filter(Boolean)).size,
    };
  }, [logs]);

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = logs.filter((entry) => {
      if (!matchesStatus(entry, statusFilter)) return false;
      if (!normalizedQuery) return true;
      return [entry.name, entry.lat, entry.lon, entry.date, entry.startTime, entry.statusCode, entry.safetyScore, entry.durationMs, entry.ip, entry.userAgent]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    });
    return [...result].sort((a, b) => {
      const left = getLogSortValue(a, sortKey);
      const right = getLogSortValue(b, sortKey);
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return sortAsc ? comparison : -comparison;
    });
  }, [logs, query, statusFilter, sortKey, sortAsc]);

  const handleSort = (key: LogSortKey) => {
    if (key === sortKey) setSortAsc((current) => !current);
    else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'date' || key === 'ip');
    }
  };

  if (loading) {
    return <div className="logs-state-card"><LoaderCircle className="logs-spin" size={20} aria-hidden /><span>Loading report activity…</span></div>;
  }

  return (
    <div className="logs-dashboard">
      {error && (
        <div className="logs-alert" role="alert">
          <AlertTriangle size={17} aria-hidden />
          <span>{error}</span>
          <button type="button" onClick={() => void fetchLogs()}>Try again</button>
        </div>
      )}

      <section className="logs-metrics" aria-label="Log summary">
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-green"><CheckCircle2 size={18} aria-hidden /></span>
          <div><strong>{metrics.successRate}%</strong><span>Successful responses</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Clock3 size={18} aria-hidden /></span>
          <div><strong>{formatDuration(metrics.averageDuration)}</strong><span>Average duration</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-amber"><AlertTriangle size={18} aria-hidden /></span>
          <div><strong>{metrics.partial}</strong><span>Partial responses</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Users size={18} aria-hidden /></span>
          <div><strong>{metrics.uniqueVisitors}</strong><span>Unique networks</span></div>
        </article>
      </section>

      <section className="logs-panel">
        <div className="logs-panel-head">
          <div>
            <h2>Request activity</h2>
            <p>{logs.length} retained request{logs.length === 1 ? '' : 's'} · up to seven days</p>
          </div>
          <div className="logs-panel-actions">
            <span className="logs-refresh-status" aria-live="polite">
              {refreshing ? 'Refreshing…' : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
            </span>
            <button type="button" className="logs-icon-btn" onClick={() => void fetchLogs(true)} disabled={refreshing} title="Refresh logs" aria-label="Refresh logs">
              <RefreshCw className={refreshing ? 'logs-spin' : ''} size={16} aria-hidden />
            </button>
            <button type="button" className="logs-btn logs-btn-quiet" onClick={() => downloadCsv(filteredAndSorted)} disabled={filteredAndSorted.length === 0}>
              <Download size={15} aria-hidden /> Export CSV
            </button>
          </div>
        </div>

        <div className="logs-controls">
          <label className="logs-search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search logs</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search location, date, status, network…" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} aria-hidden /></button>}
          </label>
          <div className="logs-filter-tabs" aria-label="Filter by response status">
            {STATUS_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={statusFilter === filter.value ? 'is-active' : ''}
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={statusFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="logs-empty"><ShieldCheck size={26} aria-hidden /><h3>No report requests yet</h3><p>New safety reports will appear here automatically.</p></div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="logs-empty"><Search size={26} aria-hidden /><h3>No matching requests</h3><p>Try a different search or status filter.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('all'); }}>Clear filters</button></div>
        ) : (
          <div className="logs-table-scroll">
            <table className="logs-table">
              <thead>
                <tr>
                  <th><SortButton sortKey="timestamp" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Received</SortButton></th>
                  <th><SortButton sortKey="name" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Report</SortButton></th>
                  <th><SortButton sortKey="date" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Plan</SortButton></th>
                  <th><SortButton sortKey="statusCode" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Response</SortButton></th>
                  <th><SortButton sortKey="safetyScore" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Score</SortButton></th>
                  <th><SortButton sortKey="durationMs" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Duration</SortButton></th>
                  <th><SortButton sortKey="ip" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Network</SortButton></th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((entry, index) => {
                  const time = formatLogTime(entry.timestamp);
                  const plannerHref = entry.lat != null && entry.lon != null
                    ? `/planner?lat=${entry.lat.toFixed(5)}&lon=${entry.lon.toFixed(5)}${entry.date ? `&date=${encodeURIComponent(entry.date)}` : ''}${entry.startTime ? `&start=${encodeURIComponent(entry.startTime)}` : ''}${entry.name ? `&name=${encodeURIComponent(entry.name)}` : ''}`
                    : null;
                  const scoreClass = entry.safetyScore == null ? '' : entry.safetyScore >= 70 ? 'is-good' : entry.safetyScore >= 55 ? 'is-watch' : 'is-risk';
                  return (
                    <tr key={`${entry.timestamp}-${entry.lat}-${entry.lon}-${index}`}>
                      <td><span className="logs-cell-primary logs-cell-tabular">{time.primary}</span><span className="logs-cell-secondary">{time.secondary}</span></td>
                      <td><span className="logs-cell-primary">{entry.name ?? 'Unnamed report'}</span><span className="logs-cell-secondary logs-cell-mono">{entry.lat != null && entry.lon != null ? `${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)}` : 'No coordinates'}</span></td>
                      <td><span className="logs-cell-primary">{entry.date ?? 'No date'}</span><span className="logs-cell-secondary">{entry.startTime ? `Starts ${entry.startTime}` : 'No start time'}</span></td>
                      <td>
                        <span className={entry.statusCode === 200 ? 'logs-status-pill is-ok' : 'logs-status-pill is-error'}>{entry.statusCode}</span>
                        {entry.partialData === true && <span className="logs-status-pill is-partial">Partial</span>}
                      </td>
                      <td><span className={`logs-score ${scoreClass}`}>{entry.safetyScore != null ? entry.safetyScore : '—'}</span></td>
                      <td className="logs-cell-tabular">{formatDuration(entry.durationMs)}</td>
                      <td title={entry.userAgent ?? undefined}><span className="logs-cell-primary logs-cell-mono">{entry.ip ?? '—'}</span><span className="logs-cell-secondary">Masked</span></td>
                      <td>{plannerHref ? <a className="logs-open-link" href={plannerHref} target="_blank" rel="noopener noreferrer" aria-label={`Open ${entry.name ?? 'report'} in planner`}><ExternalLink size={15} aria-hidden /></a> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="logs-panel-foot">
          <span>Showing {filteredAndSorted.length} of {logs.length}</span>
          <span>Auto-refreshes every 30 seconds</span>
        </footer>
      </section>
    </div>
  );
}
