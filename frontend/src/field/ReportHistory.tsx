import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, Link, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { parsePersistedReport, type PersistedReport } from '../app/report-storage';
import { copyTextToClipboard } from '../app/clipboard';
import { useAccount } from '../hooks/useAccount';
import { buildSavedReportShareUrl, getSavedReport, listSavedReportsPage, type SavedReportSummary } from '../lib/saved-reports';
import type { Page } from './data';
import './report-history.css';

function planDate(value: string | null) {
  if (!value) return 'Plan date unavailable';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Plan date unavailable' : date.toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
function timestamp(value: string | null | undefined) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? 'unavailable' : date.toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function ReportHistory({ localReport, onOpen, navigate, sharingEnabled }: {
  localReport: PersistedReport | null;
  onOpen: (report: PersistedReport, token?: string, reportId?: string) => void;
  navigate: (page: Page) => void;
  sharingEnabled: boolean;
}) {
  const account = useAccount();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [aiOnly, setAiOnly] = useState(false);
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState('');
  const [copied, setCopied] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const actionRef = useRef<AbortController | null>(null);
  const morePendingRef = useRef(false);
  const userId = account.user?.id;
  const searching = search.trim() !== query;

  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    morePendingRef.current = false;
    setReports([]);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadError('');
    setLoading(account.loading || Boolean(userId));
    if (userId && !account.loading) {
      void listSavedReportsPage({ signal: controller.signal, search: query, aiOnly })
        .then(page => {
          if (!controller.signal.aborted) {
            setReports(page.reports);
            setNextCursor(page.nextCursor);
          }
        })
        .catch(error => {
          if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load report history.');
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [userId, account.loading, query, aiOnly, revision]);

  useEffect(() => {
    setPending('');
    setActionError('');
    setNotice('');
    setCopied('');
    return () => { actionRef.current?.abort(); actionRef.current = null; };
  }, [userId]);

  async function loadMore() {
    const controller = requestRef.current;
    if (!nextCursor || !controller || controller.signal.aborted || morePendingRef.current) return;
    morePendingRef.current = true;
    setLoadingMore(true);
    setLoadError('');
    try {
      const page = await listSavedReportsPage({ signal: controller.signal, search: query, aiOnly, cursor: nextCursor });
      if (controller.signal.aborted) return;
      setReports(current => {
        const ids = new Set(current.map(report => report.id));
        return [...current, ...page.reports.filter(report => !ids.has(report.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load older reports.');
    } finally {
      if (!controller.signal.aborted) {
        morePendingRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  async function run(id: string, action: (signal: AbortSignal) => Promise<void>) {
    if (actionRef.current) return;
    const controller = new AbortController();
    actionRef.current = controller;
    setPending(id);
    setActionError('');
    setNotice('');
    try { await action(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : 'Could not open this report.');
    } finally {
      if (!controller.signal.aborted) { setPending(''); actionRef.current = null; }
    }
  }

  const filtered = Boolean(query || aiOnly);
  function clearFilters() { setSearch(''); setQuery(''); setAiOnly(false); }
  const localScore = localReport?.safetyData.safety.score;

  return <section className="field-library field-report-history">
    <header className="field-page-heading">
      <span className="field-kicker">Library</span>
      <h1>Saved reports</h1>
      <p>Revisit your conditions, route analysis, and AI conversations. Saved reports show a snapshot from when they were generated.</p>
    </header>

    {localReport && <section className="field-history-device" aria-label="Report on this device">
      <div><h2>On this device</h2><p>Your most recent browser snapshot. It may also be saved to your account.</p></div>
      <button className="field-journal-entry" disabled={Boolean(pending)} onClick={() => onOpen(localReport)}>
        <span className="field-journal-icon"><BookOpen size={22} aria-hidden="true" /></span>
        <span>
          <small>{planDate(localReport.plan.forecastDate)} · {localReport.plan.alpineStartTime} start</small>
          <strong>{localReport.plan.objectiveName}</strong>
          <span>Generated {timestamp(localReport.safetyData.generatedAt)}</span>
        </span>
        <b aria-label={`Snapshot score ${Number.isFinite(localScore) ? Math.round(localScore!) : 'unavailable'}`}>
          {Number.isFinite(localScore) ? Math.round(localScore!) : '—'}<small>/100</small>
        </b>
        <ArrowUpRight size={18} aria-hidden="true" />
      </button>
    </section>}

    <div className="field-library-bar">
      <h2>Account history</h2>
      <div className="field-action-row">
        {userId && <button className="field-button" disabled={loading || loadingMore} onClick={() => setRevision(n => n + 1)}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>}
        <button className="field-button" onClick={() => navigate('planner')}>Plan an outing <ArrowUpRight size={15} aria-hidden="true" /></button>
      </div>
    </div>

    {userId && <div className="field-history-filters">
      <div className="field-library-search">
        <label htmlFor={searchId}>Search all account reports</label>
        <div className="field-input-icon">
          <Search size={17} aria-hidden="true" />
          <input id={searchId} type="search" maxLength={200} placeholder="Objective or date (YYYY-MM-DD)" value={search} onChange={event => setSearch(event.target.value)} />
          {search && <button className="field-icon-button" aria-label="Clear search" onClick={() => {
            setSearch(''); setQuery(''); document.getElementById(searchId)?.focus({ preventScroll: true });
          }}><X size={16} aria-hidden="true" /></button>}
        </div>
      </div>
      <label className="field-toggle"><input type="checkbox" checked={aiOnly} onChange={event => setAiOnly(event.target.checked)} />With AI content</label>
    </div>}

    {actionError && <p className="field-warning" role="alert">{actionError}</p>}
    {notice && <p className="field-feedback" role="status">{notice}</p>}
    {loadError && <div className="field-warning" role="alert">
      <p>{loadError}</p>
      <button className="field-button" disabled={loading || loadingMore} onClick={() => nextCursor ? void loadMore() : setRevision(n => n + 1)}>Try again</button>
    </div>}
    <p className="field-history-count" role="status">
      {loading || searching ? 'Loading report history…' : userId && !loadError
        ? `${reports.length}${nextCursor ? '+' : ''} ${filtered ? 'matching ' : ''}account ${reports.length === 1 && !nextCursor ? 'report' : 'reports'} · Newest saved first`
        : ''}
    </p>

    {!loading && !searching && reports.map(report => <article className="field-library-entry" key={report.id}>
      <button className="field-journal-entry" disabled={Boolean(pending)} onClick={() => void run(report.id, async signal => {
        const snapshot = parsePersistedReport(await getSavedReport(report.id, signal));
        if (signal.aborted) return;
        if (!snapshot) throw new Error('This saved report is incomplete or no longer compatible.');
        onOpen(snapshot, report.shareToken, report.id);
      })}>
        <span className="field-journal-icon"><BookOpen size={22} aria-hidden="true" /></span>
        <span>
          <small>{planDate(report.forecastDate)}{report.alpineStartTime && ` · ${report.alpineStartTime} start`}</small>
          <strong>{report.objectiveName || report.title}</strong>
          <span>Generated {timestamp(report.generatedAt)}</span>
          <span>Saved {timestamp(report.createdAt)}{report.hasAi && ' · Includes AI content'}</span>
        </span>
        <b aria-label={`Snapshot score ${report.score === null ? 'unavailable' : Math.round(report.score)}`}>
          {report.score === null ? '—' : Math.round(report.score)}<small>/100</small>
        </b>
        {pending === report.id ? <LoaderCircle className="field-history-spinner" size={18} aria-label="Opening report" /> : <ArrowUpRight size={18} aria-hidden="true" />}
      </button>
      {sharingEnabled && <button className="field-text-button" disabled={Boolean(pending)} aria-label={`Copy report link for ${report.objectiveName || report.title}`} onClick={() => void run(`share-${report.id}`, async signal => {
        const success = await copyTextToClipboard(buildSavedReportShareUrl(report.shareToken));
        if (signal.aborted) return;
        if (!success) throw new Error('Could not copy this report link. Please try again.');
        setCopied(report.id); setNotice(`Report link copied for ${report.objectiveName || report.title}.`);
      })}>{copied === report.id ? <Check size={14} aria-hidden="true" /> : <Link size={14} aria-hidden="true" />}{copied === report.id ? 'Link copied' : 'Copy report link'}</button>}
    </article>)}

    {!loading && !searching && nextCursor && <div className="field-history-more">
      <button className="field-button" disabled={loadingMore} onClick={() => void loadMore()}>
        {loadingMore ? 'Loading older reports…' : 'Load older reports'}
      </button>
    </div>}
    {!loading && !searching && !loadError && (!userId || reports.length === 0) && <div className="field-empty-state">
      {filtered && userId ? <Search size={32} aria-hidden="true" /> : <BookOpen size={32} aria-hidden="true" />}
      <h3>{!userId ? 'Take your reports with you' : filtered ? 'No matching reports' : 'No account reports yet'}</h3>
      <p>{!userId ? 'Sign in to save reports and revisit them across your devices.' : filtered
        ? 'Try a different objective or date, or clear your filters.' : 'Reports generated while signed in are saved here automatically. You can also save a report from its toolbar.'}</p>
      <button className="field-button" onClick={() => !userId ? navigate('account') : filtered ? clearFilters() : navigate('planner')}>
        {!userId ? 'Open your account' : filtered ? 'Clear filters' : 'Create a report'}
      </button>
    </div>}
  </section>;
}
