import {
  Thermometer,
  Wind,
  CloudRain,
  CheckCircle2,
  Sparkles,
  LoaderCircle,
  Sun,
} from 'lucide-react';
import type { SafetyData, SummitDecision, UserPreferences, TravelWindowRow, TravelWindowInsights } from '../../app/types';
import type { AiFeatureAvailability } from '../../hooks/useAiAvailability';
import { formatAiBriefSections } from '../../app/text-utils';
import { AiInsightBriefing } from './AiInsightBriefing';
import { ReportChat } from './ReportChat';
import '../../styles/dashboard-redesign.css';

const GAUGE_R = 56;
const GAUGE_C = 2 * Math.PI * GAUGE_R; // ≈ 351.86
export interface DashboardSummaryCardProps {
  aiAvailability: AiFeatureAvailability;
  safetyData: SafetyData;
  decision: SummitDecision;
  preferences: UserPreferences;
  objectiveName: string;
  displayStartTime: string;
  returnTimeFormatted: string | null;
  returnExtendsPastMidnight: boolean;
  formatClockForStyle: (time: string, style: UserPreferences['timeStyle']) => string;
  getScoreColor: (score: number, tier?: string) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  decisionActionLine: string;
  localizeUnitText: (text: string) => string;
  travelWindowRows: TravelWindowRow[];
  travelWindowInsights: TravelWindowInsights;
  aiBriefNarrative: string | null;
  aiBriefError: string | null;
  aiBriefLoading: boolean;
  onRequestAiBrief: () => void;
  rawReportPayload: string;
}

