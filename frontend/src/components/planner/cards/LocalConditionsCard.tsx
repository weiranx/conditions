import type { SafetyData } from '../../../app/types';

type LocalConditions = NonNullable<SafetyData['localConditions']>;

export interface LocalConditionsCardProps {
  localConditions: LocalConditions;
  formatPubTime: (isoString?: string) => string;
  localizeUnitText: (text: string) => string;
}

const isFinite = (value: unknown): value is number => Number.isFinite(Number(value));

const trendLabel: Record<string, string> = {
  rising: '▲ Rising',
  falling: '▼ Falling',
  steady: '▬ Steady',
  unknown: 'Trend N/A',
};

const distanceLabel = (km: number | null | undefined): string =>
  isFinite(km) ? `${(Number(km) * 0.621371).toFixed(1)} mi away` : '';

export function LocalConditionsCard({
  localConditions,
  formatPubTime,
  localizeUnitText,
}: LocalConditionsCardProps) {
  const { streamflow, smoke, tides, closures } = localConditions;

  return (
    <div className="local-conditions">
      {smoke?.available && (
        <section className="local-conditions-section">
          <h4 className="local-conditions-heading">Smoke / PM2.5 Outlook</h4>
          <div className="plan-grid">
            <div>
              <span className="stat-label">Now</span>
              <strong>{isFinite(smoke.currentPm25) ? `${smoke.currentPm25} µg/m³` : 'N/A'}</strong>
              {smoke.currentCategory && <small>{smoke.currentCategory}</small>}
            </div>
            <div>
              <span className="stat-label">Peak (next {smoke.horizonHours ?? 24}h)</span>
              <strong>{isFinite(smoke.peakPm25) ? `${smoke.peakPm25} µg/m³` : 'N/A'}</strong>
              {smoke.peakCategory && <small>{smoke.peakCategory}</small>}
            </div>
            {smoke.peakTimeIso && (
              <div>
                <span className="stat-label">Peak Time</span>
                <strong>{formatPubTime(smoke.peakTimeIso)}</strong>
              </div>
            )}
          </div>
          <p className="muted-note">Source: {smoke.source}</p>
        </section>
      )}

      {streamflow?.available && (
        <section className="local-conditions-section">
          <h4 className="local-conditions-heading">River / Streamflow</h4>
          <div className="plan-grid">
            <div>
              <span className="stat-label">Discharge</span>
              <strong>{isFinite(streamflow.dischargeCfs) ? `${Math.round(Number(streamflow.dischargeCfs)).toLocaleString()} cfs` : 'N/A'}</strong>
            </div>
            <div>
              <span className="stat-label">Gage Height</span>
              <strong>{isFinite(streamflow.gageHeightFt) ? `${streamflow.gageHeightFt} ft` : 'N/A'}</strong>
            </div>
            <div>
              <span className="stat-label">48h Trend</span>
              <strong>{trendLabel[streamflow.trend || 'unknown']}</strong>
            </div>
          </div>
          <p className="muted-note">
            {streamflow.siteName ? `${streamflow.siteName} · ` : ''}{distanceLabel(streamflow.distanceKm)}
            {streamflow.observedTime ? ` · observed ${formatPubTime(streamflow.observedTime)}` : ''} · Source: {streamflow.source}
          </p>
        </section>
      )}

      {tides?.available && (
        <section className="local-conditions-section">
          <h4 className="local-conditions-heading">Tides</h4>
          <div className="plan-grid">
            <div>
              <span className="stat-label">Now</span>
              <strong>{tides.direction === 'rising' ? '▲ Incoming' : tides.direction === 'falling' ? '▼ Outgoing' : 'N/A'}</strong>
            </div>
            {tides.nextHigh && (
              <div>
                <span className="stat-label">Next High</span>
                <strong>{isFinite(tides.nextHigh.heightFt) ? `${tides.nextHigh.heightFt} ft` : 'High'}</strong>
                {tides.nextHigh.rawTime && <small>{tides.nextHigh.rawTime.slice(11, 16)}</small>}
              </div>
            )}
            {tides.nextLow && (
              <div>
                <span className="stat-label">Next Low</span>
                <strong>{isFinite(tides.nextLow.heightFt) ? `${tides.nextLow.heightFt} ft` : 'Low'}</strong>
                {tides.nextLow.rawTime && <small>{tides.nextLow.rawTime.slice(11, 16)}</small>}
              </div>
            )}
          </div>
          <p className="muted-note">
            {tides.stationName ? `${tides.stationName} · ` : ''}{distanceLabel(tides.distanceKm)} · Source: {tides.source}
          </p>
        </section>
      )}

      {closures?.available && (
        <section className="local-conditions-section">
          <h4 className="local-conditions-heading">Access &amp; Closures{closures.parkName ? ` — ${closures.parkName}` : ''}</h4>
          {closures.alerts && closures.alerts.length > 0 ? (
            <ul className="signal-list compact">
              {closures.alerts.map((alert, idx) => (
                <li key={`closure-${idx}`}>
                  {alert.category ? <strong>{alert.category}: </strong> : null}
                  {alert.url ? (
                    <a href={alert.url} target="_blank" rel="noreferrer">{localizeUnitText(alert.title || 'Alert')}</a>
                  ) : (
                    localizeUnitText(alert.title || 'Alert')
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-note">No active closures or alerts reported for the nearest park.</p>
          )}
          <p className="muted-note">{distanceLabel(closures.distanceKm)} · Source: {closures.source}</p>
        </section>
      )}
    </div>
  );
}
