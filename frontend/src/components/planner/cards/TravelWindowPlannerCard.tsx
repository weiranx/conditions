import type { ChangeEventHandler, Dispatch, FocusEventHandler, SetStateAction } from 'react';
import { formatClockForStyle } from '../../../app/core';
import type { CriticalRiskLevel, TimeStyle, TravelWindowInsights, TravelWindowRow, TravelWindowSpan } from '../../../app/types';

interface CriticalWindowRow {
  time: string;
  level: CriticalRiskLevel;
  reasons: string[];
  score: number;
  temp: number;
  wind: number;
  gust: number;
  precipChance?: number;
}

type TravelThresholdPresetKey = 'conservative' | 'standard' | 'aggressive';

interface TravelWindowPlannerCardProps {
  peakCriticalWindow: CriticalWindowRow | null;
  timeStyle: TimeStyle;
  criticalRiskLevelText: (level: CriticalRiskLevel) => string;
  localizeUnitText: (text: string) => string;
  travelWindowInsights: TravelWindowInsights;
  travelWindowRows: TravelWindowRow[];
  travelWindowHours: number;
  formatTravelWindowSpan: (span: TravelWindowSpan, timeStyle: TimeStyle) => string;
  windThresholdDisplay: string;
  maxPrecipChance: number;
  feelsLikeThresholdDisplay: string;
  activeTravelThresholdPreset: TravelThresholdPresetKey | null;
  travelThresholdPresets: Record<
    TravelThresholdPresetKey,
    { label: string; maxWindGustMph: number; maxPrecipChance: number; minFeelsLikeF: number }
  >;
  onApplyTravelThresholdPreset: (preset: TravelThresholdPresetKey) => void;
  travelThresholdEditorOpen: boolean;
  setTravelThresholdEditorOpen: Dispatch<SetStateAction<boolean>>;
  windUnitLabel: string;
  windThresholdMin: number;
  windThresholdMax: number;
  windThresholdStep: number;
  maxWindGustDraft: string;
  handleWindThresholdDisplayChange: ChangeEventHandler<HTMLInputElement>;
  handleWindThresholdDisplayBlur: FocusEventHandler<HTMLInputElement>;
  maxPrecipChanceDraft: string;
  handleMaxPrecipChanceDraftChange: ChangeEventHandler<HTMLInputElement>;
  handleMaxPrecipChanceDraftBlur: FocusEventHandler<HTMLInputElement>;
  tempUnitLabel: string;
  feelsLikeThresholdMin: number;
  feelsLikeThresholdMax: number;
  feelsLikeThresholdStep: number;
  minFeelsLikeDraft: string;
  handleFeelsLikeThresholdDisplayChange: ChangeEventHandler<HTMLInputElement>;
  handleFeelsLikeThresholdDisplayBlur: FocusEventHandler<HTMLInputElement>;
  travelWindowSummary: string;
  criticalWindow: CriticalWindowRow[];
  travelWindowExpanded: boolean;
  setTravelWindowExpanded: Dispatch<SetStateAction<boolean>>;
  visibleCriticalWindowRows: CriticalWindowRow[];
  formatTempDisplay: (value: number | null | undefined) => string;
  formatWindDisplay: (value: number | null | undefined) => string;
}

