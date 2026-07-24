import {
  CloudRain,
  Flame,
  Mountain,
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
}

interface ConsoleFact {
  label: string;
  value: string;
  tone?: string;
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
  formatTempDisplay,
  formatWindDisplay,
  formatClock,
}: ReportConsoleProps) {
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
    },
    {
      key: 'temp',
      icon: Thermometer,
      label: 'Temperature',
      value: formatTempDisplay(safetyData.weather.temp),
      sub: heatRiskLabel ? `Heat: ${heatRiskLabel}` : undefined,
      tone: heatRiskTone,
    },
    {
      key: 'wind',
      icon: Wind,
      label: 'Peak gust',
      value: formatWindDisplay(peakGust),
      sub: `Limit ${formatWindDisplay(maxGustMph)}`,
      tone: peakGust >= maxGustMph ? 'high' : peakGust >= maxGustMph * 0.7 ? 'watch' : 'low',
    },
    {
      key: 'fire',
      icon: Flame,
      label: 'Fire risk',
      value: fireRiskLabel || 'Not rated',
      tone: fireRiskTone,
    },
    {
      key: 'aqi',
      icon: CloudRain,
      label: 'Air quality',
      value: typeof aqi === 'number' ? `AQI ${Math.round(aqi)}` : '—',
      sub: safetyData.airQuality?.category || undefined,
      tone: aqiTone,
    },
    {
      key: 'snow',
      icon: Mountain,
      label: 'Snowpack',
      value: snowDepth || '—',
      sub: snowSwe || undefined,
    },
  ];

  const alertCount = Number(safetyData.alerts?.activeCount) || 0;
  const facts: ConsoleFact[] = [
    { label: 'Avalanche', value: avalancheLabel, tone: avalancheTone },
    { label: 'Alerts', value: alertCount ? `${alertCount} active` : 'None', tone: alertCount ? 'watch' : 'low' },
    { label: 'Peak precip', value: `${Math.round(peakPrecip)}%`, tone: peakPrecip >= 50 ? 'watch' : 'low' },
    {
      label: 'Travel window',
      value: `${travelWindowInsights.passHours}/${travelWindowRows.length} hrs clear`,
      tone: travelWindowInsights.passHours === 0 ? 'high' : travelWindowInsights.passHours === travelWindowRows.length ? 'low' : 'watch',
    },
  ];

  const passAll = travelWindowInsights.passHours === travelWindowRows.length && travelWindowRows.length > 0;

  return (
    <div className="ssr-console" aria-label="Conditions dashboard">
      {/* Score instrument */}
      <section className="ssr-console-mod ssr-console-score" aria-label="Safety score">
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

      {/* Verdict + window + actions */}
      <section className="ssr-console-mod ssr-console-verdict" aria-label="Verdict and travel window">
        <div className="ssr-console-mod-h"><span>Verdict</span><span className="ssr-console-h-meta">{windowLabel}</span></div>
        <div className="ssr-console-verdict-body">
          <h3>{decision.headline}</h3>
          <p>{clampText(verdictSummary, 220)}</p>

          {travelWindowRows.length > 0 && (
            <div className="ssr-console-window">
              <div className="ssr-console-window-label">
                <span>Travel window</span>
                <b className={passAll ? 'ok' : travelWindowInsights.passHours === 0 ? 'bad' : 'warn'}>
                  {travelWindowInsights.passHours}/{travelWindowRows.length} hrs within limits
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
            </div>
          )}

          {actions.length > 0 && (
            <ol className="ssr-console-actions" aria-label="Top adjustments">
              {actions.slice(0, 3).map((action, index) => (
                <li key={index}>
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

      {/* KPI stack */}
      <section className="ssr-console-mod ssr-console-kpis" aria-label="Key condition readings">
        <div className="ssr-console-mod-h"><span>Conditions</span><span className="ssr-console-h-meta">live mix</span></div>
        <ul className="ssr-console-kpi-list">
          {kpis.map((kpi) => {
            const Icon = kpi.icon as (props: { size?: number; 'aria-hidden'?: boolean }) => ReactNode;
            return (
              <li key={kpi.key} className="ssr-console-kpi">
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
          <div key={fact.label} className="ssr-console-fact">
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
    </div>
  );
}
