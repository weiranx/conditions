import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { House } from 'lucide-react';
import { fetchApi } from '../../lib/api-client';

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

export function LogsView({ onHome }: { onHome: () => void }) {
  const [secretKey, setSecretKey] = useState<string>(() => sessionStorage.getItem(LOGS_SESSION_KEY) ?? '');
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  const handleUnauthorized = useCallback(() => {
    sessionStorage.removeItem(LOGS_SESSION_KEY);
    setSecretKey('');
    setRejected(true);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    sessionStorage.setItem(LOGS_SESSION_KEY, trimmed);
    setSecretKey(trimmed);
    setRejected(false);
    setDraft('');
  }, [draft]);

  return (
    <>
      <div className="settings-head">
        <div>
          <div className="home-kicker">Backcountry Conditions</div>
          <h2>Report Logs</h2>
          <p>All safety report requests received by the server. Auto-refreshes every 30 seconds.</p>
        </div>
        <div className="settings-nav">
          <button className="settings-btn" onClick={onHome}>
            <House size={14} /> Homepage
          </button>
        </div>
      </div>
      {secretKey
        ? <ReportLogsTable secretKey={secretKey} onUnauthorized={handleUnauthorized} />
        : (
          <form onSubmit={handleSubmit} className="logs-unlock-form">
            {rejected && <p className="logs-unlock-error">Incorrect key — try again.</p>}
            <label htmlFor="logs-key-input">Access key</label>
            <input
              id="logs-key-input"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter access key"
              autoFocus
            />
            <button type="submit" className="primary-btn">Unlock</button>
          </form>
        )
      }
    </>
  );
}

type LogSortKey = 'timestamp' | 'name' | 'coords' | 'date' | 'startTime' | 'statusCode' | 'safetyScore' | 'partialData' | 'durationMs' | 'ip';

const LOG_COLUMNS: { key: LogSortKey; label: string }[] = [
  { key: 'timestamp', label: 'Time' },
  { key: 'name', label: 'Name' },
  { key: 'coords', label: 'Lat / Lon' },
  { key: 'date', label: 'Date' },
  { key: 'startTime', label: 'Start' },
  { key: 'statusCode', label: 'Status' },
  { key: 'safetyScore', label: 'Score' },
  { key: 'partialData', label: 'Partial' },
  { key: 'durationMs', label: 'Duration' },
  { key: 'ip', label: 'IP' },
];

function getLogSortValue(entry: ReportLogEntry, key: LogSortKey): string | number {
  switch (key) {
    case 'timestamp': return entry.timestamp;
    case 'name': return entry.name ?? '';
    case 'coords': return entry.lat != null && entry.lon != null ? `${entry.lat.toFixed(4)},${entry.lon.toFixed(4)}` : '';
    case 'date': return entry.date ?? '';
    case 'startTime': return entry.startTime ?? '';
    case 'statusCode': return entry.statusCode;
    case 'safetyScore': return entry.safetyScore ?? -1;
    case 'partialData': return entry.partialData == null ? -1 : entry.partialData ? 1 : 0;
    case 'durationMs': return entry.durationMs;
    case 'ip': return entry.ip ?? '';
    default: return '';
  }
}

function getLogCellText(entry: ReportLogEntry, key: LogSortKey): string {
  switch (key) {
    case 'timestamp': return new Date(entry.timestamp).toLocaleString();
    case 'name': return entry.name ?? '';
    case 'coords': return entry.lat != null && entry.lon != null ? `${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)}` : '';
    case 'date': return entry.date ?? '';
    case 'startTime': return entry.startTime ?? '';
    case 'statusCode': return String(entry.statusCode);
    case 'safetyScore': return entry.safetyScore != null ? String(entry.safetyScore) : '';
    case 'partialData': return entry.partialData == null ? '' : entry.partialData ? 'Yes' : 'No';
    case 'durationMs': return String(entry.durationMs);
    case 'ip': return entry.ip ?? '';
    default: return '';
  }
}

