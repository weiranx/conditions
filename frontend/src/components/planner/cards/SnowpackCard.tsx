import type { SnowpackSnapshotInsights, SnowpackInterpretation } from '../../../app/types';
import { HelpHint } from '../CardHelpHint';

export interface SnowpackCardProps {
  snowpackInsights: SnowpackSnapshotInsights | null;
  snotelStationName: string | null | undefined;
  snotelDistanceDisplay: string;
  snotelDepthDisplay: string;
  snotelSweDisplay: string;
  snotelObservedDate: string | null | undefined;
  nohrscDepthDisplay: string;
  nohrscSweDisplay: string;
  nohrscSampledTime: string | null | undefined;
  cdec: {
    stationName?: string | null;
    stationCode?: string | null;
    observedDate?: string | null;
  } | null | undefined;
  cdecDepthDisplay: string;
  cdecSweDisplay: string;
  cdecDistanceDisplay: string;
  rainfall24hDisplay: string;
  snowfall24hDisplay: string;
  snowpackHistoricalStatusLabel: string;
  snowpackHistoricalPillClass: string;
  snowpackHistoricalComparisonLine: string;
  snowpackInterpretation: SnowpackInterpretation | null;
  snowpackSummary: string | null | undefined;
  snowpackTakeaways: string[];
  snowfallWindowSummary: string;
  rainfallWindowSummary: string;
  snowpackObservationContext: string;
  safeSnotelLink: string | null;
  safeNohrscLink: string | null;
  safeCdecLink: string | null;
  weatherTimezone: string | null;
  localizeUnitText: (text: string) => string;
  formatForecastPeriodLabel: (isoString?: string | null, timeZone?: string | null) => string;
}

