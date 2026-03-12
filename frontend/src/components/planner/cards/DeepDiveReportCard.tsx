import { Search } from 'lucide-react';
import { HelpHint } from '../CardHelpHint';
import { sanitizeExternalUrl } from '../../../app/url-state';
import type { SummitDecision } from '../../../app/types';

interface FireAlert {
  event?: string;
  severity?: string;
  link?: string;
}

export interface DeepDiveReportCardProps {
  order: number;
  objectiveName: string;
  positionLat: number;
  positionLng: number;
  forecastDate: string;
  selectedDate: string | null | undefined;
  displayStartTime: string;
  safeShareLink: string | null;
  weatherIssuedTime: string | null | undefined;
  weatherForecastStartTime: string | null | undefined;
  weatherForecastEndTime: string | null | undefined;
  weatherTimezone: string | null;
  weatherHumidity: number | null | undefined;
  weatherDewPoint: number | null | undefined;
  weatherCloudCover: number | null;
  rainfall12hDisplay: string;
  rainfall24hDisplay: string;
  rainfall48hDisplay: string;
  snowfall12hDisplay: string;
  snowfall24hDisplay: string;
  snowfall48hDisplay: string;
  safeWeatherLink: string | null;
  weatherSourceDisplay: string;
  weatherBlended: boolean;
  weatherFieldSources: Record<string, string>;
  weatherElevation: number | null | undefined;
  weatherElevationSource: string | null | undefined;
  weatherElevationForecastNote: string | null | undefined;
  elevationForecastBands: Array<{ label: string; elevationFt: number; deltaFromObjectiveFt: number; temp: number; feelsLike: number; windSpeed: number; windGust: number }>;
  avalancheCenter: string | null | undefined;
  avalancheZone: string | null | undefined;
  avalanchePublishedTime: string | null | undefined;
  avalancheExpiresTime: string | null | undefined;
  avalancheUnknown: boolean;
  avalancheDangerLevel: number | null | undefined;
  avalancheCoverageStatus: string | null | undefined;
  avalancheDangerUnknown: boolean | null | undefined;
  avalancheProblemsCount: number;
  safeAvalancheLink: string | null;
  alertsActiveCount: number;
  alertsHighestSeverity: string | null | undefined;
  alerts: Array<{ event?: string; severity?: string; urgency?: string; link?: string | null }>;
  usAqi: number | null | undefined;
  aqiCategory: string | null | undefined;
  heatRiskLabel: string;
  heatRiskLevel: number | null | undefined;
  heatRiskGuidance: string;
  fireRiskLabel: string | null | undefined;
  fireRiskLevel: number | null | undefined;
  fireRiskGuidance: string | null | undefined;
  fireRiskAlerts: FireAlert[];
  pm25: number | null | undefined;
  aqiMeasuredTime: string | null | undefined;
  snowpackSummary: string | null | undefined;
  snotelStationName: string | null | undefined;
  snotelDistanceDisplay: string;
  snotelSweDisplay: string;
  snotelDepthDisplay: string;
  nohrscSweDisplay: string;
  nohrscDepthDisplay: string;
  cdec: { sweIn?: number | null; snowDepthIn?: number | null; stationName?: string | null; stationCode?: string | null } | null | undefined;
  cdecSweDisplay: string;
  cdecDepthDisplay: string;
  safeSnotelLink: string | null;
  safeNohrscLink: string | null;
  safeCdecLink: string | null;
  safetyScore: number;
  safetyConfidence: number | null | undefined;
  primaryHazard: string | null | undefined;
  decision: SummitDecision;
  factorsCount: number;
  groupImpactsCount: number;
  sourcesUsed: string[];
  satelliteConditionLineLength: number;
  rawReportPayload: string;
  copiedRawPayload: boolean;
  handleCopyRawPayload: () => void;
  formatPubTime: (isoString?: string) => string;
  formatForecastPeriodLabel: (isoString?: string | null, timeZone?: string | null) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDeltaDisplay: (value: number | null | undefined) => string;
  localizeUnitText: (text: string) => string;
  normalizeDangerLevel: (level: number | undefined) => number;
}

