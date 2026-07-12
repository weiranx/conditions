import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Gauge,
  KeyRound,
  LoaderCircle,
  Lock,
  MapPinned,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

interface AIUsageEntry {
  timestamp: string;
  provider: string;
  model: string;
  feature: string;
  status: 'success' | 'error';
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
            <div className="logs-kicker"><BarChart3 size={14} aria-hidden /> Analytics</div>
            <h1>Report analytics</h1>
            <p>Understand report demand, response health, and processing performance across the last seven days.</p>
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
type AnalyticsRange = '24h' | '7d';

const ANALYTICS_RANGES: Array<{ value: AnalyticsRange; label: string; durationMs: number }> = [
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
];

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  border: '1px solid var(--ui-line-strong)',
  borderRadius: 8,
  background: 'var(--ui-surface)',
  boxShadow: 'var(--ui-shadow-md)',
  color: 'var(--ui-text)',
  fontSize: 12,
};

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

function formatDuration(durationMs: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return '—';
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

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function isHealthyResponse(entry: ReportLogEntry): boolean {
  return entry.statusCode === 200 && entry.partialData !== true;
}

function buildTrendData(entries: ReportLogEntry[], range: AnalyticsRange, now: number) {
  const rangeDuration = ANALYTICS_RANGES.find((option) => option.value === range)?.durationMs ?? ANALYTICS_RANGES[1].durationMs;
  const bucketDuration = range === '24h' ? 2 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const start = now - rangeDuration;
  const bucketCount = Math.ceil(rangeDuration / bucketDuration);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketDuration;
    const date = new Date(bucketStart);
    return {
      timestamp: bucketStart,
      label: range === '24h'
        ? date.toLocaleTimeString([], { hour: 'numeric' })
        : date.toLocaleDateString([], { weekday: 'short' }),
      period: range === '24h'
        ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
        : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }),
      healthy: 0,
      partial: 0,
      errors: 0,
      durations: [] as number[],
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) return;
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketDuration))];
    if (!bucket) return;
    if (entry.statusCode !== 200) bucket.errors += 1;
    else if (entry.partialData === true) bucket.partial += 1;
    else bucket.healthy += 1;
    if (Number.isFinite(entry.durationMs)) bucket.durations.push(entry.durationMs);
  });

  return buckets.map(({ durations, ...bucket }) => ({
    ...bucket,
    total: bucket.healthy + bucket.partial + bucket.errors,
    medianSeconds: durations.length ? percentile(durations, 0.5) / 1000 : null,
    p95Seconds: durations.length ? percentile(durations, 0.95) / 1000 : null,
  }));
}

function buildHourlyDistribution(entries: ReportLogEntry[]) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' }),
    requests: 0,
  }));
  entries.forEach((entry) => {
    const date = new Date(entry.timestamp);
    if (!Number.isNaN(date.getTime())) hours[date.getHours()].requests += 1;
  });
  return hours;
}

function buildTopLocations(entries: ReportLogEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    const location = entry.name?.trim() || 'Unnamed report';
    counts.set(location, (counts.get(location) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: entries.length ? (count / entries.length) * 100 : 0 }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 6);
}

function buildAITrendData(entries: AIUsageEntry[], range: AnalyticsRange, now: number) {
  const rangeDuration = ANALYTICS_RANGES.find((option) => option.value === range)?.durationMs ?? ANALYTICS_RANGES[1].durationMs;
  const bucketDuration = range === '24h' ? 2 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const start = now - rangeDuration;
  const bucketCount = Math.ceil(rangeDuration / bucketDuration);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketDuration;
    const date = new Date(bucketStart);
    return {
      timestamp: bucketStart,
      label: range === '24h'
        ? date.toLocaleTimeString([], { hour: 'numeric' })
        : date.toLocaleDateString([], { weekday: 'short' }),
      inputTokens: 0,
      outputTokens: 0,
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) return;
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketDuration))];
    if (!bucket) return;
    bucket.inputTokens += Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0;
    bucket.outputTokens += Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0;
  });

  return buckets;
}