type LogColumnFilters = Partial<Record<LogSortKey, string>>;

function ReportLogsTable({ secretKey, onUnauthorized }: { secretKey: string; onUnauthorized: () => void }) {
  const [logs, setLogs] = useState<ReportLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<LogSortKey>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);
  const [columnSearches, setColumnSearches] = useState<LogColumnFilters>({});
  const [exactFilters, setExactFilters] = useState<LogColumnFilters>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; key: LogSortKey; value: string } | null>(null);

  const fetchLogs = useCallback(async () => {
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
      } else {
        setError('Failed to load report logs.');
      }
      setLastRefreshed(new Date());
    } catch {
      setError('Network error loading logs.');
    } finally {
      setLoading(false);
    }
  }, [secretKey, onUnauthorized]);

  useEffect(() => {
    void fetchLogs();
    const interval = setInterval(() => void fetchLogs(), 30_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [contextMenu]);

  const handleSort = (key: LogSortKey) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'ip' || key === 'date');
    }
  };

  const setColumnSearch = (key: LogSortKey, value: string) => {
    setColumnSearches((prev) => {
      if (!value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleCellContextMenu = (e: React.MouseEvent, key: LogSortKey, entry: ReportLogEntry) => {
    e.preventDefault();
    const value = getLogCellText(entry, key);
    if (!value) return;
    setContextMenu({ x: e.clientX, y: e.clientY, key, value });
  };

  const applyExactFilter = (key: LogSortKey, value: string) => {
    setExactFilters((prev) => ({ ...prev, [key]: value }));
    setContextMenu(null);
  };

  const clearExactFilter = (key: LogSortKey) => {
    setExactFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const activeFilterCount = Object.keys(exactFilters).length;

  const filteredAndSorted = useMemo(() => {
    let result = logs;

    for (const [key, q] of Object.entries(columnSearches) as [LogSortKey, string][]) {
      if (!q) continue;
      const lower = q.toLowerCase();
      result = result.filter((e) => getLogCellText(e, key).toLowerCase().includes(lower));
    }

    for (const [key, val] of Object.entries(exactFilters) as [LogSortKey, string][]) {
      result = result.filter((e) => getLogCellText(e, key) === val);
    }

    return [...result].sort((a, b) => {
      const av = getLogSortValue(a, sortKey);
      const bv = getLogSortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }, [logs, columnSearches, exactFilters, sortKey, sortAsc]);

  if (loading) {
    return <p className="logs-status-msg">Loading logs…</p>;
  }
  if (error) {
    return <p className="logs-status-msg logs-error-msg">{error}</p>;
  }
  if (logs.length === 0) {
    return (
      <div className="logs-status-msg">
        <p>No report requests logged yet. Run a safety report to see entries here.</p>
        {lastRefreshed && <p className="logs-meta">Last checked: {lastRefreshed.toLocaleTimeString()}</p>}
      </div>
    );
  }

  const uniqueVisitors = new Set(logs.map((l) => l.ip).filter(Boolean)).size;

  return (
    <div className="logs-table-wrap">
      <div className="logs-toolbar">
        {lastRefreshed && (
          <p className="logs-meta">
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} · {uniqueVisitors} unique visitor{uniqueVisitors === 1 ? '' : 's'}
            {filteredAndSorted.length !== logs.length && ` · ${filteredAndSorted.length} shown`}
            {' '}· Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </p>
        )}
        {activeFilterCount > 0 && (
          <div className="logs-active-filters">
            {(Object.entries(exactFilters) as [LogSortKey, string][]).map(([key, val]) => {
              const col = LOG_COLUMNS.find((c) => c.key === key);
              return (
                <span key={key} className="logs-filter-tag">
                  {col?.label}: {val}
                  <button className="logs-filter-tag-x" onClick={() => clearExactFilter(key)}>×</button>
                </span>
              );
            })}
            <button className="logs-clear-filters" onClick={() => setExactFilters({})}>Clear all</button>
          </div>
        )}
      </div>
      <table className="logs-table">
        <thead>
          <tr>
            {LOG_COLUMNS.map((col) => (
              <th key={col.key} className="logs-th-sortable" onClick={() => handleSort(col.key)}>
                {col.label}
                {sortKey === col.key && <span className="logs-sort-arrow">{sortAsc ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
            <th>Link</th>
          </tr>
          <tr className="logs-search-row">
            {LOG_COLUMNS.map((col) => (
              <th key={col.key} className="logs-search-cell">
                <input
                  type="text"
                  className="logs-col-search"
                  placeholder="Filter…"
                  value={columnSearches[col.key] ?? ''}
                  onChange={(e) => setColumnSearch(col.key, e.target.value)}
                />
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((entry, i) => {
            const plannerHref = entry.lat != null && entry.lon != null
              ? `/planner?lat=${entry.lat.toFixed(5)}&lon=${entry.lon.toFixed(5)}${entry.date ? `&date=${encodeURIComponent(entry.date)}` : ''}${entry.startTime ? `&start=${encodeURIComponent(entry.startTime)}` : ''}${entry.name ? `&name=${encodeURIComponent(entry.name)}` : ''}`
              : null;
            return (
              <tr key={i} className={i % 2 === 0 ? 'logs-row-alt' : ''}>
                <td className="logs-cell-nowrap" onContextMenu={(e) => handleCellContextMenu(e, 'timestamp', entry)}>{new Date(entry.timestamp).toLocaleString()}</td>
                <td onContextMenu={(e) => handleCellContextMenu(e, 'name', entry)}>{entry.name ?? '—'}</td>
                <td className="logs-cell-mono" onContextMenu={(e) => handleCellContextMenu(e, 'coords', entry)}>
                  {entry.lat != null && entry.lon != null ? `${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)}` : '—'}
                </td>
                <td onContextMenu={(e) => handleCellContextMenu(e, 'date', entry)}>{entry.date ?? '—'}</td>
                <td onContextMenu={(e) => handleCellContextMenu(e, 'startTime', entry)}>{entry.startTime ?? '—'}</td>
                <td className={entry.statusCode === 200 ? 'logs-cell-ok' : 'logs-cell-err'} onContextMenu={(e) => handleCellContextMenu(e, 'statusCode', entry)}>
                  {entry.statusCode}
                </td>
                <td style={entry.safetyScore != null ? { color: entry.safetyScore >= 80 ? 'var(--accent-green)' : entry.safetyScore >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)', fontWeight: 600 } : undefined} onContextMenu={(e) => handleCellContextMenu(e, 'safetyScore', entry)}>
                  {entry.safetyScore != null ? `${entry.safetyScore}%` : '—'}
                </td>
                <td onContextMenu={(e) => handleCellContextMenu(e, 'partialData', entry)}>{entry.partialData == null ? '—' : entry.partialData ? 'Yes' : 'No'}</td>
                <td onContextMenu={(e) => handleCellContextMenu(e, 'durationMs', entry)}>{entry.durationMs != null ? `${entry.durationMs}ms` : '—'}</td>
                <td className="logs-cell-mono" onContextMenu={(e) => handleCellContextMenu(e, 'ip', entry)}>{entry.ip ?? '—'}</td>
                <td>
                  {plannerHref ? <a href={plannerHref} target="_blank" rel="noopener noreferrer">Open</a> : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {contextMenu && (
        <div className="logs-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button className="logs-context-item" onClick={() => applyExactFilter(contextMenu.key, contextMenu.value)}>
            Filter {LOG_COLUMNS.find((c) => c.key === contextMenu.key)?.label} = "{contextMenu.value.length > 24 ? contextMenu.value.slice(0, 24) + '…' : contextMenu.value}"
          </button>
        </div>
      )}
    </div>
  );
}