export function DashboardSummaryCard({
  aiAvailability,
  safetyData,
  decision,
  preferences,
  objectiveName,
  displayStartTime,
  returnTimeFormatted,
  returnExtendsPastMidnight,
  formatClockForStyle,
  getScoreColor,
  formatTempDisplay,
  formatWindDisplay,
  decisionActionLine,
  localizeUnitText,
  travelWindowRows,
  travelWindowInsights,
  aiBriefNarrative,
  aiBriefError,
  aiBriefLoading,
  onRequestAiBrief,
  rawReportPayload,
}: DashboardSummaryCardProps) {
  const lvClass = decision.level.toLowerCase().replace('-', ''); // go | caution | nogo
  const score = Math.round(safetyData.safety.score);
  const scoreColor = getScoreColor(score, safetyData.safety.tier);
  const confidence = typeof safetyData.safety.confidence === 'number' ? Math.round(safetyData.safety.confidence) : null;
  const pleasantness = safetyData.pleasantness;
  const pleasantnessScore = typeof pleasantness?.score === 'number' && Number.isFinite(pleasantness.score)
    ? Math.round(pleasantness.score)
    : null;
  const pleasantnessTone = pleasantnessScore === null
    ? ''
    : pleasantnessScore >= 75
      ? 'good'
      : pleasantnessScore >= 60
        ? 'mixed'
        : 'poor';
  const dashOffset = GAUGE_C * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tierLabel = safetyData.safety.tier ? `${safetyData.safety.tier} risk` : `${decision.level} risk`;
  const aiBriefSections = formatAiBriefSections(aiBriefNarrative);
  const maxGustMph = preferences.maxWindGustMph || 35;

  const gustValues = travelWindowRows.map((r) => r.gust).filter((n) => Number.isFinite(n));
  const peakGust = gustValues.length ? Math.max(...gustValues) : safetyData.weather.windGust;
  const precipValues = travelWindowRows.map((r) => r.precipChance).filter((n) => Number.isFinite(n));
  const peakPrecip = precipValues.length ? Math.max(...precipValues) : safetyData.weather.precipChance;
  const cleanHours = travelWindowInsights?.passHours ?? 0;
  const bestWindow =
    travelWindowInsights?.bestWindow != null
      ? `${formatClockForStyle(travelWindowInsights.bestWindow.start, preferences.timeStyle)}–${formatClockForStyle(travelWindowInsights.bestWindow.end, preferences.timeStyle)}`
      : 'none clear';

  const returnLabel = returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, preferences.timeStyle) : null;

  return (
    <div className="ssr-dash">
      <section className={`ssr-dash-risk ${lvClass}`}>
        <div className="ssr-dash-top">
          <div className="ssr-dash-gauge">
            <svg width="128" height="128" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r={GAUGE_R} fill="none" stroke="var(--d-surface-3)" strokeWidth="11" />
              <circle
                cx="64"
                cy="64"
                r={GAUGE_R}
                fill="none"
                stroke={scoreColor}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={GAUGE_C.toFixed(1)}
                strokeDashoffset={dashOffset.toFixed(1)}
              />
            </svg>
            <div className="ssr-dash-gauge-center">
              <span className="ssr-dash-gauge-num">{score}</span>
              <span className="ssr-dash-gauge-den">/ 100</span>
            </div>
          </div>

          <div className="ssr-dash-mid">
            <div className="ssr-dash-pill-row">
              <span className="ssr-dash-pill">{tierLabel}</span>
              {pleasantnessScore !== null && (
                <span
                  className={`ssr-dash-pleasantness ${pleasantnessTone}`}
                  aria-label={`Pleasantness ${pleasantnessScore} out of 100, ${pleasantness?.label || 'rated'}. ${pleasantness?.summary || ''}`}
                >
                  <Sun size={14} aria-hidden />
                  <span>Pleasantness</span>
                  <b>{pleasantnessScore}</b>
                  <small>/100 · {pleasantness?.label}</small>
                </span>
              )}
              {confidence !== null && (
                <span className="ssr-dash-conf">
                  Confidence <b>{confidence}%</b>
                  <span className="ssr-dash-conf-bar"><i style={{ width: `${confidence}%` }} /></span>
                </span>
              )}
            </div>
            {pleasantnessScore !== null && pleasantness?.summary && (
              <div className="ssr-dash-pleasantness-explanation">
                <p><b>Comfort outlook.</b> {pleasantness.summary}</p>
                {Array.isArray(pleasantness.factors) && pleasantness.factors.length > 0 && (
                  <details>
                    <summary>How this score is calculated</summary>
                    <ul>
                      {pleasantness.factors.map((factor) => (
                        <li key={factor.factor}>
                          <b>{factor.factor}: {Math.round(factor.score)}/100.</b> {factor.message}
                        </li>
                      ))}
                    </ul>
                    {pleasantness.disclaimer && <small>{pleasantness.disclaimer}</small>}
                  </details>
                )}
              </div>
            )}
            {Array.isArray(safetyData.safety.confidenceReasons) && safetyData.safety.confidenceReasons.length > 0 && (
              <ul className="ssr-dash-conf-reasons">
                {safetyData.safety.confidenceReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            )}
            <h2 className="ssr-dash-head">{decision.headline}</h2>
            <div className="ssr-dash-where">
              <b>{objectiveName || 'Objective'}</b>
              <span className="ssr-dash-dot" />
              <span className="mono">{displayStartTime}{returnLabel ? ` – ${returnLabel}` : ''}</span>
              {returnExtendsPastMidnight && (
                <>
                  <span className="ssr-dash-dot" />
                  returns after midnight
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ssr-dash-cond-strip">
          <div className="ssr-dash-cond">
            <div className="ssr-dash-cond-k"><Thermometer /> Start temp</div>
            <div className="ssr-dash-cond-v">{formatTempDisplay(safetyData.weather.temp)}</div>
            <div className="ssr-dash-cond-sub">feels {formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)}</div>
          </div>
          <div className="ssr-dash-cond">
            <div className="ssr-dash-cond-k"><Wind /> Peak gust</div>
            <div className={`ssr-dash-cond-v ${peakGust >= maxGustMph ? 'warn' : ''}`}>{formatWindDisplay(peakGust)}</div>
            <div className={`ssr-dash-cond-sub ${peakGust >= maxGustMph ? 'warn' : ''}`}>limit {formatWindDisplay(maxGustMph)}</div>
          </div>
          <div className="ssr-dash-cond">
            <div className="ssr-dash-cond-k"><CloudRain /> Precip</div>
            <div className={`ssr-dash-cond-v ${peakPrecip >= preferences.maxPrecipChance ? 'warn' : ''}`}>{Math.round(peakPrecip)}<small>%</small></div>
            <div className={`ssr-dash-cond-sub ${peakPrecip >= preferences.maxPrecipChance ? 'warn' : ''}`}>
              {peakPrecip >= preferences.maxPrecipChance ? 'above threshold' : 'below threshold'}
            </div>
          </div>
          <div className="ssr-dash-cond">
            <div className="ssr-dash-cond-k"><CheckCircle2 /> Clean hours</div>
            <div className={`ssr-dash-cond-v ${cleanHours > 0 ? '' : 'warn'}`}>{cleanHours}<small>h</small></div>
            <div className={`ssr-dash-cond-sub ${cleanHours > 0 ? '' : 'warn'}`}>{bestWindow}</div>
          </div>
        </div>

        {decisionActionLine && (
          <div className="ssr-dash-recco">
            <span className="ssr-dash-recco-ic"><Sparkles size={17} /></span>
            <p><b>Recommendation.</b> {localizeUnitText(decisionActionLine)}</p>
          </div>
        )}

        {(aiAvailability.aiBrief || aiAvailability.reportChat) && (
          <div className="ssr-dash-ai">
          {aiAvailability.aiBrief && (aiBriefNarrative ? (
            <AiInsightBriefing
              title="Your field briefing"
              subtitle="The quick read on what matters most for this plan."
              sections={aiBriefSections}
              formatText={localizeUnitText}
            />
          ) : aiBriefError ? (
            <div className="ssr-dash-ai-error">
              <span>{aiBriefError}</span>
              <button type="button" className="ssr-dash-ai-btn" onClick={onRequestAiBrief}>Retry</button>
            </div>
          ) : (
            <button type="button" className="ssr-dash-ai-btn" onClick={onRequestAiBrief} disabled={aiBriefLoading}>
              {aiBriefLoading
                ? <><LoaderCircle size={14} className="spin" aria-hidden /> Generating…</>
                : <><Sparkles size={14} aria-hidden /> AI analysis</>}
            </button>
          ))}
          {aiAvailability.reportChat && <ReportChat reportPayload={rawReportPayload} />}
          </div>
        )}
      </section>
    </div>
  );
}
