import { CloudRain, Mountain } from 'lucide-react';

export interface RainfallCardProps {
  precipInsightLine: string;
  expectedPrecipSummaryLine: string;
  rainfall12hDisplay: string;
  rainfall24hDisplay: string;
  rainfall48hDisplay: string;
  snowfall12hDisplay: string;
  snowfall24hDisplay: string;
  snowfall48hDisplay: string;
  expectedTravelWindowHours: number;
  expectedRainWindowDisplay: string;
  expectedSnowWindowDisplay: string;
  rainfallExpectedStartTime: string | null | undefined;
  rainfallExpectedEndTime: string | null | undefined;
  precipitationDisplayTimezone: string | null;
  expectedPrecipNoteLine: string;
  rainfallModeLabel: string;
  rainfallAnchorTime: string | null | undefined;
  rainfallNoteLine: string;
  safeRainfallLink: string | null;
  rainfallSourceLabel: string;
  formatForecastPeriodLabel: (isoString?: string | null, timeZone?: string | null) => string;
}

export function RainfallCard({
  precipInsightLine,
  expectedPrecipSummaryLine,
  rainfall12hDisplay,
  rainfall24hDisplay,
  rainfall48hDisplay,
  snowfall12hDisplay,
  snowfall24hDisplay,
  snowfall48hDisplay,
  expectedTravelWindowHours,
  expectedRainWindowDisplay,
  expectedSnowWindowDisplay,
  rainfallExpectedStartTime,
  rainfallExpectedEndTime,
  precipitationDisplayTimezone,
  expectedPrecipNoteLine,
  rainfallModeLabel,
  rainfallAnchorTime,
  rainfallNoteLine,
  safeRainfallLink,
  rainfallSourceLabel,
  formatForecastPeriodLabel,
}: RainfallCardProps) {
  return (
    <>
      <p className="precip-insight-line">{precipInsightLine}</p>
      <p className="precip-insight-line expected">{expectedPrecipSummaryLine}</p>
      <div className="precip-split-grid">
        <section className="precip-column rain">
          <div className="precip-column-head">
            <CloudRain size={14} />
            <span>Rain</span>
          </div>
          <ul className="precip-metric-list">
            <li>
              <span className="precip-metric-label">Past 12h</span>
              <strong>{rainfall12hDisplay}</strong>
            </li>
            <li className="precip-metric-highlight">
              <span className="precip-metric-label">Past 24h</span>
              <strong>{rainfall24hDisplay}</strong>
            </li>
            <li>
              <span className="precip-metric-label">Past 48h</span>
              <strong>{rainfall48hDisplay}</strong>
            </li>
          </ul>
        </section>
        <section className="precip-column snow">
          <div className="precip-column-head">
            <Mountain size={14} />
            <span>Snow</span>
          </div>
          <ul className="precip-metric-list">
            <li>
              <span className="precip-metric-label">Past 12h</span>
              <strong>{snowfall12hDisplay}</strong>
            </li>
            <li className="precip-metric-highlight">
              <span className="precip-metric-label">Past 24h</span>
              <strong>{snowfall24hDisplay}</strong>
            </li>
            <li>
              <span className="precip-metric-label">Past 48h</span>
              <strong>{snowfall48hDisplay}</strong>
            </li>
          </ul>
        </section>
      </div>
      <div className="precip-expected-block">
        <div className="precip-expected-title">
          <span>Expected Precipitation (Travel Window)</span>
          <strong>{expectedTravelWindowHours}h</strong>
        </div>
        <div className="precip-split-grid">
          <section className="precip-column rain">
            <div className="precip-column-head">
              <CloudRain size={14} />
              <span>Rain</span>
            </div>
            <ul className="precip-metric-list">
              <li className="precip-metric-highlight">
                <span className="precip-metric-label">Next {expectedTravelWindowHours}h</span>
                <strong>{expectedRainWindowDisplay}</strong>
              </li>
            </ul>
          </section>
          <section className="precip-column snow">
            <div className="precip-column-head">
              <Mountain size={14} />
              <span>Snow</span>
            </div>
            <ul className="precip-metric-list">
              <li className="precip-metric-highlight">
                <span className="precip-metric-label">Next {expectedTravelWindowHours}h</span>
                <strong>{expectedSnowWindowDisplay}</strong>
              </li>
            </ul>
          </section>
        </div>
        <div className="precip-meta-grid">
          <div>
            <span className="stat-label">Forecast start</span>
            <strong>
              {rainfallExpectedStartTime
                ? formatForecastPeriodLabel(rainfallExpectedStartTime, precipitationDisplayTimezone)
                : 'N/A'}
            </strong>
          </div>
          <div>
            <span className="stat-label">Forecast end</span>
            <strong>
              {rainfallExpectedEndTime
                ? formatForecastPeriodLabel(rainfallExpectedEndTime, precipitationDisplayTimezone)
                : 'N/A'}
            </strong>
          </div>
        </div>
        {precipitationDisplayTimezone && <p className="muted-note">Times shown in objective timezone: {precipitationDisplayTimezone}</p>}
        <p className="muted-note">{expectedPrecipNoteLine}</p>
      </div>
      <div className="precip-meta-grid">
        <div>
          <span className="stat-label">Window mode</span>
          <strong>{rainfallModeLabel}</strong>
        </div>
        <div>
          <span className="stat-label">Anchor time</span>
          <strong>
            {rainfallAnchorTime
              ? formatForecastPeriodLabel(rainfallAnchorTime, precipitationDisplayTimezone)
              : 'N/A'}
          </strong>
        </div>
      </div>
      <p className="muted-note">
        {rainfallNoteLine}
      </p>
      <p className="muted-note">
        Source:{' '}
        {safeRainfallLink ? (
          <a href={safeRainfallLink} target="_blank" rel="noreferrer" className="raw-link-value">
            {rainfallSourceLabel}
          </a>
        ) : (
          rainfallSourceLabel
        )}
      </p>
    </>
  );
}