export function TravelWindowPlannerCard({
  peakCriticalWindow,
  timeStyle,
  criticalRiskLevelText,
  localizeUnitText,
  travelWindowInsights,
  travelWindowRows,
  travelWindowHours,
  formatTravelWindowSpan,
  windThresholdDisplay,
  maxPrecipChance,
  feelsLikeThresholdDisplay,
  activeTravelThresholdPreset,
  travelThresholdPresets,
  onApplyTravelThresholdPreset,
  travelThresholdEditorOpen,
  setTravelThresholdEditorOpen,
  windUnitLabel,
  windThresholdMin,
  windThresholdMax,
  windThresholdStep,
  maxWindGustDraft,
  handleWindThresholdDisplayChange,
  handleWindThresholdDisplayBlur,
  maxPrecipChanceDraft,
  handleMaxPrecipChanceDraftChange,
  handleMaxPrecipChanceDraftBlur,
  tempUnitLabel,
  feelsLikeThresholdMin,
  feelsLikeThresholdMax,
  feelsLikeThresholdStep,
  minFeelsLikeDraft,
  handleFeelsLikeThresholdDisplayChange,
  handleFeelsLikeThresholdDisplayBlur,
  travelWindowSummary,
  criticalWindow,
  travelWindowExpanded,
  setTravelWindowExpanded,
  visibleCriticalWindowRows,
  formatTempDisplay,
  formatWindDisplay,
}: TravelWindowPlannerCardProps) {
  const trendToneClass =
    travelWindowInsights.trendDirection === 'improving'
      ? 'is-good'
      : travelWindowInsights.trendDirection === 'worsening'
        ? 'is-bad'
        : 'is-watch';

  return (
    <>
      {peakCriticalWindow ? (
        <div className="critical-window">
          <p className="critical-summary">
            Peak risk near <strong>{formatClockForStyle(peakCriticalWindow.time, timeStyle)}</strong>: {criticalRiskLevelText(peakCriticalWindow.level)}
            {peakCriticalWindow.reasons.length > 0 ? ` (${localizeUnitText(peakCriticalWindow.reasons.join(', '))})` : ''}.
          </p>
          <div className="travel-overview-grid" role="list" aria-label="Travel window summary">
            <article
              className={`travel-overview-item ${
                travelWindowInsights.passHours >= Math.ceil(Math.max(1, travelWindowRows.length * 0.6))
                  ? 'is-good'
                  : travelWindowInsights.passHours === 0
                    ? 'is-bad'
                    : 'is-watch'
              }`}
              role="listitem"
            >
              <span className="travel-overview-label">Passing Hours</span>
              <strong className="travel-overview-value">
                {travelWindowInsights.passHours}/{travelWindowRows.length || travelWindowHours}
              </strong>
            </article>
            <article className="travel-overview-item" role="listitem">
              <span className="travel-overview-label">Best Window</span>
              <strong className="travel-overview-value">
                {travelWindowInsights.bestWindow
                  ? `${formatTravelWindowSpan(travelWindowInsights.bestWindow, timeStyle)} (${travelWindowInsights.bestWindow.length}h)`
                  : 'None'}
              </strong>
            </article>
            <article className="travel-overview-item" role="listitem">
              <span className="travel-overview-label">Most Common Blocker</span>
              <strong className="travel-overview-value">{travelWindowInsights.topFailureLabels[0] || 'None dominant'}</strong>
            </article>
            <article className={`travel-overview-item ${trendToneClass}`} role="listitem">
              <span className="travel-overview-label">Trend</span>
              <strong className="travel-overview-value">{travelWindowInsights.trendLabel}</strong>
              <small className="travel-overview-subvalue">{travelWindowInsights.trendSummary}</small>
            </article>
            <article className="travel-overview-item" role="listitem">
              <span className="travel-overview-label">Weather Conditions Trend</span>
              <strong className="travel-overview-value">{travelWindowInsights.conditionTrendLabel}</strong>
              <small className="travel-overview-subvalue">{travelWindowInsights.conditionTrendSummary}</small>
            </article>
          </div>
          <div className="travel-thresholds">
            <span>Gust &lt;= {windThresholdDisplay}</span>
            <span>Precip &lt;= {maxPrecipChance}%</span>
            <span>Feels-like &gt;= {feelsLikeThresholdDisplay}</span>
          </div>
          <div className="travel-preset-row" role="group" aria-label="Travel threshold presets">
            {(['conservative', 'standard', 'aggressive'] as const).map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                className={`travel-preset-btn ${activeTravelThresholdPreset === presetKey ? 'active' : ''}`}
                onClick={() => onApplyTravelThresholdPreset(presetKey)}
                aria-pressed={activeTravelThresholdPreset === presetKey}
              >
                {travelThresholdPresets[presetKey].label}
              </button>
            ))}
          </div>
          <div className="travel-threshold-actions">
            <button
              type="button"
              className="settings-btn travel-window-toggle"
              onClick={() => setTravelThresholdEditorOpen((prev) => !prev)}
              aria-expanded={travelThresholdEditorOpen}
              aria-controls="travel-threshold-editor"
            >
              {travelThresholdEditorOpen ? 'Hide threshold controls' : 'Edit thresholds'}
            </button>
          </div>
          {travelThresholdEditorOpen && (
            <>
              <div className="travel-threshold-editor" id="travel-threshold-editor" aria-label="Travel window threshold controls">
                <label className="travel-threshold-row">
                  <span>Max gust ({windUnitLabel})</span>
                  <input
                    type="number"
                    min={windThresholdMin}
                    max={windThresholdMax}
                    step={windThresholdStep}
                    value={maxWindGustDraft}
                    onChange={handleWindThresholdDisplayChange}
                    onBlur={handleWindThresholdDisplayBlur}
                  />
                </label>
                <label className="travel-threshold-row">
                  <span>Max precip (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={maxPrecipChanceDraft}
                    onChange={handleMaxPrecipChanceDraftChange}
                    onBlur={handleMaxPrecipChanceDraftBlur}
                  />
                </label>
                <label className="travel-threshold-row">
                  <span>Min feels-like ({tempUnitLabel})</span>
                  <input
                    type="number"
                    min={feelsLikeThresholdMin}
                    max={feelsLikeThresholdMax}
                    step={feelsLikeThresholdStep}
                    value={minFeelsLikeDraft}
                    onChange={handleFeelsLikeThresholdDisplayChange}
                    onBlur={handleFeelsLikeThresholdDisplayBlur}
                  />
                </label>
              </div>
              <p className="muted-note travel-threshold-note">Edits apply immediately and are saved to Settings.</p>
            </>
          )}
          <p className="muted-note">{travelWindowSummary}</p>
          {travelWindowRows.length > 0 && (
            <div className="travel-timeline" role="list" aria-label={`${travelWindowHours}-hour travel window timeline`}>
              {travelWindowRows.map((row, idx) => {
                const riskLevel = criticalWindow[idx]?.level || 'stable';
                return (
                  <article
                    key={`timeline-${row.time}-${idx}`}
                    className={`travel-timeline-cell ${row.pass ? 'pass' : 'fail'} ${riskLevel}`}
                    role="listitem"
                    title={`${formatClockForStyle(row.time, timeStyle)} • ${row.pass ? 'within limits' : localizeUnitText(row.reasonSummary)}`}
                  >
                    <span className="travel-timeline-time">{formatClockForStyle(row.time, timeStyle)}</span>
                    <span className="travel-timeline-status">{row.pass ? 'OK' : 'ATTN'}</span>
                  </article>
                );
              })}
            </div>
          )}
          <div className="travel-window-actions">
            <button
              type="button"
              className="settings-btn travel-window-toggle"
              onClick={() => setTravelWindowExpanded((prev) => !prev)}
            >
              {travelWindowExpanded ? 'Hide hourly details' : `Show hourly details (${travelWindowRows.length})`}
            </button>
          </div>
          {travelWindowExpanded && (
            <div className="critical-list" role="list" aria-label="Hourly critical window assessment">
              {visibleCriticalWindowRows.map((row, idx) => {
                const travelRow = travelWindowRows[idx];
                return (
                  <article
                    key={`${row.time}-${idx}`}
                    className={`critical-row ${row.level} ${travelRow?.pass ? 'pass' : 'fail'}`}
                    role="listitem"
                  >
                    <div className="critical-row-time">{formatClockForStyle(row.time, timeStyle)}</div>
                    <div className="critical-row-main">
                      <div className="critical-row-head">
                        <span className={`critical-level ${row.level}`}>{criticalRiskLevelText(row.level)}</span>
                        <span className={`travel-pass-pill ${travelRow?.pass ? 'pass' : 'fail'}`}>
                          {travelRow?.pass ? 'Within limits' : 'Outside limits'}
                        </span>
                        <span className="critical-metrics">
                          {formatTempDisplay(row.temp)} • feels {formatTempDisplay(travelRow?.feelsLike ?? row.temp)} • wind {formatWindDisplay(row.wind)} • gust{' '}
                          {formatWindDisplay(row.gust)} • precip {travelRow?.precipChance ?? row.precipChance ?? 0}%
                        </span>
                      </div>
                      <p className="critical-row-reason">
                        {travelRow?.pass
                          ? 'Within configured thresholds for this hour.'
                          : localizeUnitText(
                              travelRow?.reasonSummary || (row.reasons.length > 0 ? row.reasons.join(', ') : 'No major hazard signal for this hour.'),
                            )}
                      </p>
                      {!travelRow?.pass && travelRow?.failedRuleLabels?.length ? (
                        <div className="travel-failure-chips" aria-label="Failed thresholds">
                          {travelRow.failedRuleLabels.map((label, failIdx) => (
                            <span key={`${row.time}-fail-${failIdx}`} className="travel-failure-chip">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="muted-note">Hourly trend data is unavailable for this objective/date.</p>
      )}
    </>
  );
}