export function SnowpackCard({
  snowpackInsights,
  snotelStationName,
  snotelDistanceDisplay,
  snotelDepthDisplay,
  snotelSweDisplay,
  snotelObservedDate,
  nohrscDepthDisplay,
  nohrscSweDisplay,
  nohrscSampledTime,
  cdec,
  cdecDepthDisplay,
  cdecSweDisplay,
  cdecDistanceDisplay,
  rainfall24hDisplay,
  snowfall24hDisplay,
  snowpackHistoricalStatusLabel,
  snowpackHistoricalPillClass,
  snowpackHistoricalComparisonLine,
  snowpackInterpretation,
  snowpackSummary,
  snowpackTakeaways,
  snowfallWindowSummary,
  rainfallWindowSummary,
  snowpackObservationContext,
  safeSnotelLink,
  safeNohrscLink,
  safeCdecLink,
  weatherTimezone,
  localizeUnitText,
  formatForecastPeriodLabel,
}: SnowpackCardProps) {
  return (
    <>
      {snowpackInsights && (
        <div className="snowpack-insight-grid snowpack-insight-grid-compact">
          <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.signal.tone}`}>
            <span className="stat-label">Signal</span>
            <strong>{snowpackInsights.signal.label}</strong>
            <small>{snowpackInsights.signal.detail}</small>
          </div>
          <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.freshness.tone}`}>
            <span className="stat-label">Freshness</span>
            <strong>{snowpackInsights.freshness.label}</strong>
            <small>{snowpackInsights.freshness.detail}</small>
          </div>
        </div>
      )}

      <div className="snowpack-core-grid">
        <div className="snowpack-core-item">
          <span className="stat-label stat-label-with-help">
            Nearest SNOTEL
            <HelpHint text="Closest USDA NRCS snow station to your objective. Station observations are used as local snowpack ground truth." />
          </span>
          <strong>{snotelStationName || 'Unavailable'}</strong>
          <small>{snotelDistanceDisplay !== 'N/A' ? `${snotelDistanceDisplay} from objective` : 'Distance unavailable'}</small>
        </div>
        <div className="snowpack-core-item">
          <span className="stat-label stat-label-with-help">SNOTEL Station Snow <HelpHint text="SNOTEL (Snow Telemetry): automated USDA stations measuring snow depth and snow water equivalent (SWE) in real time." /></span>
          <strong>Depth {snotelDepthDisplay} &bull; SWE {snotelSweDisplay}</strong>
          <small>{snotelObservedDate ? `Observed ${snotelObservedDate}` : 'Observation date unavailable'}</small>
        </div>
        <div className="snowpack-core-item">
          <span className="stat-label stat-label-with-help">NOHRSC Grid Snow <HelpHint text="NOHRSC (National Operational Hydrologic Remote Sensing Center): NOAA-modeled gridded snow estimates for any location." /></span>
          <strong>Depth {nohrscDepthDisplay} &bull; SWE {nohrscSweDisplay}</strong>
          <small>
            {nohrscSampledTime
              ? `Sampled ${formatForecastPeriodLabel(nohrscSampledTime, weatherTimezone)}`
              : 'Sample time unavailable'}
          </small>
        </div>
        {cdec && (
          <div className="snowpack-core-item">
            <span className="stat-label stat-label-with-help">CDEC Station Snow <HelpHint text="CDEC (California Data Exchange Center): DWR-operated snow monitoring stations, primarily in the Sierra Nevada." /></span>
            <strong>Depth {cdecDepthDisplay} &bull; SWE {cdecSweDisplay}</strong>
            <small>
              {cdec.stationName || 'CDEC station'}
              {cdecDistanceDisplay !== 'N/A' ? ` \u2022 ${cdecDistanceDisplay} away` : ''}
              {cdec.observedDate ? ` \u2022 Observed ${cdec.observedDate}` : ''}
            </small>
          </div>
        )}
        <div className="snowpack-core-item">
          <span className="stat-label">Recent 24h</span>
          <strong>Rain {rainfall24hDisplay} &bull; Snow {snowfall24hDisplay}</strong>
          <small>Use this for fresh loading context.</small>
        </div>
        <div className="snowpack-core-item">
          <span className="stat-label">Historical Baseline</span>
          <strong className={`snowpack-historical-status ${snowpackHistoricalPillClass}`}>{snowpackHistoricalStatusLabel}</strong>
          <small>{snowpackHistoricalComparisonLine}</small>
        </div>
      </div>

      <p className="muted-note">
        {snowpackInterpretation?.headline
          ? localizeUnitText(snowpackInterpretation.headline)
          : localizeUnitText(snowpackSummary || 'Snowpack observations unavailable.')}
      </p>

      <details className="snowpack-details">
        <summary>More snowpack details</summary>

        {snowpackInsights && (
          <div className="snowpack-insight-grid">
            <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.representativeness.tone}`}>
              <span className="stat-label">Representativeness</span>
              <strong>{snowpackInsights.representativeness.label}</strong>
              <small>{snowpackInsights.representativeness.detail}</small>
            </div>
            <div className={`snowpack-insight-item snowpack-insight-${snowpackInsights.agreement.tone}`}>
              <span className="stat-label">Agreement</span>
              <strong>{snowpackInsights.agreement.label}</strong>
              <small>{snowpackInsights.agreement.detail}</small>
            </div>
          </div>
        )}

        {snowpackInterpretation && snowpackInterpretation.bullets.length > 0 && (
          <div className={`snowpack-read snowpack-read-${snowpackInterpretation.confidence}`}>
            <span className="snowpack-takeaway-title">Interpretation notes</span>
            <ul className="signal-list compact">
              {snowpackInterpretation.bullets.map((item, idx) => (
                <li key={`snowpack-read-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {snowpackTakeaways.length > 0 && (
          <div className="snowpack-takeaways">
            <span className="snowpack-takeaway-title">How To Use This Snapshot</span>
            <ul className="signal-list compact">
              {snowpackTakeaways.map((item, idx) => (
                <li key={`snowpack-takeaway-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="plan-grid">
          <div>
            <span className="stat-label">Recent Snowfall (12h/24h/48h)</span>
            <strong>{snowfallWindowSummary}</strong>
          </div>
          <div>
            <span className="stat-label">Recent Rainfall (12h/24h/48h)</span>
            <strong>{rainfallWindowSummary}</strong>
          </div>
        </div>

        <p className="muted-note">
          {snowpackObservationContext}
        </p>
        <p className="muted-note">
          Data snapshot: {localizeUnitText(snowpackSummary || 'Snowpack observations unavailable.')}
        </p>
        <p className="muted-note">
          Sources:{' '}
          {safeSnotelLink ? (
            <>
              <a href={safeSnotelLink} target="_blank" rel="noreferrer" className="raw-link-value">
                NRCS AWDB / SNOTEL
              </a>
              {' \u2022 '}
            </>
          ) : (
            'NRCS AWDB / SNOTEL \u2022 '
          )}
          {safeNohrscLink ? (
            <a href={safeNohrscLink} target="_blank" rel="noreferrer" className="raw-link-value">
              NOAA NOHRSC Snow Analysis
            </a>
          ) : (
            'NOAA NOHRSC Snow Analysis'
          )}
          {cdec && (
            <>
              {' \u2022 '}
              {safeCdecLink ? (
                <a href={safeCdecLink} target="_blank" rel="noreferrer" className="raw-link-value">
                  CDEC ({cdec.stationCode})
                </a>
              ) : (
                `CDEC (${cdec.stationCode || 'N/A'})`
              )}
            </>
          )}
        </p>
      </details>
    </>
  );
}
