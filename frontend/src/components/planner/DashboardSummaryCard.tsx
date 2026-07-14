import {
  CheckCircle2,
  CloudRain,
  Compass,
  Database,
  Download,
  LoaderCircle,
  Mail,
  PencilLine,
  Printer,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Sunrise,
  TriangleAlert,
  Wind,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SafetyData, SummitDecision, UserPreferences, TravelWindowRow, TravelWindowInsights } from '../../app/types';
import type { ParsedGpxRoute } from '../../lib/gpx';
import type { AiFeatureAvailability } from '../../hooks/useAiAvailability';
import {
  formatAgeFromNow,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} from '../../app/core';
import { formatAiBriefSections } from '../../app/text-utils';
import { buildFieldBrief, downloadFieldBrief } from '../../app/field-brief';
import { AiInsightBriefing } from './AiInsightBriefing';
import { ReportChat } from './ReportChat';
import '../../styles/dashboard-redesign.css';
import type { PersistedReport, PersistedReportChatMessage } from '../../app/report-storage';
import { useAccount } from '../../hooks/useAccount';
import { sendReportEmail } from '../../lib/saved-reports';

type BriefSignalTone = 'positive' | 'caution' | 'neutral';

interface BriefSignal {
  title: string;
  detail: string;
  tag: string;
  tone: BriefSignalTone;
  icon: ReactNode;
}