function buildAIModels(entries: AIUsageEntry[]) {
  const models = new Map<string, { provider: string; model: string; calls: number; tokens: number }>();
  entries.forEach((entry) => {
    const key = `${entry.provider}:${entry.model}`;
    const current = models.get(key) ?? { provider: entry.provider, model: entry.model, calls: 0, tokens: 0 };
    current.calls += 1;
    current.tokens += Number.isFinite(entry.totalTokens) ? entry.totalTokens : 0;
    models.set(key, current);
  });
  return [...models.values()].sort((left, right) => right.tokens - left.tokens || right.calls - left.calls);
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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
  const [aiUsage, setAIUsage] = useState<AIUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiUsageError, setAIUsageError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<LogSortKey>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('7d');
  const hasLoadedRef = useRef(false);

  const fetchLogs = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const headers = { Authorization: `Bearer ${secretKey}` };
      const [logsResult, aiUsageResult] = await Promise.all([
        fetchApi('/api/report-logs', { headers }),
        fetchApi('/api/ai-usage', { headers }),
      ]);
      if ([logsResult.response.status, aiUsageResult.response.status].some((status) => status === 401 || status === 403)) {
        onUnauthorized();
        return;
      }
      if (logsResult.response.ok && Array.isArray(logsResult.payload)) {
        setLogs(logsResult.payload as ReportLogEntry[]);
        setError(null);
        setLastRefreshed(new Date());
      } else {
        setError('The server could not load report logs.');
      }
      if (aiUsageResult.response.ok && Array.isArray(aiUsageResult.payload)) {
        setAIUsage(aiUsageResult.payload as AIUsageEntry[]);
        setAIUsageError(null);
      } else {
        setAIUsageError('AI usage data is temporarily unavailable.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setAIUsageError('AI usage data is temporarily unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [secretKey, onUnauthorized]);

  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void fetchLogs();
    }
    const interval = window.setInterval(() => void fetchLogs(true), 30_000);
    return () => window.clearInterval(interval);
  }, [fetchLogs]);

  const referenceTime = lastRefreshed?.getTime() ?? Date.now();
  const selectedRange = ANALYTICS_RANGES.find((option) => option.value === analyticsRange) ?? ANALYTICS_RANGES[1];

  const rangeLogs = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return logs.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= referenceTime;
    });
  }, [logs, referenceTime, selectedRange.durationMs]);

  const rangeAIUsage = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return aiUsage.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= referenceTime;
    });
  }, [aiUsage, referenceTime, selectedRange.durationMs]);

  const metrics = useMemo(() => {
    const healthy = rangeLogs.filter(isHealthyResponse).length;
    const issues = rangeLogs.length - healthy;
    const durations = rangeLogs.map((entry) => entry.durationMs).filter(Number.isFinite);
    const previousStart = referenceTime - selectedRange.durationMs * 2;
    const previousEnd = referenceTime - selectedRange.durationMs;
    const previousCount = analyticsRange === '24h'
      ? logs.filter((entry) => {
        const timestamp = new Date(entry.timestamp).getTime();
        return Number.isFinite(timestamp) && timestamp >= previousStart && timestamp < previousEnd;
      }).length
      : null;
    const volumeDelta = previousCount && previousCount > 0
      ? Math.round(((rangeLogs.length - previousCount) / previousCount) * 100)
      : null;
    return {
      total: rangeLogs.length,
      healthyRate: rangeLogs.length ? Math.round((healthy / rangeLogs.length) * 1000) / 10 : null,
      p95Duration: durations.length ? percentile(durations, 0.95) : null,
      medianDuration: durations.length ? percentile(durations, 0.5) : null,
      uniqueVisitors: new Set(rangeLogs.map((entry) => entry.ip).filter(Boolean)).size,
      issues,
      volumeDelta,
    };
  }, [analyticsRange, logs, rangeLogs, referenceTime, selectedRange.durationMs]);

  const trendData = useMemo(
    () => buildTrendData(rangeLogs, analyticsRange, referenceTime),
    [analyticsRange, rangeLogs, referenceTime],
  );
  const hourlyDistribution = useMemo(() => buildHourlyDistribution(rangeLogs), [rangeLogs]);
  const topLocations = useMemo(() => buildTopLocations(rangeLogs), [rangeLogs]);
  const aiTrendData = useMemo(
    () => buildAITrendData(rangeAIUsage, analyticsRange, referenceTime),
    [analyticsRange, rangeAIUsage, referenceTime],
  );
  const aiModels = useMemo(() => buildAIModels(rangeAIUsage), [rangeAIUsage]);
  const aiMetrics = useMemo(() => {
    const successful = rangeAIUsage.filter((entry) => entry.status === 'success').length;
    return {
      calls: rangeAIUsage.length,
      inputTokens: rangeAIUsage.reduce((sum, entry) => sum + (Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0), 0),
      outputTokens: rangeAIUsage.reduce((sum, entry) => sum + (Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0), 0),
      successRate: rangeAIUsage.length ? Math.round((successful / rangeAIUsage.length) * 1000) / 10 : null,
    };
  }, [rangeAIUsage]);
  const busiestHour = useMemo(
    () => hourlyDistribution.reduce((busiest, current) => current.requests > busiest.requests ? current : busiest, hourlyDistribution[0]),
    [hourlyDistribution],
  );

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = rangeLogs.filter((entry) => {
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
  }, [query, rangeLogs, statusFilter, sortKey, sortAsc]);

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

      <section className="logs-dashboard-toolbar" aria-label="Analytics controls">
        <div>
          <h2>Overview</h2>
          <p>{rangeLogs.length.toLocaleString()} reports in the selected period</p>
        </div>
        <div className="logs-toolbar-actions">
          <span className="logs-refresh-status" aria-live="polite">
            {refreshing ? 'Refreshing…' : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
          <div className="logs-range-control" aria-label="Analytics date range">
            {ANALYTICS_RANGES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={analyticsRange === option.value ? 'is-active' : ''}
                onClick={() => setAnalyticsRange(option.value)}
                aria-pressed={analyticsRange === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="logs-icon-btn" onClick={() => void fetchLogs(true)} disabled={refreshing} title="Refresh analytics" aria-label="Refresh analytics">
            <RefreshCw className={refreshing ? 'logs-spin' : ''} size={16} aria-hidden />
          </button>
        </div>
      </section>

      <section className="logs-metrics" aria-label="Report analytics summary">
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Activity size={18} aria-hidden /></span>
          <div>
            <strong>{metrics.total.toLocaleString()}</strong>
            <span>Total reports{metrics.volumeDelta != null ? ` · ${metrics.volumeDelta >= 0 ? '+' : ''}${metrics.volumeDelta}% vs prior 24h` : ''}</span>
          </div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-green"><CheckCircle2 size={18} aria-hidden /></span>
          <div><strong>{metrics.healthyRate == null ? '—' : `${metrics.healthyRate}%`}</strong><span>Fully healthy responses</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Gauge size={18} aria-hidden /></span>
          <div><strong>{formatDuration(metrics.p95Duration)}</strong><span>P95 response time · median {formatDuration(metrics.medianDuration)}</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Users size={18} aria-hidden /></span>
          <div><strong>{metrics.uniqueVisitors}</strong><span>Unique masked networks</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-amber"><AlertTriangle size={18} aria-hidden /></span>
          <div><strong>{metrics.issues}</strong><span>Partial or failed responses</span></div>
        </article>
      </section>

      <section className="logs-analytics-grid" aria-label="Report activity charts">
        <article className="logs-chart-card logs-chart-card-wide">
          <div className="logs-chart-head">
            <div>
              <h2>Request health over time</h2>
              <p>Report volume by response outcome · {analyticsRange === '24h' ? '2-hour' : '12-hour'} intervals</p>
            </div>
            <Activity size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 238 }}>
              <BarChart data={trendData} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="healthy" name="Healthy" stackId="responses" fill="var(--ui-brand-strong)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="partial" name="Partial" stackId="responses" fill="var(--ui-risk-3)" />
                <Bar dataKey="errors" name="Failed" stackId="responses" fill="var(--ui-risk-4)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Response time</h2>
              <p>Median and 95th percentile · seconds</p>
            </div>
            <Clock3 size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 238 }}>
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={(value) => `${value}s`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [`${Number(value).toFixed(1)}s`, name]} />
                <Legend iconType="plainline" wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="p95Seconds" name="P95" stroke="var(--ui-risk-3)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="medianSeconds" name="Median" stroke="var(--ui-brand-strong)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Top report locations</h2>
              <p>Highest request volume in the selected period</p>
            </div>
            <MapPinned size={18} aria-hidden />
          </div>
          {topLocations.length ? (
            <ol className="logs-location-list">
              {topLocations.map((location, index) => (
                <li key={location.name}>
                  <span className="logs-location-rank">{index + 1}</span>
                  <div>
                    <div className="logs-location-label"><strong>{location.name}</strong><span>{location.count.toLocaleString()}</span></div>
                    <span className="logs-location-track"><span style={{ width: `${location.share}%` }} /></span>
                  </div>
                  <span className="logs-location-share">{Math.round(location.share)}%</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="logs-chart-empty">No location activity in this period.</div>
          )}
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Requests by hour</h2>
              <p>{rangeLogs.length ? `Local request time · busiest at ${busiestHour.label}` : 'Local request time · no requests in this period'}</p>
            </div>
            <BarChart3 size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap logs-chart-wrap-compact">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 205 }}>
              <BarChart data={hourlyDistribution} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={2} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                <Bar dataKey="requests" name="Reports" fill="var(--ui-brand-strong)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="logs-ai-section" aria-labelledby="logs-ai-title">
        <div className="logs-section-head">
          <div>
            <span className="logs-section-icon"><Sparkles size={17} aria-hidden /></span>
            <div>
              <h2 id="logs-ai-title">AI usage</h2>
              <p>Model calls and billed token volume for {selectedRange.label.toLowerCase()}</p>
            </div>
          </div>
          <span>{rangeAIUsage.length.toLocaleString()} calls</span>
        </div>

        {aiUsageError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {aiUsageError}</div>}

        <div className="logs-ai-metrics" aria-label="AI usage summary">
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Sparkles size={18} aria-hidden /></span>
            <div><strong>{aiMetrics.calls.toLocaleString()}</strong><span>Model calls</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Download size={18} aria-hidden /></span>
            <div><strong title={aiMetrics.inputTokens.toLocaleString()}>{formatTokenCount(aiMetrics.inputTokens)}</strong><span>Input tokens</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Activity size={18} aria-hidden /></span>
            <div><strong title={aiMetrics.outputTokens.toLocaleString()}>{formatTokenCount(aiMetrics.outputTokens)}</strong><span>Output tokens</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon is-green"><CheckCircle2 size={18} aria-hidden /></span>
            <div><strong>{aiMetrics.successRate == null ? '—' : `${aiMetrics.successRate}%`}</strong><span>Successful calls</span></div>
          </article>
        </div>

        <div className="logs-ai-grid">
          <article className="logs-chart-card">
            <div className="logs-chart-head">
              <div>
                <h2>Token activity</h2>
                <p>Input and output tokens · {analyticsRange === '24h' ? '2-hour' : '12-hour'} intervals</p>
              </div>
              <Activity size={18} aria-hidden />
            </div>
            {rangeAIUsage.length ? (
              <div className="logs-chart-wrap logs-chart-wrap-compact">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 205 }}>
                  <BarChart data={aiTrendData} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={formatTokenCount} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [Number(value).toLocaleString(), name]} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                    <Legend iconType="square" iconSize={8} wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="var(--ui-brand-strong)" />
                    <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="var(--ui-risk-3)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="logs-chart-empty">No AI calls in this period.</div>
            )}
          </article>

          <article className="logs-chart-card">
            <div className="logs-chart-head">
              <div>
                <h2>Models</h2>
                <p>Call and token volume by provider</p>
              </div>
              <Sparkles size={18} aria-hidden />
            </div>
            {aiModels.length ? (
              <ol className="logs-model-list">
                {aiModels.map((model, index) => (
                  <li key={`${model.provider}:${model.model}`}>
                    <span className="logs-location-rank">{index + 1}</span>
                    <div>
                      <strong title={model.model}>{model.model}</strong>
                      <span>{model.provider} · {model.calls.toLocaleString()} {model.calls === 1 ? 'call' : 'calls'}</span>
                    </div>
                    <span title={`${model.tokens.toLocaleString()} tokens`}>{formatTokenCount(model.tokens)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="logs-chart-empty">No model activity in this period.</div>
            )}
          </article>
        </div>
      </section>

      <section className="logs-panel">
        <div className="logs-panel-head">
          <div>
            <h2>Request activity</h2>
            <p>Raw report details for {selectedRange.label.toLowerCase()}</p>
          </div>
          <div className="logs-panel-actions">
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
        ) : rangeLogs.length === 0 ? (
          <div className="logs-empty"><Clock3 size={26} aria-hidden /><h3>No requests in this period</h3><p>Choose a longer date range to see retained report activity.</p></div>
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
          <span>Showing {filteredAndSorted.length} of {rangeLogs.length} in this period</span>
          <span>Auto-refreshes every 30 seconds</span>
        </footer>
      </section>
    </div>
  );
}
