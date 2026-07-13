import React from 'react';
import type { PastPlannedStart } from '../../app/planned-start';
import { formatTimeZoneLabel, getPastPlannedStart } from '../../app/planned-start';
import '../../styles/past-start-notice.css';

interface PastStartActions {
  onUseNow: () => void;
  onUseTomorrow: () => void;
  tomorrowTimeLabel: string;
}

interface PastStartPromptProps extends PastStartActions {
  prompt: PastPlannedStart | null;
  onDismiss: () => void;
}

export function PastStartPrompt({
  prompt,
  onDismiss,
  onUseNow,
  onUseTomorrow,
  tomorrowTimeLabel,
}: PastStartPromptProps) {
  if (!prompt) return null;

  return (
    <div className="past-start-dialog-backdrop" role="presentation">
      <section
        className="past-start-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="past-start-dialog-title"
        aria-describedby="past-start-dialog-description"
      >
        <span className="past-start-eyebrow">Report day needs attention</span>
        <h2 id="past-start-dialog-title">That report day has passed</h2>
        <p id="past-start-dialog-description">
          {prompt.date} is earlier than today in {formatTimeZoneLabel(prompt.timeZone)}.
          Choose today or a future day before generating a report.
        </p>
        <div className="past-start-actions">
          <button type="button" className="past-start-action-primary" onClick={onUseNow} autoFocus>
            Use current time
          </button>
          <button type="button" className="past-start-action-secondary" onClick={onUseTomorrow}>
            Tomorrow at {tomorrowTimeLabel}
          </button>
          <button type="button" className="past-start-action-link" onClick={onDismiss}>
            Keep editing
          </button>
        </div>
      </section>
    </div>
  );
}

interface PassedReportNoticeProps extends PastStartActions {
  date: string;
  time: string;
  timeZone: string | null;
  hidden?: boolean;
}

export function PassedReportNotice({
  date,
  time,
  timeZone,
  hidden = false,
  onUseNow,
  onUseTomorrow,
  tomorrowTimeLabel,
}: PassedReportNoticeProps) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasPassed = Boolean(getPastPlannedStart(date, time, timeZone, now));
  if (hidden || !hasPassed) return null;

  return (
    <section className="passed-report-notice" role="status" aria-live="polite">
      <div>
        <strong>This report is from an earlier day.</strong>
        <span>Create a new report before relying on current conditions.</span>
      </div>
      <div className="passed-report-actions">
        <button type="button" onClick={onUseNow}>Use current time</button>
        <button type="button" onClick={onUseTomorrow}>Tomorrow at {tomorrowTimeLabel}</button>
      </div>
    </section>
  );
}
