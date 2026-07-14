import { useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, History, LoaderCircle, RefreshCw, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import type { PersistedReport } from '../../app/report-storage';
import { compareReports } from '../../app/report-changes';
import { useAccount } from '../../hooks/useAccount';
import {
  deleteObjectiveWatch,
  getObjectiveWatch,
  saveObjectiveWatch,
  type ObjectiveWatch,
} from '../../lib/objective-watches';
import { getReportComparisonBaseline, type ReportComparisonBaseline } from '../../lib/saved-reports';

interface ObjectiveMonitoringCardProps {
  report: PersistedReport;
  activeSavedReportId: string | null;
  readOnly: boolean;
}

const formatBaselineTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'an earlier report'
    : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function ObjectiveMonitoringCard({ report, activeSavedReportId, readOnly }: ObjectiveMonitoringCardProps) {
  const { user } = useAccount();
  const [watch, setWatch] = useState<ObjectiveWatch | null>(null);
  const [historyBaseline, setHistoryBaseline] = useState<ReportComparisonBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;
  const { lat, lon } = report.plan;

  useEffect(() => {
    if (!userId) {
      setWatch(null);
      setHistoryBaseline(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const historyRequest = activeSavedReportId
      ? getReportComparisonBaseline(report, activeSavedReportId, controller.signal)
      : Promise.resolve(null);
    void Promise.all([
      getObjectiveWatch(lat, lon, controller.signal),
      historyRequest,
    ]).then(([nextWatch, nextBaseline]) => {
      if (controller.signal.aborted) return;
      setWatch(nextWatch);
      setHistoryBaseline(nextBaseline);
    }).catch((loadError) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load monitoring history.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [activeSavedReportId, lat, lon, report, userId]);

  const baseline = watch?.baselineReport || historyBaseline?.snapshot || null;
  const comparison = useMemo(() => baseline ? compareReports(report, baseline) : null, [baseline, report]);
  const baselineLabel = watch?.baselineReport
    ? `watch baseline from ${formatBaselineTime(watch.baselineReport.savedAt || watch.createdAt)}`
    : historyBaseline
      ? `previous matching report from ${formatBaselineTime(historyBaseline.createdAt)}`
      : null;

  const saveWatch = async () => {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      setWatch(await saveObjectiveWatch(report));
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Could not save this objective watch.');
    } finally {
      setMutating(false);
    }
  };

  const stopWatch = async () => {
    if (!watch || mutating) return;
    setMutating(true);
    setError(null);
    try {
      await deleteObjectiveWatch(watch.id);
      setWatch(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Could not stop watching this objective.');
    } finally {
      setMutating(false);
    }
  };

  return (
    <section className="ssr-card objective-monitor-card" id="planner-section-monitor">
      <div className="ssr-card-h">
        <h2><span className="ssr-h-icon icon-blue"><BellRing size={16} /></span>Objective Watch</h2>
        <span className={`objective-watch-status ${watch ? 'active' : ''}`}>{watch ? 'Watching' : 'Not watched'}</span>
      </div>
      <div className="objective-monitor-body">
        <div className="objective-watch-pane">
          <div>
            <strong>{watch ? `${watch.title} has a saved baseline` : 'Track this exact objective'}</strong>
            <p>
              {watch
                ? 'New reports are compared with the baseline until you explicitly update it.'
                : 'Save the current report as a baseline, then generate this plan again to see material changes.'}
            </p>
          </div>
          {user ? (
            <div className="objective-watch-actions">
              <button type="button" onClick={saveWatch} disabled={mutating || readOnly}>
                {mutating ? <LoaderCircle className="objective-spin" size={14} /> : watch ? <RefreshCw size={14} /> : <BellRing size={14} />}
                {watch ? 'Update baseline' : 'Watch objective'}
              </button>
              {watch && (
                <button className="quiet" type="button" onClick={stopWatch} disabled={mutating || readOnly}>
                  <Trash2 size={14} /> Stop
                </button>
              )}
            </div>
          ) : (
            <p className="objective-account-note">Sign in to save a watch. Reports and Terrain Window remain available without an account.</p>
          )}
        </div>

        <div className={`report-change-pane ${comparison?.tone || 'neutral'}`}>
          <div className="report-change-head">
            <span className="report-change-icon" aria-hidden>
              {comparison?.tone === 'worse'
                ? <TrendingUp size={18} />
                : comparison?.tone === 'better'
                  ? <TrendingDown size={18} />
                  : <History size={18} />}
            </span>
            <div>
              <span>What changed?</span>
              <strong>{loading ? 'Loading prior conditions…' : comparison?.headline || 'No matching baseline yet'}</strong>
              {baselineLabel && <small>Compared with {baselineLabel}.</small>}
            </div>
          </div>
          {comparison && comparison.changes.length > 0 ? (
            <ul className="report-change-list">
              {comparison.changes.map((change) => (
                <li key={change.key} className={change.tone}>
                  {change.tone === 'better' ? <CheckCircle2 size={14} /> : change.tone === 'worse' ? <TrendingUp size={14} /> : <History size={14} />}
                  <span>{change.summary}</span>
                </li>
              ))}
            </ul>
          ) : !loading && (
            <p className="report-change-empty">
              {comparison
                ? 'The tracked values stayed within material-change thresholds. Always recheck the full report.'
                : user
                  ? activeSavedReportId ? 'Create another report for the same date, start time, and objective to establish change history.' : 'Saving this report to account history…'
                  : 'Sign in to compare future reports with this exact plan.'}
            </p>
          )}
        </div>
        {error && <p className="objective-monitor-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
