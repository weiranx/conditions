import type { TimeStyle } from '../../../app/types';
import { formatClockForStyle } from '../../../app/core';
import { formatClockShort } from '../../../app/weather-display';

export interface PlanSnapshotCardProps {
  sunriseMinutesForPlan: number | null;
  sunsetMinutesForPlan: number | null;
  startMinutesForPlan: number | null;
  returnMinutes: number | null;
  displayStartTime: string;
  startLabel: string;
  daylightRemainingFromStartLabel: string;
  returnTimeFormatted: string | null;
  sunriseValue: string;
  sunsetValue: string;
  timeStyle: TimeStyle;
}

export function PlanSnapshotCard({
  sunriseMinutesForPlan,
  sunsetMinutesForPlan,
  startMinutesForPlan,
  returnMinutes,
  displayStartTime,
  startLabel,
  daylightRemainingFromStartLabel,
  returnTimeFormatted,
  sunriseValue,
  sunsetValue,
  timeStyle,
}: PlanSnapshotCardProps) {
  return (
    <>
      {/* Solar day-arc timeline */}
      {sunriseMinutesForPlan !== null && sunsetMinutesForPlan !== null && (() => {
        const WING = 90;
        const winMin = Math.max(0, sunriseMinutesForPlan - WING);
        const winMax = Math.min(1440, sunsetMinutesForPlan + WING);
        const span = winMax - winMin;
        const p = (m: number) => parseFloat(Math.max(0, Math.min(100, (m - winMin) / span * 100)).toFixed(2));
        const srP = p(sunriseMinutesForPlan);
        const ssP = p(sunsetMinutesForPlan);
        const stP = startMinutesForPlan !== null ? p(startMinutesForPlan) : null;
        const ttMin = returnMinutes;
        const ttP = ttMin !== null ? p(ttMin) : null;
        const ttMargin = ttMin !== null ? sunsetMinutesForPlan - ttMin : null;
        const ttPinColor = ttMargin === null ? 'rgba(255,255,255,0.9)' : ttMargin < 0 ? '#f87171' : ttMargin < 30 ? '#fbbf24' : '#4ade80';
        const stops = [
          `#0f172a 0%`, `#0f172a ${srP}%`,
          `#f97316 ${srP}%`, `#fde68a ${Math.min(srP + 8, 50)}%`,
          `#7dd3fc ${Math.min(srP + 18, 48)}%`, `#60a5fa 50%`,
          `#93c5fd ${Math.max(ssP - 18, 52)}%`, `#fed7aa ${Math.max(ssP - 8, 50)}%`,
          `#f97316 ${ssP}%`, `#0f172a ${ssP}%`, `#0f172a 100%`,
        ].join(', ');
        return (
          <div className="solar-timeline">
            <div className="solar-timeline-bar" style={{ background: `linear-gradient(to right, ${stops})` }}>
              <span className="solar-tick" style={{ left: `${srP}%` }} aria-hidden="true" />
              <span className="solar-tick" style={{ left: `${ssP}%` }} aria-hidden="true" />
              {stP !== null && (
                <span className="solar-pin" style={{ left: `${stP}%`, background: 'rgba(255,255,255,0.95)' }} title={`Start: ${displayStartTime}`} />
              )}
              {ttP !== null && (
                <span className="solar-pin" style={{ left: `${ttP}%`, background: ttPinColor }} title={`Return: ${returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, timeStyle) : ''}`} />
              )}
            </div>
            <div className="solar-timeline-footer">
              <span>&uarr; {formatClockShort(sunriseValue, timeStyle)} sunrise</span>
              <span>sunset {formatClockShort(sunsetValue, timeStyle)} &darr;</span>
            </div>
            <div className="solar-timeline-legend">
              {stP !== null && <span className="solar-legend-item"><span className="solar-legend-dot" style={{ background: 'rgba(255,255,255,0.95)' }} />Start</span>}
              {ttP !== null && <span className="solar-legend-item"><span className="solar-legend-dot" style={{ background: ttPinColor }} />Return</span>}
            </div>
          </div>
        );
      })()}
      <div className="plan-summary-grid">
        <article className="plan-summary-item">
          <span className="plan-label">{startLabel}</span>
          <strong className="plan-value">{displayStartTime}</strong>
        </article>
        <article className="plan-summary-item">
          <span className="plan-label">Daylight from start</span>
          <strong className="plan-value">{daylightRemainingFromStartLabel}</strong>
        </article>
        {returnTimeFormatted && (
          <article className="plan-summary-item">
            <span className="plan-label">Return by</span>
            <strong className="plan-value">{formatClockForStyle(returnTimeFormatted, timeStyle)}</strong>
          </article>
        )}
        {returnMinutes !== null && sunsetMinutesForPlan !== null && (() => {
          const margin = sunsetMinutesForPlan - returnMinutes;
          const cls = margin < 0 ? 'plan-value danger' : margin < 30 ? 'plan-value caution' : 'plan-value';
          const abs = Math.abs(margin);
          const timePart = abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
          const label = margin < 0
            ? `${timePart} after sunset`
            : `${timePart} before sunset`;
          return (
            <article className="plan-summary-item">
              <span className="plan-label">Sunset margin</span>
              <strong className={cls}>{label}</strong>
            </article>
          );
        })()}
      </div>
    </>
  );
}
