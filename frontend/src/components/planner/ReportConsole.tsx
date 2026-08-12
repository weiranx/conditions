import {
  CloudRain,
  Flame,
  Mountain,
  Radio,
  ShieldCheck,
  Sun,
  Thermometer,
  TriangleAlert,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { SafetyData, SummitDecision, TravelWindowInsights, TravelWindowRow } from '../../app/types';
import { formatAgeFromNow } from '../../app/core';
import '../../styles/report-console.css';

export interface ConsoleAction {
  tone: string;
  tag: string;
  title: string;
}

interface ConsoleKpi {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  detailKey: string;
  detailTitle: string;
}

interface ConsoleFact {
  label: string;
  value: string;
  tone?: string;
  detailKey?: string;
  detailTitle?: string;
}

export interface ConsoleDetailSection {
  key: string;
  label: string;
}

export interface ConsoleSourceHealth {
  fresh: number;
  aging: number;
  issues: number;
  total: number;
}

export interface ReportConsoleProps {
  safetyData: SafetyData;
  decision: SummitDecision;
  verdictSummary: string;
  scoreColor: string;
  travelWindowRows: TravelWindowRow[];
  travelWindowInsights: TravelWindowInsights;
  windowLabel: string;
  actions: ConsoleAction[];
  avalancheLabel: string;
  avalancheTone: string;
  heatRiskLabel: string;
  heatRiskTone: string;
  fireRiskLabel: string;
  fireRiskTone: string;
  aqiTone: string;
  maxGustMph: number;
  sourceHealth: ConsoleSourceHealth;
  freshnessWarningSummary: string;
  detailSections: ConsoleDetailSection[];
  onOpenDetail: (key: string, title: string) => void;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatClock: (time: string) => string;
}

type LedTone = 'ok' | 'warn' | 'bad' | 'neutral';

function ledTone(tone: string | undefined): LedTone {
  const t = (tone || '').toLowerCase();
  if (/(nogo|no-go|poor|high|severe|blocked|stop|extreme)/.test(t)) return 'bad';
  if (/(caution|watch|fair|mixed|moderate|elevated|shift|pick)/.test(t)) return 'warn';
  if (/(go|good|low|positive|supports|clear)/.test(t)) return 'ok';
  return 'neutral';
}

function clampText(value: string, max = 200): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function ReportConsole({
  safetyData,
  decision,
  verdictSummary,
  scoreColor,
  travelWindowRows,
  travelWindowInsights,
  windowLabel,
  actions,
  avalancheLabel,
  avalancheTone,
  heatRiskLabel,
  heatRiskTone,
  fireRiskLabel,
  fireRiskTone,
  aqiTone,
  maxGustMph,
  sourceHealth = { fresh: 0, aging: 0, issues: 0, total: 0 },
  freshnessWarningSummary = '',
  detailSections,
  onOpenDetail,
  formatTempDisplay,
  formatWindDisplay,
  formatClock,
}: ReportConsoleProps) {
  const detailHandlers = (key: string, title: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `Open full ${title} section`,
    onClick: () => onOpenDetail(key, title),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenDetail(key, title);
      }
    },
  });
  const score = Math.round(safetyData.safety.score);
  const tier = safetyData.safety.tier || 'Conditions';
  const levelTone = ledTone(decision.level);
  const confidence = typeof safetyData.safety.confidence === 'number' ? Math.round(safetyData.safety.confidence) : null;
  const generatedAge = safetyData.generatedAt ? formatAgeFromNow(safetyData.generatedAt) : null;

  const gustValues = travelWindowRows.map((row) => row.gust).filter(Number.isFinite);
  const peakGust = gustValues.length ? Math.max(...gustValues) : safetyData.weather.windGust;
  const peakPrecip = travelWindowRows.length
    ? Math.max(...travelWindowRows.map((row) => row.precipChance).filter(Number.isFinite))
    : safetyData.weather.precipChance;

  const aqi = safetyData.airQuality?.usAqi;
  const dayLengthMatch = safetyData.solar?.dayLength?.match(/^(\d+):(\d{2})/);
  const dayLengthLabel = dayLengthMatch ? `${Number(dayLengthMatch[1])}h ${dayLengthMatch[2]}m of light` : safetyData.solar?.dayLength;
  const snotel = safetyData.snowpack?.snotel;
  const snowDepth = typeof snotel?.snowDepthIn === 'number' ? `${Math.round(snotel.snowDepthIn)} in` : null;
  const snowSwe = typeof snotel?.sweIn === 'number' ? `${snotel.sweIn.toFixed(1)} in SWE` : null;

  const kpis: ConsoleKpi[] = [
    {
      key: 'daylight',
      icon: Sun,
      label: 'Daylight',
      value: safetyData.solar ? `${formatClock(safetyData.solar.sunrise)} – ${formatClock(safetyData.solar.sunset)}` : '—',
      sub: dayLengthLabel,
      detailKey: 'daylight',
      detailTitle: 'Daylight',
    },
    {
      key: 'temp',
      icon: Thermometer,
      label: 'Temperature',
      value: formatTempDisplay(safetyData.weather.temp),
      sub: heatRiskLabel ? `Heat: ${heatRiskLabel}` : undefined,
      tone: heatRiskTone,
      detailKey: 'heat',
      detailTitle: 'Heat risk',
    },
    {
      key: 'wind',
      icon: Wind,
      label: 'Peak gust',
      value: formatWindDisplay(peakGust),
      sub: `Limit ${formatWindDisplay(maxGustMph)}`,
      tone: peakGust >= maxGustMph ? 'high' : peakGust >= maxGustMph * 0.7 ? 'watch' : 'low',
      detailKey: 'wind',
      detailTitle: 'Wind loading',
    },
    {
      key: 'fire',
      icon: Flame,
      label: 'Fire risk',
      value: fireRiskLabel || 'Not rated',
      tone: fireRiskTone,
      detailKey: 'fire',
      detailTitle: 'Fire risk',
    },
    {
      key: 'aqi',
      icon: CloudRain,
      label: 'Air quality',
      value: typeof aqi === 'number' ? `AQI ${Math.round(aqi)}` : '—',
      sub: safetyData.airQuality?.category || undefined,
      tone: aqiTone,
      detailKey: 'aqi',
      detailTitle: 'Air quality',
    },
    {
      key: 'snow',
      icon: Mountain,
      label: 'Snowpack',
      value: snowDepth || '—',
      sub: snowSwe || undefined,
      detailKey: 'snowpack',
      detailTitle: 'Snowpack',
    },
  ];

  const alertCount = Number(safetyData.alerts?.activeCount) || 0;
  const plannedStartLabel = windowLabel.split('–')[0]?.trim();
  const coverageStartLabel = travelWindowRows.length > 0 ? formatClock(travelWindowRows[0].time) : null;
  const coverageEndLabel = travelWindowRows.length > 0 ? formatClock(travelWindowRows[travelWindowRows.length - 1].time) : null;
  const coverageShifted = Boolean(coverageStartLabel && plannedStartLabel && coverageStartLabel !== plannedStartLabel);
  const facts: ConsoleFact[] = [
    { label: 'Avalanche', value: avalancheLabel, tone: avalancheTone, detailKey: 'avalanche', detailTitle: 'Avalanche' },
    { label: 'Alerts', value: alertCount ? `${alertCount} active` : 'None', tone: alertCount ? 'watch' : 'low', detailKey: 'alerts', detailTitle: 'Cautions & alerts' },
    { label: 'Peak precip', value: `${Math.round(peakPrecip)}%`, tone: peakPrecip >= 50 ? 'watch' : 'low', detailKey: 'precip', detailTitle: 'Precipitation' },
    {
      label: 'Travel window',
      value: coverageShifted
        ? `${travelWindowRows.length} forecast hrs`
        : `${travelWindowInsights.passHours}/${travelWindowRows.length} hrs clear`,
      tone: coverageShifted ? 'watch' : travelWindowInsights.passHours === 0 ? 'high' : travelWindowInsights.passHours === travelWindowRows.length ? 'low' : 'watch',
      detailKey: 'travel',
      detailTitle: 'Travel window',
    },
  ];

  const passAll = travelWindowInsights.passHours === travelWindowRows.length && travelWindowRows.length > 0;
  const sourceTone: LedTone = sourceHealth.issues > 0 ? 'bad' : sourceHealth.aging > 0 ? 'warn' : 'ok';
  const sourceReadiness = sourceHealth.issues > 0
    ? 'Verify before committing'
    : sourceHealth.aging > 0
      ? 'Mostly current'
      : 'Sources current';
  const sourceDetail = sourceHealth.issues > 0 && freshnessWarningSummary
    ? freshnessWarningSummary
    : `${sourceHealth.fresh} current${sourceHealth.aging > 0 ? ` · ${sourceHealth.aging} aging` : ''}`;

  return (
    <div className="ssr-console" aria-label="Conditions dashboard">
      {/* Verdict + window + actions */}
      <section className="ssr-console-mod ssr-console-verdict" aria-label="Verdict and travel window">
        <div className="ssr-console-mod-h"><span>Verdict</span><span className="ssr-console-h-meta">Plan {windowLabel}</span></div>
        <div className="ssr-console-verdict-body">
          <div className="ssr-console-click" {...detailHandlers('decision', 'Conditions brief')}>
            <h3>{decision.headline}</h3>
            <p>{clampText(verdictSummary, 220)}</p>
          </div>

          {travelWindowRows.length > 0 && (
            <div className="ssr-console-window ssr-console-click" {...detailHandlers('travel', 'Travel window')}>
              <div className="ssr-console-window-label">
                <span>{coverageShifted ? 'Forecast coverage' : 'Travel window'}</span>
                <b className={passAll ? 'ok' : travelWindowInsights.passHours === 0 ? 'bad' : 'warn'}>
                  {travelWindowInsights.passHours}/{travelWindowRows.length} forecast hrs within limits
                </b>
              </div>
              <div
                className="ssr-console-window-band"
                style={{ gridTemplateColumns: `repeat(${travelWindowRows.length}, minmax(3px, 1fr))` }}
                role="img"
                aria-label={`${travelWindowInsights.passHours} of ${travelWindowRows.length} forecast hours stay within your limits.`}
              >
                {travelWindowRows.map((row, index) => {
                  const tone = row.pass
                    ? 'ok'
                    : row.lightningRisk || row.failedRules.length > 1 || row.gust >= maxGustMph
                      ? 'bad'
                      : 'warn';
                  return <span key={`${row.time}-${index}`} className={tone} title={`${formatClock(row.time)}: ${row.reasonSummary}`} />;
                })}
              </div>
              <div
                className="ssr-console-window-hours"
                aria-hidden
                style={{ gridTemplateColumns: `repeat(${travelWindowRows.length}, minmax(3px, 1fr))` }}
              >
                {travelWindowRows.map((row, index) => (
                  <span key={`${row.time}-h-${index}`}>{formatClock(row.time).replace(':00', '')}</span>
                ))}
              </div>
              {coverageShifted && (
                <p className="ssr-console-window-gap" role="status">
                  <TriangleAlert size={11} aria-hidden /> Available rows run {coverageStartLabel}–{coverageEndLabel}; the plan starts at {plannedStartLabel}.
                </p>
              )}
            </div>
          )}

          {sourceHealth.total > 0 && (
            <div className={`ssr-console-readiness ${sourceTone}`} role="status">
              <span className="ssr-console-readiness-icon" aria-hidden><Radio size={14} /></span>
              <span className="ssr-console-readiness-copy">
                <span>Source readiness</span>
                <strong>{sourceReadiness}</strong>
              </span>
              <span className="ssr-console-readiness-detail">{sourceDetail}</span>
            </div>
          )}

          {actions.length > 0 && (
            <ol className="ssr-console-actions" aria-label="Top adjustments">
              {actions.slice(0, 3).map((action, index) => (
                <li key={index} className="ssr-console-click" {...detailHandlers('actions', 'What to adjust')}>
                  <i className={`ssr-console-led-dot ${ledTone(action.tone)}`} />
                  <span className="ssr-console-action-title">{action.title}</span>
                  <b className={`ssr-console-action-tag ${ledTone(action.tone)}`}>{action.tag}</b>
                </li>
              ))}
            </ol>
          )}
          {actions.length === 0 && (
            <p className="ssr-console-allclear">
              <ShieldCheck size={13} aria-hidden /> No adjustments called for — verify sources and reassess at checkpoints.
            </p>
          )}
        </div>
      </section>

      {/* Score instrument */}
      <section
        className="ssr-console-mod ssr-console-score ssr-console-click"
        {...detailHandlers('score', 'Score breakdown')}
      >
        <div className="ssr-console-mod-h"><span>Safety score</span><i className={`ssr-console-led-dot ${levelTone}`} /></div>
        <div className="ssr-console-score-body">
          <div
            className={`ssr-console-dial ${score >= 100 ? 'is-three-digit' : ''}`}
            role="meter"
            aria-label={`Safety score ${score} out of 100`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            style={{ '--brief-score-color': scoreColor, '--brief-score-pct': score } as CSSProperties}
          >
            <b>{score}</b><span>/ 100</span>
          </div>
          <span className={`ssr-console-chip ${levelTone}`}>
            <ShieldCheck size={12} aria-hidden /> {decision.level.replace('-', ' ')}
          </span>
          <span className="ssr-console-score-tier">{tier}</span>
          <span className="ssr-console-score-meta">
            {confidence !== null ? `${confidence}% confidence` : 'Confidence unrated'}
            {generatedAge ? ` · updated ${generatedAge}` : ''}
          </span>
        </div>
      </section>

      {/* KPI stack */}
      <section className="ssr-console-mod ssr-console-kpis" aria-label="Key condition readings">
        <div className="ssr-console-mod-h">
          <span>Conditions</span>
          <span className="ssr-console-h-meta">at planned start</span>
        </div>
        <ul className="ssr-console-kpi-list">
          {kpis.map((kpi) => {
            const Icon = kpi.icon as (props: { size?: number; 'aria-hidden'?: boolean }) => ReactNode;
            return (
              <li key={kpi.key} className="ssr-console-kpi ssr-console-click" {...detailHandlers(kpi.detailKey, kpi.detailTitle)}>
                <i className={`ssr-console-led-dot ${ledTone(kpi.tone)}`} />
                <span className="ssr-console-kpi-icon" aria-hidden><Icon size={14} aria-hidden /></span>
                <span className="ssr-console-kpi-label">{kpi.label}</span>
                <span className="ssr-console-kpi-value">{kpi.value}</span>
                {kpi.sub && <span className="ssr-console-kpi-sub">{kpi.sub}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Footer fact strip */}
      <footer className="ssr-console-foot" aria-label="Additional readings">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className={`ssr-console-fact${fact.detailKey ? ' ssr-console-click' : ''}`}
            {...(fact.detailKey ? detailHandlers(fact.detailKey, fact.detailTitle || fact.label) : {})}
          >
            <i className={`ssr-console-led-dot ${ledTone(fact.tone)}`} />
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
        <div className="ssr-console-fact ssr-console-fact-note">
          <TriangleAlert size={12} aria-hidden />
          <span>Point-in-time snapshot — recheck official sources before departure.</span>
        </div>
      </footer>

      {/* Full-report section chips */}
      {detailSections.length > 0 && (
        <nav className="ssr-console-sections" aria-label="Open a full report section">
          <span className="ssr-console-sections-label">Full report</span>
          {detailSections.map((section) => (
            <button key={section.key} type="button" onClick={() => onOpenDetail(section.key, section.label)}>
              {section.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
