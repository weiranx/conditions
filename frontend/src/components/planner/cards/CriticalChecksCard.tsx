import { CheckCircle2, XCircle } from 'lucide-react';
import type { SummitDecision } from '../../../app/types';

export interface CriticalChecksCardProps {
  orderedCriticalChecks: SummitDecision['checks'];
  topCriticalAttentionChecks: SummitDecision['checks'];
  criticalCheckFailCount: number;
  localizeUnitText: (text: string) => string;
  describeFailedCriticalCheck: (check: SummitDecision['checks'][number]) => string;
}

export function CriticalChecksCard({
  orderedCriticalChecks,
  topCriticalAttentionChecks,
  criticalCheckFailCount,
  localizeUnitText,
  describeFailedCriticalCheck,
}: CriticalChecksCardProps) {
  return (
    <>
      {topCriticalAttentionChecks.length > 0 && (
        <div className="checks-attention" role="status" aria-live="polite">
          <strong className="checks-attention-title">Needs attention now</strong>
          <ul className="checks-attention-list">
            {topCriticalAttentionChecks.map((check, idx) => (
              <li key={`${check.key || check.label}-${idx}`}>
                <span className="checks-attention-label">{localizeUnitText(describeFailedCriticalCheck(check))}</span>
                <small>
                  {localizeUnitText(
                    [check.detail, check.action].filter(Boolean).join(' \u2022 ') || 'Review this signal before departure.',
                  )}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="checks-summary">
        <span className={`checks-summary-pill ${criticalCheckFailCount === 0 ? 'go' : 'caution'}`}>
          {criticalCheckFailCount === 0 ? 'Ready' : `${criticalCheckFailCount} attention`}
        </span>
        <span className="checks-summary-text">
          {criticalCheckFailCount === 0 ? 'All critical checks are currently passing.' : 'Address failing checks before departure.'}
        </span>
      </div>
      <div className="checks-list">
        {orderedCriticalChecks.map((check, idx) => (
          <div key={idx} className={`check-item ${check.ok ? 'ok' : 'warn'}`}>
            <div className="check-item-main">
              <div className="check-item-label">
                {check.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{check.label}</span>
              </div>
              {check.detail && <small className="check-item-detail">{localizeUnitText(check.detail)}</small>}
              {!check.ok && check.action && <small className="check-item-action">{localizeUnitText(check.action)}</small>}
            </div>
            <span className={`check-item-status ${check.ok ? 'ok' : 'warn'}`}>{check.ok ? 'PASS' : 'FAIL'}</span>
          </div>
        ))}
      </div>
    </>
  );
}
