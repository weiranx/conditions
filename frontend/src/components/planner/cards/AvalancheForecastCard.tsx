import type { CSSProperties } from 'react';
import { AlertTriangle, Clock, Zap } from 'lucide-react';
import type { AvalancheElevationBand, SafetyData } from '../../../app/types';
import {
  ASPECT_ROSE_ORDER,
  getLocationEntries,
  parseLikelihoodRange,
  parseProblemSizeRange,
  parseTerrainFromLocation,
} from '../../../utils/avalanche';
import { HelpHint } from '../CardHelpHint';

interface AvalancheElevationRow {
  key: string;
  label: string;
  rating?: AvalancheElevationBand;
}

interface AvalancheForecastCardProps {
  order: number;
  avalanche: SafetyData['avalanche'];
  avalancheExpiredForSelectedStart: boolean;
  avalancheRelevant: boolean;
  avalancheNotApplicableReason: string;
  avalancheUnknown: boolean;
  overallAvalancheLevel: number | null;
  avalancheElevationRows: AvalancheElevationRow[];
  safeAvalancheLink: string | null;
  formatPubTime: (value: string) => string;
  getDangerLevelClass: (level?: number) => string;
  getDangerText: (level: number) => string;
  normalizeDangerLevel: (level?: number) => number;
  getDangerGlyph: (level: number) => string;
  summarizeText: (text: string | undefined, maxLength?: number) => string;
  toPlainText: (value: string) => string;
  objectiveElevationFt?: number | null;
}

