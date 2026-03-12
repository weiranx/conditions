import { formatAgeFromNow, freshnessClass } from '../../../app/core';

export interface SourceFreshnessRow {
  label: string;
  issued: string | null;
  staleHours: number;
  displayValue?: string;
  stateOverride?: 'fresh' | 'aging' | 'ok' | 'stale' | 'missing';
}

export interface SourceFreshnessCardProps {
  sourceFreshnessRows: SourceFreshnessRow[];
  reportGeneratedAt: string | null;
  avalancheExpiredForSelectedStart: boolean;
  objectiveTimezone: string | null;
  deviceTimezone: string | null;
  formatPubTime: (isoString?: string) => string;
}

export function SourceFreshnessCard({
  sourceFreshnessRows,
  reportGeneratedAt,
  avalancheExpiredForSelectedStart,
  objectiveTimezone,
  deviceTimezone,
  formatPubTime,
}: SourceFreshnessCardProps) {
  return (
    <>
      <ul className="source-freshness-list">
        {sourceFreshnessRows.map((row) => {
          const state = row.stateOverride || freshnessClass(row.issued, row.staleHours);
          return (
            <li key={row.label}>
              <span>{row.label}</span>
              <strong className={`freshness-pill ${state}`}>{row.displayValue || formatAgeFromNow(row.issued)}</strong>
            </li>
          );
        })}
      </ul>
      {reportGeneratedAt && <p className="muted-note">Report generated: {formatPubTime(reportGeneratedAt)}</p>}
      <p className="muted-note">Freshness badges use upstream publish/observation times when available.</p>
      {avalancheExpiredForSelectedStart && (
        <p className="muted-note">
          Avalanche bulletin expires before your selected start time. Report is shown as stale guidance; verify the latest update before departure.
        </p>
      )}
      {objectiveTimezone && (
        <p className="muted-note">
          Objective timezone: {objectiveTimezone}
          {deviceTimezone ? ` \u2022 Device: ${deviceTimezone}` : ''}
        </p>
      )}
    </>
  );
}