export function DeepDiveReportCard({
  order,
  objectiveName,
  positionLat,
  positionLng,
  forecastDate,
  selectedDate,
  displayStartTime,
  safeShareLink,
  weatherIssuedTime,
  weatherForecastStartTime,
  weatherForecastEndTime,
  weatherTimezone,
  weatherHumidity,
  weatherDewPoint,
  weatherCloudCover,
  rainfall12hDisplay,
  rainfall24hDisplay,
  rainfall48hDisplay,
  snowfall12hDisplay,
  snowfall24hDisplay,
  snowfall48hDisplay,
  safeWeatherLink,
  weatherSourceDisplay,
  weatherBlended,
  weatherFieldSources,
  weatherElevation,
  weatherElevationSource,
  weatherElevationForecastNote,
  elevationForecastBands,
  avalancheCenter,
  avalancheZone,
  avalanchePublishedTime,
  avalancheExpiresTime,
  avalancheUnknown,
  avalancheDangerLevel,
  avalancheCoverageStatus,
  avalancheDangerUnknown,
  avalancheProblemsCount,
  safeAvalancheLink,
  alertsActiveCount,
  alertsHighestSeverity,
  alerts,
  usAqi,
  aqiCategory,
  heatRiskLabel,
  heatRiskLevel,
  heatRiskGuidance,
  fireRiskLabel,
  fireRiskLevel,
  fireRiskGuidance,
  fireRiskAlerts,
  pm25,
  aqiMeasuredTime,
  snowpackSummary,
  snotelStationName,
  snotelDistanceDisplay,
  snotelSweDisplay,
  snotelDepthDisplay,
  nohrscSweDisplay,
  nohrscDepthDisplay,
  cdec,
  cdecSweDisplay,
  cdecDepthDisplay,
  safeSnotelLink,
  safeNohrscLink,
  safeCdecLink,
  safetyScore,
  safetyConfidence,
  primaryHazard,
  decision,
  factorsCount,
  groupImpactsCount,
  sourcesUsed,
  satelliteConditionLineLength,
  rawReportPayload,
  copiedRawPayload,
  handleCopyRawPayload,
  formatPubTime,
  formatForecastPeriodLabel,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
  formatElevationDeltaDisplay,
  localizeUnitText,
  normalizeDangerLevel,
}: DeepDiveReportCardProps) {
  return (
    <div className="card raw-report-card" style={{ order }}>
      <div className="card-header">
        <span className="card-title">
          <Search size={14} /> Deep Dive Report Data
          <HelpHint text="Raw source fields and report payload for validation, troubleshooting, and deeper analysis." />
        </span>
        <div className="raw-report-actions">
          <span className="raw-report-hint">Optional</span>
          <button type="button" className="raw-copy-btn" onClick={handleCopyRawPayload} disabled={!rawReportPayload}>
            {copiedRawPayload ? 'Copied JSON' : 'Copy JSON'}
          </button>
        </div>
      </div>

      <details className="raw-report-details">
        <summary>Show raw source fields and report payload</summary>

        <div className="raw-grid">
          <section className="raw-group">
            <h4>Planner Input Fields</h4>
            <ul className="raw-kv-list">
              <li>
                <span className="raw-key">Objective</span>
                <span className="raw-value">{objectiveName || 'Pinned Objective'}</span>
              </li>
              <li>
                <span className="raw-key">Coordinates</span>
                <span className="raw-value">
                  {positionLat.toFixed(5)}, {positionLng.toFixed(5)}
                </span>
              </li>
              <li>
                <span className="raw-key">Forecast Date</span>
                <span className="raw-value">{selectedDate || forecastDate}</span>
              </li>
              <li>
                <span className="raw-key">Start Time</span>
                <span className="raw-value">{displayStartTime}</span>
              </li>
              <li>
                <span className="raw-key">Share Link</span>
                <span className="raw-value">
                  {safeShareLink ? (
                    <a href={safeShareLink} target="_blank" rel="noreferrer" className="raw-link-value">
                      Open current plan URL
                    </a>
                  ) : (
                    'N/A'
                  )}
                </span>
              </li>
            </ul>
          </section>

          <section className="raw-group">
            <h4>Weather Source Fields</h4>
            <ul className="raw-kv-list">
              <li>
                <span className="raw-key">Issued</span>
                <span className="raw-value">{weatherIssuedTime ? formatPubTime(weatherIssuedTime) : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Forecast Start</span>
                <span className="raw-value">
                  {weatherForecastStartTime
                    ? formatForecastPeriodLabel(weatherForecastStartTime, weatherTimezone)
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Forecast End</span>
                <span className="raw-value">
                  {weatherForecastEndTime
                    ? formatForecastPeriodLabel(weatherForecastEndTime, weatherTimezone)
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Humidity</span>
                <span className="raw-value">
                  {Number.isFinite(Number(weatherHumidity)) ? `${Math.round(Number(weatherHumidity))}%` : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Dew Point</span>
                <span className="raw-value">{formatTempDisplay(weatherDewPoint)}</span>
              </li>
              <li>
                <span className="raw-key">Cloud Cover</span>
                <span className="raw-value">{Number.isFinite(weatherCloudCover) ? `${Math.round(weatherCloudCover as number)}%` : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Rainfall 12h/24h/48h</span>
                <span className="raw-value">
                  {rainfall12hDisplay} / {rainfall24hDisplay} / {rainfall48hDisplay}
                </span>
              </li>
              <li>
                <span className="raw-key">Snowfall 12h/24h/48h</span>
                <span className="raw-value">
                  {snowfall12hDisplay} / {snowfall24hDisplay} / {snowfall48hDisplay}
                </span>
              </li>
              <li>
                <span className="raw-key">Forecast URL</span>
                <span className="raw-value">
                  {safeWeatherLink ? (
                    <a href={safeWeatherLink} target="_blank" rel="noreferrer" className="raw-link-value">
                      Open source forecast
                    </a>
                  ) : (
                    'N/A'
                  )}
                </span>
              </li>
              <li>
                <span className="raw-key">Primary Weather Source</span>
                <span className="raw-value">{weatherSourceDisplay}</span>
              </li>
              <li>
                <span className="raw-key">Weather Blended</span>
                <span className="raw-value">{weatherBlended ? 'true' : 'false'}</span>
              </li>
              <li>
                <span className="raw-key">Field Source Map</span>
                <span className={`raw-value ${Object.keys(weatherFieldSources).length > 0 ? 'raw-value-stack' : ''}`}>
                  {Object.keys(weatherFieldSources).length > 0
                    ? Object.entries(weatherFieldSources).map(([field, source]) => <span key={field}>{field}: {source}</span>)
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Objective Elevation</span>
                <span className="raw-value">
                  {weatherElevation != null
                    ? formatElevationDisplay(weatherElevation)
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Elevation Source</span>
                <span className="raw-value">{weatherElevationSource || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Elevation Forecast Note</span>
                <span className="raw-value">{weatherElevationForecastNote ? localizeUnitText(weatherElevationForecastNote) : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Elevation Bands</span>
                <span className={`raw-value ${elevationForecastBands.length > 0 ? 'raw-value-stack' : ''}`}>
                  {elevationForecastBands.length > 0
                    ? elevationForecastBands.map((band) => (
                        <span key={`${band.label}-${band.elevationFt}`}>
                          {band.label}: {formatElevationDisplay(band.elevationFt)} ({formatElevationDeltaDisplay(
                            band.deltaFromObjectiveFt,
                          )}), {formatTempDisplay(band.temp)}, feels {formatTempDisplay(band.feelsLike)}, wind {formatWindDisplay(
                            band.windSpeed,
                          )}, gust {formatWindDisplay(band.windGust)}
                        </span>
                      ))
                    : 'N/A'}
                </span>
              </li>
            </ul>
          </section>

          <section className="raw-group">
            <h4>Avalanche Source Fields</h4>
            <ul className="raw-kv-list">
              <li>
                <span className="raw-key">Avalanche Center</span>
                <span className="raw-value">{avalancheCenter || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Zone</span>
                <span className="raw-value">{avalancheZone || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Published</span>
                <span className="raw-value">{avalanchePublishedTime ? formatPubTime(avalanchePublishedTime) : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Expires</span>
                <span className="raw-value">{avalancheExpiresTime ? formatPubTime(avalancheExpiresTime) : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Danger Level</span>
                <span className="raw-value">
                  {avalancheUnknown ? 'Unknown (No Coverage)' : `L${normalizeDangerLevel(avalancheDangerLevel ?? undefined)}`}
                </span>
              </li>
              <li>
                <span className="raw-key">Coverage Status</span>
                <span className="raw-value">{avalancheCoverageStatus || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Unknown Risk Flag</span>
                <span className="raw-value">{avalancheDangerUnknown ? 'true' : 'false'}</span>
              </li>
              <li>
                <span className="raw-key">Problem Count</span>
                <span className="raw-value">{avalancheProblemsCount}</span>
              </li>
              <li>
                <span className="raw-key">Avalanche Center Link</span>
                <span className="raw-value">
                  {safeAvalancheLink ? (
                    <a href={safeAvalancheLink} target="_blank" rel="noreferrer" className="raw-link-value">
                      Open center bulletin
                    </a>
                  ) : (
                    'N/A'
                  )}
                </span>
              </li>
            </ul>
          </section>

          <section className="raw-group">
            <h4>Additional Risk Sources</h4>
            <ul className="raw-kv-list">
              <li>
                <span className="raw-key">NWS Alert Count</span>
                <span className="raw-value">{alertsActiveCount}</span>
              </li>
              <li>
                <span className="raw-key">Highest Alert Severity</span>
                <span className="raw-value">{alertsHighestSeverity || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Alert Events</span>
                <span className={`raw-value ${alerts.length > 0 ? 'raw-value-stack' : ''}`}>
                  {alerts.length > 0
                    ? alerts.map((alert, idx) => {
                        const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
                        return (
                          <span key={`${alert.event || 'alert'}-${idx}`}>
                            {(alert.event || 'Alert')} &bull; {alert.severity || 'Unknown'} &bull; {alert.urgency || 'Unknown'}
                            {safeAlertLink ? (
                              <>
                                {' '}
                                &bull;{' '}
                                <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                  Source link
                                </a>
                              </>
                            ) : null}
                          </span>
                        );
                      })
                    : 'None'}
                </span>
              </li>
              <li>
                <span className="raw-key">US AQI</span>
                <span className="raw-value">
                  {usAqi != null ? `${Math.round(usAqi)} (${aqiCategory || 'N/A'})` : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Heat Risk Level</span>
                <span className="raw-value">
                  {heatRiskLabel || 'N/A'}
                  {Number.isFinite(Number(heatRiskLevel)) ? ` (L${Number(heatRiskLevel)})` : ''}
                </span>
              </li>
              <li>
                <span className="raw-key">Heat Risk Guidance</span>
                <span className="raw-value">{heatRiskGuidance || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Fire Risk Level</span>
                <span className="raw-value">
                  {fireRiskLabel || 'N/A'}
                  {Number.isFinite(Number(fireRiskLevel)) ? ` (L${Number(fireRiskLevel)})` : ''}
                </span>
              </li>
              <li>
                <span className="raw-key">Fire Risk Guidance</span>
                <span className="raw-value">{fireRiskGuidance || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Fire Alert Signals</span>
                <span className={`raw-value ${fireRiskAlerts.length > 0 ? 'raw-value-stack' : ''}`}>
                  {fireRiskAlerts.length > 0
                    ? fireRiskAlerts.map((alert, idx) => {
                        const safeAlertLink = sanitizeExternalUrl(alert.link || undefined);
                        return (
                          <span key={`${alert.event || 'fire'}-${idx}`}>
                            {alert.event || 'Alert'} &bull; {alert.severity || 'Unknown'}
                            {safeAlertLink ? (
                              <>
                                {' '}
                                &bull;{' '}
                                <a href={safeAlertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                                  Source link
                                </a>
                              </>
                            ) : null}
                          </span>
                        );
                      })
                    : 'None'}
                </span>
              </li>
              <li>
                <span className="raw-key">PM2.5</span>
                <span className="raw-value">
                  {pm25 != null ? `${pm25} \u03bcg/m\u00b3` : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">AQI Sample Time (UTC)</span>
                <span className="raw-value">
                  {aqiMeasuredTime
                    ? formatForecastPeriodLabel(aqiMeasuredTime, 'UTC')
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Snowpack Summary</span>
                <span className="raw-value">{snowpackSummary ? localizeUnitText(snowpackSummary) : 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">SNOTEL Station</span>
                <span className="raw-value">
                  {snotelStationName
                    ? `${snotelStationName}${snotelDistanceDisplay !== 'N/A' ? ` (${snotelDistanceDisplay})` : ''}`
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">SNOTEL SWE / Depth</span>
                <span className="raw-value">
                  {snotelSweDisplay !== 'N/A' || snotelDepthDisplay !== 'N/A'
                    ? `${snotelSweDisplay !== 'N/A' ? snotelSweDisplay : 'SWE N/A'} \u2022 ${snotelDepthDisplay !== 'N/A' ? `${snotelDepthDisplay} depth` : 'Depth N/A'}`
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">NOHRSC SWE / Depth</span>
                <span className="raw-value">
                  {nohrscSweDisplay !== 'N/A' || nohrscDepthDisplay !== 'N/A'
                    ? `${nohrscSweDisplay !== 'N/A' ? nohrscSweDisplay : 'SWE N/A'} \u2022 ${nohrscDepthDisplay !== 'N/A' ? `${nohrscDepthDisplay} depth` : 'Depth N/A'}`
                    : 'N/A'}
                </span>
              </li>
              {cdec && (
                <li>
                  <span className="raw-key">CDEC SWE / Depth</span>
                  <span className="raw-value">
                    {Number.isFinite(Number(cdec.sweIn)) || Number.isFinite(Number(cdec.snowDepthIn))
                      ? `${cdecSweDisplay !== 'N/A' ? cdecSweDisplay : 'SWE N/A'} \u2022 ${cdecDepthDisplay !== 'N/A' ? `${cdecDepthDisplay} depth` : 'Depth N/A'} (${cdec.stationName || cdec.stationCode})`
                      : 'N/A'}
                  </span>
                </li>
              )}
              <li>
                <span className="raw-key">Snowpack Source Links</span>
                <span className={`raw-value ${safeSnotelLink || safeNohrscLink || safeCdecLink ? 'raw-value-stack' : ''}`}>
                  {safeSnotelLink || safeNohrscLink || safeCdecLink ? (
                    <>
                      {safeSnotelLink ? (
                        <span>
                          <a href={safeSnotelLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            NRCS AWDB / SNOTEL
                          </a>
                        </span>
                      ) : null}
                      {safeNohrscLink ? (
                        <span>
                          <a href={safeNohrscLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            NOAA NOHRSC Snow Analysis
                          </a>
                        </span>
                      ) : null}
                      {safeCdecLink ? (
                        <span>
                          <a href={safeCdecLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            CDEC ({cdec?.stationCode})
                          </a>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    'N/A'
                  )}
                </span>
              </li>
            </ul>
          </section>

          <section className="raw-group">
            <h4>Report Output Fields</h4>
            <ul className="raw-kv-list">
              <li>
                <span className="raw-key">Safety Score</span>
                <span className="raw-value">{safetyScore}</span>
              </li>
              <li>
                <span className="raw-key">Score Confidence</span>
                <span className="raw-value">
                  {typeof safetyConfidence === 'number' ? `${safetyConfidence}%` : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">Primary Hazard</span>
                <span className="raw-value">{primaryHazard || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Decision Level</span>
                <span className="raw-value">{decision?.level || 'N/A'}</span>
              </li>
              <li>
                <span className="raw-key">Blocker Count</span>
                <span className="raw-value">{decision?.blockers.length || 0}</span>
              </li>
              <li>
                <span className="raw-key">Caution Count</span>
                <span className="raw-value">{decision?.cautions.length || 0}</span>
              </li>
              <li>
                <span className="raw-key">Applied Risk Factors</span>
                <span className="raw-value">{factorsCount}</span>
              </li>
              <li>
                <span className="raw-key">Risk Groups</span>
                <span className="raw-value">{groupImpactsCount}</span>
              </li>
              <li>
                <span className="raw-key">Safety Sources</span>
                <span className={`raw-value ${sourcesUsed.length > 0 ? 'raw-value-stack' : ''}`}>
                  {sourcesUsed.length > 0
                    ? sourcesUsed.map((source, idx) => <span key={`${source}-${idx}`}>{source}</span>)
                    : 'N/A'}
                </span>
              </li>
              <li>
                <span className="raw-key">SAT One-Liner Length</span>
                <span className="raw-value">{satelliteConditionLineLength} chars</span>
              </li>
            </ul>
          </section>
        </div>

        <details className="raw-json-details">
          <summary>Open full JSON payload used to build this report</summary>
          <pre className="raw-json-pre">{rawReportPayload}</pre>
        </details>
      </details>
    </div>
  );
}
