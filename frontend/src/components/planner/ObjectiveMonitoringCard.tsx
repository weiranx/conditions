import { useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, History, LoaderCircle, RefreshCw, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import type { PersistedReport } from '../../app/report-storage';
import { compareReports } from '../../app/report-changes';
import { useAccount } from '../../hooks/useAccount';
import {
  deleteObjectiveWatch,
  formatObjectiveWatchCadence,
  getObjectiveWatch,
  saveObjectiveWatch,
  type ObjectiveWatch,
  type ObjectiveWatchPolicy,
} from '../../lib/objective-watches';
import { getReportComparisonBaseline, type ReportComparisonBaseline } from '../../lib/saved-reports';

interface ObjectiveMonitoringCardProps {
  report: PersistedReport;
  activeSavedReportId: string | null;
  reportSource: 'live' | 'saved' | 'shared';
}

const formatBaselineTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'an earlier report'
    : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function ObjectiveMonitoringCard({ report, activeSavedReportId, reportSource }: ObjectiveMonitoringCardProps) {
  const { user } = useAccount();
  const [watch, setWatch] = useState<ObjectiveWatch | null>(null);
  const [policy, setPolicy] = useState<ObjectiveWatchPolicy | null>(null);
  const [historyBaseline, setHistoryBaseline] = useState<ReportComparisonBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setWatch(null);
      setPolicy(null);
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
      getObjectiveWatch(report.plan, controller.signal),
      historyRequest,
    ]).then(([watchResult, nextBaseline]) => {
      if (controller.signal.aborted) return;
      setWatch(watchResult.watch);
      setPolicy(watchResult.policy);
      setHistoryBaseline(nextBaseline);
    }).catch((loadError) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load monitoring history.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [activeSavedReportId, report, userId]);

  const baseline = watch?.baselineReport || historyBaseline?.snapshot || null;
  const comparison = useMemo(() => baseline ? compareReports(report, baseline) : null, [baseline, report]);
  const baselineLabel = watch?.baselineReport
    ? `watch baseline from ${formatBaselineTime(watch.baselineReport.savedAt || watch.createdAt)}`
    : historyBaseline
      ? `previous matching report from ${formatBaselineTime(historyBaseline.createdAt)}`
      : null;
  const createActionLabel = reportSource === 'shared'
    ? 'Watch a copy'
    : reportSource === 'saved'
      ? 'Watch this plan'
      : 'Watch objective';
  const monitoringDescription = policy === null
    ? 'Your account’s watch cadence will be applied when you save it.'
    : policy.automaticChecks
      ? `${policy.schedulerEnabled ? `Automatic checks run ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}` : `Automatic checks are currently paused; the configured cadence is ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}`}. Inside the final 48 hours, checks use the faster of hourly or that interval.`
      : 'Free includes one active watch with in-app history and manual refresh from the Watch dashboard.';
  const createDescription = reportSource === 'shared'
    ? `Create a private watch from this shared snapshot. The sender’s report stays unchanged. ${monitoringDescription}`
    : reportSource === 'saved'
      ? `Watch this saved plan without changing the historical report. ${monitoringDescription}`
      : `Save the current report as a baseline. ${monitoringDescription}`;
  const watchMonitoringStatus = !policy?.automaticChecks
    ? 'Manual refresh is available from the Watch dashboard'
    : !policy.schedulerEnabled
      ? `Automatic checks are paused; configured cadence is ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}`
      : watch?.nextCheckAt
        ? `Automatic checks are active · ${formatObjectiveWatchCadence(policy.checkIntervalMinutes)}`
        : 'Automatic checks have ended for this plan date';

  const saveWatch = async () => {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      const result = await saveObjectiveWatch(report);
      setWatch(result.watch);
      setPolicy(result.policy);
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
            <strong>{watch ? `${watch.title} has a saved baseline` : 'Track this exact plan'}</strong>
            <p>
              {watch
                ? `${watchMonitoringStatus}${watch.lastCheckedAt ? `; last checked ${formatBaselineTime(watch.lastCheckedAt)}` : ''}. New reports still compare with your saved baseline.`
                : createDescription}
            </p>
          </div>
          {user ? (
            <div className="objective-watch-actions">
              {(!watch || reportSource === 'live') && (
                <button type="button" onClick={saveWatch} disabled={mutating}>
                  {mutating ? <LoaderCircle className="objective-spin" size={14} /> : watch ? <RefreshCw size={14} /> : <BellRing size={14} />}
                  {watch ? 'Update baseline' : createActionLabel}
                </button>
              )}
              {watch && (
                <button className="quiet" type="button" onClick={stopWatch} disabled={mutating}>
                  <Trash2 size={14} /> Stop
                </button>
              )}
            </div>
          ) : (
            <p className="objective-account-note">
              {reportSource === 'shared'
                ? 'Sign in to watch a private copy. The shared report remains unchanged.'
                : 'Sign in to save a watch. Reports and Terrain Window remain available without an account.'}
            </p>
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