export function AvalancheForecastCard({
  order,
  avalanche,
  avalancheExpiredForSelectedStart,
  avalancheRelevant,
  avalancheNotApplicableReason,
  avalancheUnknown,
  overallAvalancheLevel,
  avalancheElevationRows,
  safeAvalancheLink,
  formatPubTime,
  getDangerLevelClass,
  getDangerText,
  normalizeDangerLevel,
  getDangerGlyph,
  summarizeText,
  toPlainText,
  objectiveElevationFt,
}: AvalancheForecastCardProps) {
  return (
    <div className="card avy-card" style={{ order }}>
      <div className="card-header">
        <span className="card-title">
          <Zap size={14} /> Avalanche Forecast
          <HelpHint text="Center-issued avalanche danger by elevation, bottom line, and published avalanche problems for this zone/date." />
        </span>
        <div className="source-meta">
          <span>Avalanche center: {avalanche.center || 'N/A'}</span>
          {avalanche.zone && <span className="source-zone">{avalanche.zone}</span>}
          {avalanche.publishedTime && (
            <span className="published-chip">
              <Clock size={10} /> Issued: {formatPubTime(avalanche.publishedTime)}
            </span>
          )}
          {avalanche.expiresTime && (
            <span className={`published-chip ${avalancheExpiredForSelectedStart ? 'published-chip-expired' : ''}`}>
              <Clock size={10} /> {avalancheExpiredForSelectedStart ? 'Expired:' : 'Expires:'} {formatPubTime(avalanche.expiresTime)}
            </span>
          )}
        </div>
      </div>

      {avalancheExpiredForSelectedStart && (
        <p className="muted-note">This bulletin is expired for the selected start time and is shown for context only.</p>
      )}
      {avalanche.staleWarning === '72h' && (
        <p className="muted-note stale-warning-banner">This bulletin is over 72 hours old — treat danger ratings as unknown.</p>
      )}
      {avalanche.staleWarning === '48h' && (
        <p className="muted-note">This bulletin is over 48 hours old. Verify the latest forecast before departure.</p>
      )}

      {!avalancheRelevant ? (
        <div className="avy-forecast-body">
          <div className="avy-coverage-note unknown-mode-panel">
            <strong>Avalanche Forecast Not Applicable</strong>
            <p>{avalancheNotApplicableReason}</p>
            <p className="muted-note">
              Result is hidden for this objective/time because avalanche forecasting is currently de-emphasized. Re-check if weather or snowpack changes.
            </p>
          </div>
        </div>
      ) : (
        <div className="avy-forecast-body">
          <div className="danger-summary-box">
            <div className="danger-summary-header">
              <span className="section-label">{avalancheUnknown ? 'Avalanche Coverage Status' : 'Danger Rating By Elevation'}</span>
              <span className={`overall-danger-chip ${avalancheUnknown ? 'danger-level-unknown' : getDangerLevelClass(overallAvalancheLevel ?? undefined)}`}>
                {avalancheUnknown ? 'Overall: Unknown' : `Overall: L${overallAvalancheLevel} ${getDangerText(overallAvalancheLevel ?? 0)}`}
              </span>
            </div>
            {!avalancheUnknown && Number.isFinite(objectiveElevationFt) && objectiveElevationFt != null && (
              <span className="objective-elev-note muted-note">Objective: ~{Math.round(objectiveElevationFt).toLocaleString()} ft — check which band applies to your route.</span>
            )}

            {avalancheUnknown ? (
              <div className="avy-coverage-note unknown-mode-panel">
                <strong>Limited Avalanche Coverage</strong>
                <p>No official avalanche forecast is available for this objective. This does not imply low risk.</p>
                <ul className="signal-list compact">
                  <li>Avoid avalanche terrain and terrain traps unless you can independently assess snowpack.</li>
                  <li>Favor low-angle routes and wind-sheltered aspects.</li>
                  <li>Use explicit abort triggers and tighter partner spacing.</li>
                </ul>
              </div>
            ) : (
              <>
                <div className="avy-danger-layout">
                  <div className={`avy-danger-pyramid ${getDangerLevelClass(overallAvalancheLevel ?? undefined)}`} aria-hidden="true" />
                  <div className="danger-rows">
                    {avalancheElevationRows.map((row) => {
                      const rowLevel = normalizeDangerLevel(row.rating?.level);
                      const rowText = row.rating?.label || getDangerText(rowLevel);
                      return (
                        <div key={row.key} className={`danger-row ${getDangerLevelClass(rowLevel)}`}>
                          <span className="danger-row-band">{row.label}</span>
                          <strong className="danger-row-text">
                            {rowLevel} - {rowText}
                          </strong>
                          <span className={`danger-level-diamond ${getDangerLevelClass(rowLevel)}`}>
                            <span>{getDangerGlyph(rowLevel)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="avy-scale-wrap">
                  <span className="section-label">Danger Scale</span>
                  <div className="avy-scale-track">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div key={level} className={`avy-scale-segment ${getDangerLevelClass(level)}`}>
                        {level} - {getDangerText(level)}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {(avalanche.bottomLine || avalanche.advice) && (
            <div className="avy-bottom-line">
              <div className="bl-header">The Bottom Line</div>
              <div className="bl-content">{toPlainText(avalanche.bottomLine || avalanche.advice || '')}</div>
            </div>
          )}

          {avalanche.problems && avalanche.problems.length > 0 && (
            <div className="avy-problems">
              <span className="section-label">Avalanche Problems</span>
              <div className="problems-grid">
                {avalanche.problems.map((problem, i) => {
                  const terrain = parseTerrainFromLocation(problem.location);
                  const locationEntries = getLocationEntries(problem.location);
                  const summary = summarizeText(problem.discussion || problem.problem_description);
                  const iconUrl = problem.icon ? problem.icon.replace(/^http:\/\//i, 'https://') : '';
                  const likelihoodRange = parseLikelihoodRange(problem.likelihood);
                  const sizeRange = parseProblemSizeRange(problem.size);
                  const likelihoodScaleStyle =
                    likelihoodRange !== null
                      ? ({
                          ['--scale-indicator-top-index' as string]: String(5 - likelihoodRange.max),
                          ['--scale-indicator-span' as string]: String(likelihoodRange.max - likelihoodRange.min + 1),
                        } as CSSProperties)
                      : undefined;
                  const sizeScaleStyle =
                    sizeRange.min !== null && sizeRange.max !== null
                      ? ({
                          ['--scale-indicator-top-index' as string]: String(5 - sizeRange.max),
                          ['--scale-indicator-span' as string]: String(sizeRange.max - sizeRange.min + 1),
                        } as CSSProperties)
                      : undefined;

                  return (
                    <article key={problem.id || i} className="avy-problem-card avy-problem-card-structured">
                      <h4 className="problem-structured-title">Problem #{i + 1}: {(problem.name || `Problem ${i + 1}`).toUpperCase()}</h4>
                      <div className="problem-structured-grid">
                        <section className="problem-structured-col">
                          <div className="problem-structured-label">Problem Type</div>
                          <div className="problem-type-box">
                            <div className="problem-icon problem-icon-lg">
                              {iconUrl ? <img src={iconUrl} alt={`${problem.name || 'Avalanche problem'} icon`} /> : <AlertTriangle size={18} />}
                            </div>
                            <div className="problem-type-name">{problem.name || `Problem ${i + 1}`}</div>
                          </div>
                        </section>

                        <section className="problem-structured-col">
                          <div className="problem-structured-label">Aspect/Elevation</div>
                          <div className="aspect-elevation-box">
                            <div className="aspect-elevation-simple">
                              <div className="aspect-simple-group">
                                <span className="aspect-simple-heading">Aspects</span>
                                <div className="aspect-chip-grid" role="list" aria-label="Avalanche problem aspects">
                                  {ASPECT_ROSE_ORDER.map((aspect) => {
                                    const isActive = terrain.aspects.size === 0 || terrain.aspects.has(aspect);
                                    return (
                                      <span key={`${problem.id || i}-${aspect}`} className={`aspect-chip ${isActive ? 'active' : ''}`} role="listitem">
                                        {aspect}
                                      </span>
                                    );
                                  })}
                                </div>
                                <p className="aspect-simple-note">
                                  {terrain.aspects.size === 0
                                    ? 'No specific aspects listed; treat all aspects as potentially involved.'
                                    : 'Highlighted aspects are identified in the bulletin.'}
                                </p>
                              </div>

                              <div className="aspect-simple-group">
                                <span className="aspect-simple-heading">Elevation Bands</span>
                                <div className="elevation-band-list" role="list" aria-label="Avalanche problem elevation bands">
                                  {[
                                    { band: 'upper', label: 'Above Treeline' },
                                    { band: 'middle', label: 'Near Treeline' },
                                    { band: 'lower', label: 'Below Treeline' },
                                  ].map((entry) => {
                                    const isActive = terrain.elevations.size === 0 || terrain.elevations.has(entry.band as 'upper' | 'middle' | 'lower');
                                    return (
                                      <div key={`${problem.id || i}-${entry.band}`} className={`elevation-band-row ${isActive ? 'active' : ''}`} role="listitem">
                                        <span className="elevation-band-label">{entry.label}</span>
                                        <span className="elevation-band-state">{isActive ? 'Included' : 'Not highlighted'}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="problem-structured-col">
                          <div className="problem-structured-label">Likelihood</div>
                          <div className="vertical-scale" style={likelihoodScaleStyle}>
                            <div className="scale-rail" />
                            {likelihoodRange !== null && <div className="scale-indicator" aria-hidden="true" />}
                            {[5, 4, 3, 2, 1].map((step) => (
                              <div
                                key={step}
                                className={`scale-step ${
                                  likelihoodRange !== null && step >= likelihoodRange.min && step <= likelihoodRange.max ? 'active' : ''
                                }`}
                              >
                                <span className="scale-tick" />
                                <span className="scale-text">
                                  {step === 5 ? 'Certain' : step === 4 ? 'Very Likely' : step === 3 ? 'Likely' : step === 2 ? 'Possible' : 'Unlikely'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="problem-structured-col">
                          <div className="problem-structured-label">Size</div>
                          <div className="vertical-scale size-scale" style={sizeScaleStyle}>
                            <div className="scale-rail" />
                            {sizeRange.min !== null && sizeRange.max !== null && <div className="scale-indicator" aria-hidden="true" />}
                            {[5, 4, 3, 2, 1].map((step) => {
                              const activeRange =
                                sizeRange.min !== null &&
                                sizeRange.max !== null &&
                                step >= sizeRange.min &&
                                step <= sizeRange.max;
                              return (
                                <div key={step} className={`scale-step ${activeRange ? 'active' : ''}`}>
                                  <span className="scale-tick" />
                                  <span className="scale-text">
                                    {step === 5
                                      ? 'Historic (D4-5)'
                                      : step === 4
                                        ? 'Very Large (D3)'
                                        : step === 3
                                          ? 'Large (D2)'
                                          : step === 2
                                            ? 'Small-Large (D1-2)'
                                            : 'Small (D1)'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      </div>

                      {locationEntries.length > 0 && terrain.elevations.size === 0 && terrain.aspects.size === 0 && (
                        <p className="problem-location-line">Terrain: {locationEntries.join(', ')}</p>
                      )}

                      {summary && <p className="problem-summary">{summary}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {(!avalanche.problems || avalanche.problems.length === 0) && (
            <p className="muted-note avy-problems-empty">
              {avalancheUnknown
                ? 'No avalanche center problem list is available for this objective.'
                : 'Center did not publish a detailed avalanche problem breakdown for this zone/date.'}
            </p>
          )}
        </div>
      )}

      {safeAvalancheLink && (
        <a href={safeAvalancheLink} target="_blank" rel="noreferrer" className="avy-external-link">
          View full forecast at {avalanche.center?.toUpperCase() || 'OFFICIAL CENTER'} →
        </a>
      )}
    </div>
  );
}
