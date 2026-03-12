import type { DayOverDayComparison, SafetyData } from '../../../app/types';

export interface ScoreTraceCardProps {
  factors: SafetyData['safety']['factors'];
  dayOverDay: DayOverDayComparison | null;
}

export function ScoreTraceCard({ factors, dayOverDay }: ScoreTraceCardProps) {
  const sortedFactors = Array.isArray(factors) ? factors : [];
  return (
    <>
      {sortedFactors.length > 0 ? (
        <ul className="score-trace-list">
          {(() => {
            const sorted = sortedFactors
              .slice()
              .sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)));
            const dataGapKeywords = /unavailable|unknown|no data|coverage|data gap/i;
            const dataGapFactors = sorted.filter((f) => dataGapKeywords.test(f.hazard || '') || dataGapKeywords.test(f.message || ''));
            const nonGapFactors = sorted.filter((f) => !dataGapKeywords.test(f.hazard || '') && !dataGapKeywords.test(f.message || ''));
            const hasGap = dataGapFactors.length > 0;
            const topFactors = hasGap
              ? [...nonGapFactors.slice(0, 4), dataGapFactors[0]]
              : nonGapFactors.slice(0, 5);
            return topFactors;
          })().map((factor, idx) => (
            <li key={`${factor.hazard || 'factor'}-${idx}`}>
              <span className="score-trace-hazard">{factor.hazard || 'Factor'}</span>
              <span className={`score-trace-impact ${(factor.impact || 0) >= 0 ? 'down' : 'up'}`}>
                {(factor.impact || 0) >= 0 ? '-' : '+'}
                {Math.abs(Math.round(Number(factor.impact || 0)))}
              </span>
              <small>{factor.message || factor.source || 'No detail provided.'}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-note">No factor-level trace available for this report.</p>
      )}
      {dayOverDay && dayOverDay.changes.length > 0 && (
        <div className="score-change-block">
          <strong>What changed since {dayOverDay.previousDate}</strong>
          <ul className="signal-list compact">
            {dayOverDay.changes.map((change, idx) => (
              <li key={`${dayOverDay.previousDate}-change-${idx}`}>{change}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
