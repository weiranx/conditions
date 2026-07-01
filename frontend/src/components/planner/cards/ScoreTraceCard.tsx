import type { DayOverDayComparison, SafetyData } from '../../../app/types';

export interface ScoreTraceCardProps {
  factors: SafetyData['safety']['factors'];
  groupImpacts: SafetyData['safety']['groupImpacts'];
  dayOverDay: DayOverDayComparison | null;
}

const GROUP_LABELS: Record<string, string> = {
  avalanche: 'Avalanche',
  weather: 'Weather',
  alerts: 'Alerts',
  airQuality: 'Air Quality',
  fire: 'Fire',
};

function GroupImpactBreakdown({ groupImpacts }: { groupImpacts: SafetyData['safety']['groupImpacts'] }) {
  const groups = groupImpacts
    ? Object.entries(groupImpacts)
        .map(([key, value]) => ({
          key,
          label: GROUP_LABELS[key] || key,
          effective: Math.round(Number(value?.effective || 0)),
          scale: Math.round(Number(value?.scale || 0)),
        }))
        .filter((g) => g.effective > 0 && g.scale > 0)
        .sort((a, b) => b.effective - a.effective)
    : [];

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="score-group-breakdown">
      <strong>Hazard group contribution</strong>
      <ul className="score-trace-list compact">
        {groups.map((g) => (
          <li key={g.key}>
            <span className="score-trace-hazard">{g.label}</span>
            <span className="score-trace-impact down">
              -{g.effective} <small>of {g.scale}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScoreTraceCard({ factors, groupImpacts, dayOverDay }: ScoreTraceCardProps) {
  const sortedFactors = Array.isArray(factors) ? factors : [];
  return (
    <>
      <GroupImpactBreakdown groupImpacts={groupImpacts} />
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
