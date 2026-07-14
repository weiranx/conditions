import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  FileClock,
  LoaderCircle,
  MapPinned,
  Share2,
  Sparkles,
} from 'lucide-react';
import { copyTextToClipboard } from '../../app/clipboard';
import { parsePersistedReport, type PersistedReport } from '../../app/report-storage';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import { useProductFeatureFlags } from '../../contexts/feature-flags';
import {
  buildSavedReportShareUrl,
  getSavedReport,
  listSavedReports,
  type SavedReportSummary,
} from '../../lib/saved-reports';
import { ProductNav } from './ProductNav';
import '../../styles/history.css';

interface HistoryViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  onOpenReport: (report: PersistedReport, shareToken: string) => void;
}

const formatGeneratedAt = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'date unavailable'
    : parsed.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatPlanDate = (value: string | null) => {
  if (!value) return 'Date unavailable';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export function HistoryView({
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
  onOpenReport,
}: HistoryViewProps) {
  const account = useAccount();
  const featureFlags = useProductFeatureFlags();
  const accountUserId = account.user?.id;
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!accountUserId) {
      setReports([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listSavedReports(controller.signal)
      .then((nextReports) => {
        if (!controller.signal.aborted) setReports(nextReports);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load report history.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountUserId]);

  const openReport = async (report: SavedReportSummary) => {
    if (openingId) return;
    setOpeningId(report.id);
    setError(null);
    try {
      const snapshot = parsePersistedReport(await getSavedReport(report.id));
      if (!snapshot) throw new Error('This generated report is incomplete or no longer compatible.');
      onOpenReport(snapshot, report.shareToken);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not retrieve this generated report.');
    } finally {
      setOpeningId(null);
    }
  };

  const shareReport = async (report: SavedReportSummary) => {
    setError(null);
    const copied = await copyTextToClipboard(buildSavedReportShareUrl(report.shareToken));
    if (!copied) {
      setError('Could not copy this report link. Please try again.');
      return;
    }
    setCopiedId(report.id);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedId(null);
      copiedTimerRef.current = null;
    }, 1600);
  };

  return (
    <div className={`${appShellClassName} history-page-shell`} aria-busy={isViewPending || loading || Boolean(openingId)}>
      <ProductNav
        active="history"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <main className="history-page">
        <header className="history-head">
          <div className="history-head-icon" aria-hidden><FileClock /></div>
          <p>Generated reports</p>
          <h1>Your generated reports</h1>
          <span>Open an exact generated report without fetching new conditions or using AI again.</span>
        </header>

        {!account.user ? (
          <section className="history-empty" aria-labelledby="history-signin-title">
            <FileClock aria-hidden />
            <h2 id="history-signin-title">Sign in to view report history</h2>
            <p>Reports generated while you are signed in are added securely to your account history.</p>
            <button type="button" onClick={() => navigateToView('settings')}>Open account settings</button>
          </section>
        ) : loading ? (
          <div className="history-loading" role="status">
            <LoaderCircle className="history-spinner" aria-hidden />
            Loading generated reports…
          </div>
        ) : reports.length === 0 ? (
          <section className="history-empty" aria-labelledby="history-empty-title">
            <MapPinned aria-hidden />
            <h2 id="history-empty-title">No generated reports yet</h2>
            <p>Generate a report while signed in and it will appear here automatically.</p>
            <button type="button" onClick={openPlannerView}>Create a report</button>
          </section>
        ) : (
          <section className="history-list" aria-label="Generated reports">
            {reports.map((report) => (
              <article
                key={report.id}
                className="history-card"
              >
                <button
                  type="button"
                  className="history-card-open"
                  onClick={() => void openReport(report)}
                  disabled={Boolean(openingId)}
                >
                  <span className="history-card-main">
                    <span className="history-card-kicker">Generated {formatGeneratedAt(report.createdAt)}</span>
                    <strong>{report.objectiveName || report.title}</strong>
                    <span className="history-card-meta">
                      <span><CalendarDays aria-hidden /> {formatPlanDate(report.forecastDate)}</span>
                      {report.alpineStartTime && <span><Clock3 aria-hidden /> Start {report.alpineStartTime}</span>}
                    </span>
                  </span>
                  <span className="history-card-side">
                    {report.hasAi && <span className="history-ai-tag"><Sparkles aria-hidden /> AI included</span>}
                    {report.score !== null && <span className="history-score"><small>Score</small>{Math.round(report.score)}</span>}
                    {openingId === report.id
                      ? <LoaderCircle className="history-spinner" aria-hidden />
                      : <ArrowRight className="history-arrow" aria-hidden />}
                  </span>
                </button>
                {featureFlags.reportSharing && <button
                  type="button"
                  className="history-share"
                  onClick={() => void shareReport(report)}
                  aria-label={`Copy share link for ${report.objectiveName || report.title}`}
                >
                  {copiedId === report.id ? <Check aria-hidden /> : <Share2 aria-hidden />}
                  <span>{copiedId === report.id ? 'Copied' : 'Share'}</span>
                </button>}
              </article>
            ))}
          </section>
        )}

        {error && <p className="history-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