function compactText(value: string | null | undefined, fallback: string, maxLength = 180): string {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function clockMinutes(value: string | null | undefined): number | null {
  const input = String(value || '').trim();
  return parseTimeInputMinutes(input) ?? parseSolarClockMinutes(input || undefined);
}

function timelinePosition(value: string | null | undefined, rows: TravelWindowRow[]): number | null {
  if (rows.length === 0) return null;
  const start = clockMinutes(rows[0].time);
  const target = clockMinutes(value);
  if (start === null || target === null) return null;
  let delta = target - start;
  while (delta < 0) delta += 24 * 60;
  const span = Math.max(60, rows.length * 60);
  if (delta > span) return null;
  return Math.max(0, Math.min(100, (delta / span) * 100));
}

export interface DashboardSummaryCardProps {
  readOnly: boolean;
  aiAvailability: AiFeatureAvailability;
  safetyData: SafetyData;
  previousSafetyData: SafetyData | null;
  decision: SummitDecision;
  preferences: UserPreferences;
  objectiveName: string;
  forecastDate: string;
  travelWindowHours: number;
  importedGpxRoute: ParsedGpxRoute | null;
  planStartTime: string;
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
  onNewReport: () => void;
  onRequestAiBrief: () => void;
  onRequestReportEmailAccess: () => boolean;
  reportSnapshot: PersistedReport | null;
  rawReportPayload: string;
  reportChatMessages: PersistedReportChatMessage[];
  reportChatSessionKey: number;
  onReportChatMessagesChange: (messages: PersistedReportChatMessage[]) => void;
}

export function DashboardSummaryCard({
  readOnly,
  aiAvailability,
  safetyData,
  previousSafetyData,
  decision,
  preferences,
  objectiveName,
  forecastDate,
  travelWindowHours,
  importedGpxRoute,
  planStartTime,
  displayStartTime,
  returnTimeFormatted,
  returnExtendsPastMidnight,
  formatClockForStyle,
  getScoreColor,
  formatWindDisplay,
  decisionActionLine,
  localizeUnitText,
  travelWindowRows,
  travelWindowInsights,
  aiBriefNarrative,
  aiBriefError,
  aiBriefLoading,
  onNewReport,
  onRequestAiBrief,
  onRequestReportEmailAccess,
  reportSnapshot,
  rawReportPayload,
  reportChatMessages,
  reportChatSessionKey,
  onReportChatMessagesChange,
}: DashboardSummaryCardProps) {
  const account = useAccount();
  const [fieldBriefSaved, setFieldBriefSaved] = useState(false);
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailMessage, setEmailMessage] = useState('');
  const fieldBriefTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const emailStatusTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  useEffect(() => () => {
    if (fieldBriefTimer.current !== null) window.clearTimeout(fieldBriefTimer.current);
    if (emailStatusTimer.current !== null) window.clearTimeout(emailStatusTimer.current);
  }, []);
  const lvClass = decision.level.toLowerCase().replace('-', '');
  const score = Math.round(safetyData.safety.score);
  const scoreColor = getScoreColor(score, safetyData.safety.tier);
  const confidence = typeof safetyData.safety.confidence === 'number' ? Math.round(safetyData.safety.confidence) : null;
  const confidenceLabel = confidence === null
    ? null
    : confidence >= 80
      ? 'High confidence'
      : confidence >= 60
        ? 'Moderate confidence'
        : 'Limited confidence';
  const generatedAge = safetyData.generatedAt ? formatAgeFromNow(safetyData.generatedAt) : null;
  const statusMeta = [confidenceLabel, generatedAge ? `updated ${generatedAge}` : null].filter(Boolean).join(' · ');
  const returnLabel = returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, preferences.timeStyle) : null;
  const travelWindowLabel = `${displayStartTime}${returnLabel ? `–${returnLabel}` : ''}${returnExtendsPastMidnight ? ' (+1 day)' : ''}`;

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

  const maxGustMph = preferences.maxWindGustMph || 35;
  const gustValues = travelWindowRows.map((row) => row.gust).filter(Number.isFinite);
  const peakGust = gustValues.length ? Math.max(...gustValues) : safetyData.weather.windGust;
  const peakPrecip = travelWindowRows.length
    ? Math.max(...travelWindowRows.map((row) => row.precipChance).filter(Number.isFinite))
    : safetyData.weather.precipChance;
  const firstGust = travelWindowRows[0]?.gust;
  const gustMarkerRow = travelWindowRows.find((row, index) => (
    index > 0
    && row.gust >= maxGustMph * 0.7
    && row.gust > travelWindowRows[index - 1].gust
  )) || travelWindowRows.reduce<TravelWindowRow | null>((peak, row) => (!peak || row.gust > peak.gust ? row : peak), null);
  const gustMarkerPosition = timelinePosition(gustMarkerRow?.time, travelWindowRows);
  const sunrisePosition = timelinePosition(safetyData.solar.sunrise, travelWindowRows);
  const timelineLabelIndices = Array.from(new Set([
    0,
    Math.round((travelWindowRows.length - 1) / 3),
    Math.round(((travelWindowRows.length - 1) * 2) / 3),
    Math.max(0, travelWindowRows.length - 1),
  ])).filter((index) => travelWindowRows[index]);

  const verdictSummary = compactText(
    decision.blockers[0]
      || decision.cautions[0]
      || travelWindowInsights.summary
      || safetyData.safety.explanations?.[0]
      || decisionActionLine,
    'Review the timing and the key conditions below before committing to the plan.',
    220,
  );

  const terrain = safetyData.terrainCondition;
  const meltFreeze = terrain?.snowProfile?.meltFreeze;
  const surfaceTone: BriefSignalTone = meltFreeze?.refreezeQuality === 'strong' || meltFreeze?.refreezeQuality === 'fair'
    ? 'positive'
    : terrain?.impact === 'high' || meltFreeze?.refreezeQuality === 'weak'
      ? 'caution'
      : 'neutral';
  const surfaceSignal: BriefSignal = terrain
    ? {
        title: meltFreeze ? 'Overnight refreeze' : (terrain.label || 'Surface conditions'),
        detail: compactText(
          meltFreeze?.summary || terrain.summary || terrain.snowProfile?.summary,
          'Surface conditions need a field check at the trailhead.',
        ),
        tag: surfaceTone === 'positive' ? 'Supports' : surfaceTone === 'caution' ? 'Watch' : 'Verify',
        tone: surfaceTone,
        icon: <Snowflake size={16} aria-hidden />,
      }
    : {
        title: 'Precipitation',
        detail: `Peak chance is ${Math.round(peakPrecip)}% during this travel window; your limit is ${Math.round(preferences.maxPrecipChance)}%.`,
        tag: peakPrecip >= preferences.maxPrecipChance ? 'Watch' : 'Supports',
        tone: peakPrecip >= preferences.maxPrecipChance ? 'caution' : 'positive',
        icon: <CloudRain size={16} aria-hidden />,
      };

  const windTone: BriefSignalTone = peakGust >= maxGustMph * 0.7 ? 'caution' : 'positive';
  const windSignal: BriefSignal = {
    title: 'Ridgetop wind',
    detail: Number.isFinite(firstGust)
      ? `Gusts build from ${formatWindDisplay(firstGust)} to a peak of ${formatWindDisplay(peakGust)}; your limit is ${formatWindDisplay(maxGustMph)}.`
      : `Peak gust is ${formatWindDisplay(peakGust)}; your limit is ${formatWindDisplay(maxGustMph)}.`,
    tag: windTone === 'caution' ? 'Watch' : 'Supports',
    tone: windTone,
    icon: <Wind size={16} aria-hidden />,
  };

  const avalanche = safetyData.avalanche;
  const avalancheProblem = avalanche?.problems?.[0];
  const avalancheRelevant = Boolean(avalanche && avalanche.relevant !== false);
  const avalancheSignal: BriefSignal = avalancheRelevant
    ? {
        title: avalancheProblem?.name ? `Avalanche: ${avalancheProblem.name}` : 'Avalanche problem',
        detail: compactText(
          avalanche?.relevanceReason
            || avalancheProblem?.problem_description
            || avalancheProblem?.discussion
            || avalanche?.bottomLine,
          avalanche?.dangerUnknown
            ? 'Danger is unknown for this objective; verify the current bulletin before entering avalanche terrain.'
            : `${avalanche?.risk || 'Current danger'} for the selected objective and time.`,
        ),
        tag: avalanche?.dangerUnknown ? 'Verify' : Number(avalanche?.dangerLevel) >= 2 || avalancheProblem ? 'Watch' : 'Supports',
        tone: avalanche?.dangerUnknown ? 'neutral' : Number(avalanche?.dangerLevel) >= 2 || avalancheProblem ? 'caution' : 'positive',
        icon: <TriangleAlert size={16} aria-hidden />,
      }
    : {
        title: safetyData.alerts?.activeCount ? 'Active weather alerts' : 'Weather alerts',
        detail: safetyData.alerts?.activeCount
          ? `${safetyData.alerts.activeCount} active alert${safetyData.alerts.activeCount === 1 ? '' : 's'}; highest severity is ${safetyData.alerts.highestSeverity || 'not rated'}.`
          : 'No active weather alert is currently affecting the selected travel window.',
        tag: safetyData.alerts?.activeCount ? 'Watch' : 'Supports',
        tone: safetyData.alerts?.activeCount ? 'caution' : 'positive',
        icon: safetyData.alerts?.activeCount ? <TriangleAlert size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />,
      };
  const briefSignals = [surfaceSignal, windSignal, avalancheSignal];
  const firstGatedHour = travelWindowRows.find((row) => !row.pass) || null;
  const bestWindow = travelWindowInsights.bestWindow;
  const aiBriefSections = formatAiBriefSections(aiBriefNarrative);
  const hasSavedChat = reportChatMessages.length > 0;
  const showAiSection = Boolean(
    aiBriefNarrative
    || hasSavedChat
    || (!readOnly && (aiAvailability.aiBrief || aiAvailability.reportChat)),
  );
  const previousScore = previousSafetyData ? Math.round(previousSafetyData.safety.score) : null;
  const currentAlertCount = Number(safetyData.alerts?.activeCount) || 0;
  const previousAlertCount = Number(previousSafetyData?.alerts?.activeCount) || 0;
  const firstStormTime = (data: SafetyData | null): string | null => data?.weather.trend?.find((point) =>
    /thunder|lightning|hail|tornado|convective/i.test(point.condition || ''),
  )?.time || null;
  const currentStormTime = firstStormTime(safetyData);
  const previousStormTime = firstStormTime(previousSafetyData);
  const recheckChanges: string[] = [];
  if (previousScore !== null && previousScore !== score) {
    recheckChanges.push(`Safety score ${score > previousScore ? 'improved' : 'fell'} ${Math.abs(score - previousScore)} points.`);
  }
  if (previousSafetyData && currentAlertCount !== previousAlertCount) {
    recheckChanges.push(`${currentAlertCount > previousAlertCount ? 'New' : 'Fewer'} official alerts: ${currentAlertCount} active now.`);
  }
  if (previousSafetyData && currentStormTime !== previousStormTime) {
    recheckChanges.push(currentStormTime
      ? `First thunderstorm signal is now ${formatClockForStyle(currentStormTime, preferences.timeStyle)}${previousStormTime ? ` (was ${formatClockForStyle(previousStormTime, preferences.timeStyle)})` : ''}.`
      : 'The prior thunderstorm signal is no longer present in the selected window.');
  }
  if (previousSafetyData && Math.round(previousSafetyData.weather.windGust) !== Math.round(safetyData.weather.windGust)) {
    recheckChanges.push(`Start-time gust changed from ${formatWindDisplay(previousSafetyData.weather.windGust)} to ${formatWindDisplay(safetyData.weather.windGust)}.`);
  }
  const saveFieldBrief = () => {
    downloadFieldBrief(buildFieldBrief({
      objectiveName,
      forecastDate,
      startTime: planStartTime,
      returnTime: returnLabel,
      travelWindowHours,
      activity: preferences.defaultActivity,
      safetyData,
      decision,
      actionLine: decisionActionLine,
      gpxRoute: importedGpxRoute,
    }));
    setFieldBriefSaved(true);
    if (fieldBriefTimer.current !== null) window.clearTimeout(fieldBriefTimer.current);
    fieldBriefTimer.current = window.setTimeout(() => setFieldBriefSaved(false), 2200);
  };
  const handleEmailReport = async () => {
    if (emailState === 'sending' || !reportSnapshot) return;
    if (!onRequestReportEmailAccess()) return;
    if (!account.user?.emailVerified) {
      setEmailState('error');
      setEmailMessage('Verify your account email before sending reports.');
      return;
    }
    setEmailState('sending');
    setEmailMessage('');
    try {
      const message = await sendReportEmail(reportSnapshot);
      setEmailState('sent');
      setEmailMessage(message);
      if (emailStatusTimer.current !== null) window.clearTimeout(emailStatusTimer.current);
      emailStatusTimer.current = window.setTimeout(() => {
        setEmailState('idle');
        setEmailMessage('');
      }, 5000);
    } catch (error) {
      setEmailState('error');
      setEmailMessage(error instanceof Error ? error.message : 'Could not send this report by email.');
    }
  };

  return (
    <div className="ssr-dash">
      <section className={`ssr-card ssr-dash-risk ${lvClass}`} aria-labelledby="conditions-brief-title">
        <header className="ssr-dash-brief-head">
          <div>
            <span className="ssr-dash-eyebrow">Conditions brief</span>
            <h2 id="conditions-brief-title">{objectiveName || 'Objective'}</h2>
            <p>Planned travel window · {travelWindowLabel}</p>
          </div>
          <div
            className="ssr-dash-score"
            role="meter"
            aria-label={`Safety score ${score} out of 100`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            style={{ '--brief-score-color': scoreColor } as CSSProperties}
          >
            <b>{score}</b><span>/ 100</span>
          </div>
        </header>

        <div className="ssr-dash-verdict">
          <div className="ssr-dash-verdict-meta">
            <span className="ssr-dash-status"><ShieldCheck size={16} aria-hidden /> {decision.level.replace('-', ' ')}</span>
            {statusMeta && <span className="ssr-dash-confidence">{statusMeta}</span>}
          </div>
          <h3>{decision.headline}</h3>
          <p>{localizeUnitText(verdictSummary)}</p>
        </div>

        <dl className="ssr-dash-decision-strip" aria-label="Field timing decisions">
          <div>
            <dt>Best clean stretch</dt>
            <dd>{bestWindow ? `${formatClockForStyle(bestWindow.start, preferences.timeStyle)}–${formatClockForStyle(bestWindow.end, preferences.timeStyle)}` : 'No clean stretch identified'}</dd>
          </div>
          <div className={firstGatedHour ? 'is-warning' : ''}>
            <dt>First gated hour</dt>
            <dd>{firstGatedHour ? `${formatClockForStyle(firstGatedHour.time, preferences.timeStyle)} · ${firstGatedHour.failedRuleLabels[0] || firstGatedHour.condition}` : 'None in selected window'}</dd>
          </div>
          <div>
            <dt>Expected return</dt>
            <dd>{returnLabel || 'Set a back-by time'}{returnExtendsPastMidnight ? ' +1 day' : ''}</dd>
          </div>
        </dl>

        <div className={`ssr-dash-recheck ${previousSafetyData && recheckChanges.length > 0 ? 'changed' : ''}`} role="status">
          <div>
            <strong>{previousSafetyData ? (recheckChanges.length > 0 ? 'Changed since your generated report' : 'No material change since your generated report') : 'Offline generated report available on this device'}</strong>
            <span>{previousSafetyData ? 'Use these deltas for the trailhead re-check.' : `Generated ${generatedAge || 'just now'}; refresh from the plan controls before starting.`}</span>
          </div>
          {recheckChanges.length > 0 && <ul>{recheckChanges.slice(0, 3).map((change) => <li key={change}>{change}</li>)}</ul>}
        </div>

        <div className="ssr-dash-field-actions" aria-label="Report actions">
          {readOnly && (
            <button type="button" onClick={onNewReport}>
              <PencilLine size={15} aria-hidden /> New report
            </button>
          )}
          <button type="button" onClick={saveFieldBrief}>
            <Download size={15} aria-hidden /> {fieldBriefSaved ? 'Field brief downloaded' : 'Download field brief'}
          </button>
          <button type="button" onClick={handleEmailReport} disabled={!reportSnapshot || emailState === 'sending'}>
            {emailState === 'sending'
              ? <LoaderCircle size={15} className="spin" aria-hidden />
              : <Mail size={15} aria-hidden />}
            {emailState === 'sending'
              ? 'Sending report…'
              : emailState === 'sent'
                ? 'Report sent'
                : 'Send this report to my email'}
          </button>
          <button type="button" onClick={() => window.print()}>
            <Printer size={15} aria-hidden /> Print report
          </button>
          <span
            role={emailState === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={emailState === 'error' ? 'is-error' : undefined}
          >
            {emailMessage || (fieldBriefSaved ? 'Polished offline field brief downloaded.' : '')}
          </span>
        </div>

        {travelWindowRows.length > 0 && (
          <div className="ssr-dash-window">
            <div className="ssr-dash-window-labels" aria-hidden>
              <span>Your travel window</span>
              <div style={{ gridTemplateColumns: `repeat(${timelineLabelIndices.length}, 1fr)` }}>
                {timelineLabelIndices.map((index) => (
                  <b key={`${travelWindowRows[index].time}-${index}`}>{formatClockForStyle(travelWindowRows[index].time, preferences.timeStyle)}</b>
                ))}
              </div>
            </div>
            <div
              className="ssr-dash-window-band"
              style={{ gridTemplateColumns: `repeat(${travelWindowRows.length}, minmax(4px, 1fr))` }}
              role="img"
              aria-label={`${travelWindowInsights.passHours} of ${travelWindowRows.length} forecast hours stay within your limits.`}
            >
              {travelWindowRows.map((row, index) => {
                const bandTone = row.pass
                  ? 'good'
                  : row.lightningRisk || row.failedRules.length > 1 || row.gust >= maxGustMph
                    ? 'poor'
                    : 'fair';
                return <span key={`${row.time}-${index}`} className={bandTone} title={`${formatClockForStyle(row.time, preferences.timeStyle)}: ${row.reasonSummary}`} />;
              })}
              {sunrisePosition !== null && <i className="sunrise-marker" style={{ left: `${sunrisePosition}%` }} />}
              {gustMarkerPosition !== null && <i className="wind-marker" style={{ left: `${gustMarkerPosition}%` }} />}
            </div>
            <div className="ssr-dash-window-markers">
              <span><Sunrise size={14} aria-hidden /> Sunrise {formatClockForStyle(safetyData.solar.sunrise, preferences.timeStyle)}</span>
              {gustMarkerRow && <span><Wind size={14} aria-hidden /> Gusts build {formatClockForStyle(gustMarkerRow.time, preferences.timeStyle)}</span>}
            </div>
          </div>
        )}

        <div className="ssr-dash-signals" aria-label="Key planning signals">
          {briefSignals.map((signal) => (
            <div className="ssr-dash-signal" key={signal.title}>
              <span className={signal.tone}>{signal.icon}</span>
              <p><strong>{signal.title}</strong><small>{localizeUnitText(signal.detail)}</small></p>
              <b>{signal.tag}</b>
            </div>
          ))}
        </div>

        {decisionActionLine && (
          <div className="ssr-dash-recco">
            <Compass size={19} aria-hidden />
            <p><b>Plan adjustment</b><span>{localizeUnitText(decisionActionLine)}</span></p>
          </div>
        )}

        {(confidence !== null || pleasantnessScore !== null) && (
          <div className="ssr-dash-context-grid">
            {confidence !== null && (
              <details className="ssr-dash-context-card confidence">
                <summary>
                  <span><Database size={16} aria-hidden /> Evidence confidence</span>
                  <strong>{confidenceLabel} · {confidence}%</strong>
                </summary>
                {Array.isArray(safetyData.safety.confidenceReasons) && safetyData.safety.confidenceReasons.length > 0
                  ? <ul>{safetyData.safety.confidenceReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                  : <p>How completely the expected source data supports this score.</p>}
              </details>
            )}
            {pleasantnessScore !== null && (
              <details className={`ssr-dash-context-card pleasantness ${pleasantnessTone}`}>
                <summary>
                  <span><Sun size={16} aria-hidden /> Comfort outlook</span>
                  <strong>{pleasantness?.label || 'Rated'} · {pleasantnessScore}/100</strong>
                </summary>
                {pleasantness?.summary && <p>{pleasantness.summary}</p>}
                {Array.isArray(pleasantness?.factors) && pleasantness.factors.length > 0 && (
                  <ul>
                    {pleasantness.factors.map((factor) => (
                      <li key={factor.factor}><b>{factor.factor}: {Math.round(factor.score)}/100.</b> {factor.message}</li>
                    ))}
                  </ul>
                )}
                {pleasantness?.disclaimer && <small>{pleasantness.disclaimer}</small>}
              </details>
            )}
          </div>
        )}

        {showAiSection && (
          <div className="ssr-dash-ai">
            {(aiBriefNarrative || (!readOnly && aiAvailability.aiBrief)) && (aiBriefNarrative ? (
              <AiInsightBriefing
                title="Your field briefing"
                subtitle="The quick read on what matters most for this plan."
                sections={aiBriefSections}
                formatText={localizeUnitText}
              />
            ) : aiBriefError ? (
              <div className="ssr-dash-ai-error">
                <span>{aiBriefError}</span>
                <button type="button" className="ssr-dash-ai-btn" onClick={onRequestAiBrief}>
                  <Sparkles size={14} aria-hidden /> Retry AI analysis
                </button>
              </div>
            ) : (
              <button type="button" className="ssr-dash-ai-btn" onClick={onRequestAiBrief} disabled={aiBriefLoading}>
                {aiBriefLoading
                  ? <><LoaderCircle size={14} className="spin" aria-hidden /> Generating…</>
                  : <><Sparkles size={14} aria-hidden /> AI analysis</>}
              </button>
            ))}
            {(hasSavedChat || (!readOnly && aiAvailability.reportChat)) && (
              <ReportChat
                key={reportChatSessionKey}
                readOnly={readOnly}
                reportPayload={rawReportPayload}
                initialMessages={reportChatMessages}
                onMessagesChange={onReportChatMessagesChange}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
