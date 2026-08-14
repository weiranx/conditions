import {
  ArrowLeft,
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
import { useState, type CSSProperties, type ReactNode } from 'react';
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

interface DashboardDetailMetric {
  label: string;
  value: string;
  note?: string;
  tone?: LedTone;
}

function DashboardDetailMetrics({ items }: { items: DashboardDetailMetric[] }) {
  return (
    <dl className="ssr-console-detail-metrics">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `is-${item.tone}` : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.note && <span>{item.note}</span>}
        </div>
      ))}
    </dl>
  );
}

function DashboardDetailList({
  title,
  items,
  empty,
  ordered = false,
}: {
  title: string;
  items: string[];
  empty: string;
  ordered?: boolean;
}) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <section className="ssr-console-detail-section">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <List>
          {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </List>
      ) : <p className="ssr-console-detail-empty">{empty}</p>}
    </section>
  );
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
  formatTempDisplay,
  formatWindDisplay,
  formatClock,
}: ReportConsoleProps) {
  const [activeDetail, setActiveDetail] = useState<ConsoleDetailSection | null>(null);

  const openDetail = (key: string, title: string) => {
    setActiveDetail({ key, label: title });
  };
  const closeDetail = () => {
    setActiveDetail(null);
  };
  const detailHandlers = (key: string, title: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `Open ${title} Dashboard view`,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: () => openDetail(key, title),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(key, title);
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

  const formatInches = (value: number | null | undefined) => (
    typeof value === 'number' && Number.isFinite(value) ? `${value >= 10 ? Math.round(value) : value.toFixed(1)} in` : '—'
  );
  const bestWindowLabel = travelWindowInsights.bestWindow
    ? `${formatClock(travelWindowInsights.bestWindow.start)}–${formatClock(travelWindowInsights.bestWindow.end)}`
    : 'None';
  const failedChecks = decision.checks.filter((check) => !check.ok);
  const passedChecks = decision.checks.filter((check) => check.ok);
  const hourlyDetail = (
    <div className="ssr-console-detail-hours" aria-label="Hourly conditions in the selected window">
      {travelWindowRows.map((row, index) => {
        const tone = row.pass
          ? 'ok'
          : row.lightningRisk || row.failedRules.length > 1 || row.gust >= maxGustMph
            ? 'bad'
            : 'warn';
        return (
          <article key={`${row.time}-detail-${index}`} className={`is-${tone}`}>
            <header>
              <strong>{formatClock(row.time)}</strong>
              <span>{row.pass ? 'Within limits' : row.exposureClass || 'Check'}</span>
            </header>
            <dl>
              <div><dt>Temp</dt><dd>{formatTempDisplay(row.temp)}</dd></div>
              <div><dt>Feels</dt><dd>{formatTempDisplay(row.feelsLike)}</dd></div>
              <div><dt>Gust</dt><dd>{formatWindDisplay(row.gust)}</dd></div>
              <div><dt>Precip</dt><dd>{Math.round(row.precipChance)}%</dd></div>
            </dl>
            <p>{row.reasonSummary}</p>
          </article>
        );
      })}
    </div>
  );

  const renderDetailContent = (key: string): ReactNode => {
    switch (key) {
      case 'decision':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Decision', value: decision.level.replace('-', ' '), tone: levelTone },
              { label: 'Safety score', value: `${score}/100`, note: tier },
              { label: 'Evidence', value: confidence !== null ? `${confidence}%` : 'Unrated' },
              { label: 'Source readiness', value: sourceReadiness, tone: sourceTone },
            ]} />
            <div className="ssr-console-detail-columns">
              <DashboardDetailList title="Blockers" items={decision.blockers} empty="No hard blockers are active." />
              <DashboardDetailList title="Cautions" items={decision.cautions} empty="No modeled cautions are active." />
            </div>
            <DashboardDetailList
              title="Why the model landed here"
              items={safetyData.safety.explanations || []}
              empty="No additional score explanation was supplied."
            />
          </>
        );
      case 'actions':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Plan adjustments', value: String(actions.length), tone: actions.length ? 'warn' : 'ok' },
              { label: 'Checks needing action', value: String(failedChecks.length), tone: failedChecks.length ? 'warn' : 'ok' },
              { label: 'Travel window', value: `${travelWindowInsights.passHours}/${travelWindowRows.length} clear` },
              { label: 'Decision', value: decision.level.replace('-', ' '), tone: levelTone },
            ]} />
            <DashboardDetailList title="Carry into the plan" items={actions.map((action) => `${action.tag}: ${action.title}`)} empty="No threshold-driven adjustment is active." ordered />
            <DashboardDetailList title="Field checks" items={failedChecks.map((check) => check.action || check.detail || check.label)} empty="All modeled checks currently pass." />
          </>
        );
      case 'checks':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Passing', value: `${passedChecks.length}/${decision.checks.length}`, tone: failedChecks.length ? 'warn' : 'ok' },
              { label: 'Needs attention', value: String(failedChecks.length), tone: failedChecks.length ? 'bad' : 'ok' },
              { label: 'Source issues', value: String(sourceHealth.issues), tone: sourceTone },
              { label: 'Evidence confidence', value: confidence !== null ? `${confidence}%` : 'Unrated' },
            ]} />
            <div className="ssr-console-detail-columns">
              <DashboardDetailList title="Needs attention" items={failedChecks.map((check) => `${check.label}: ${check.action || check.detail || 'Review before committing.'}`)} empty="No checks need attention." />
              <DashboardDetailList title="Passing checks" items={passedChecks.map((check) => check.label)} empty="No passing checks were reported." />
            </div>
          </>
        );
      case 'score':
        return (
          <>
            <div className="ssr-console-detail-score">
              <div className={`ssr-console-dial ${score >= 100 ? 'is-three-digit' : ''}`} role="meter" aria-label={`Safety score ${score} out of 100`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} style={{ '--brief-score-color': scoreColor, '--brief-score-pct': score } as CSSProperties}>
                <b>{score}</b><span>/ 100</span>
              </div>
              <div>
                <span className={`ssr-console-chip ${levelTone}`}><ShieldCheck size={12} aria-hidden /> {decision.level.replace('-', ' ')}</span>
                <h4>{tier}</h4>
                <p>{confidence !== null ? `${confidence}% evidence confidence` : 'Evidence confidence is unrated.'}{generatedAge ? ` · Updated ${generatedAge}` : ''}</p>
              </div>
            </div>
            <DashboardDetailList title="Score explanation" items={safetyData.safety.explanations || []} empty="No score explanation was supplied." />
            <DashboardDetailList title="Weighted factors" items={(safetyData.safety.factors || []).map((factor) => `${factor.hazard || factor.group || 'Condition'}${typeof factor.impact === 'number' ? ` (${factor.impact > 0 ? '+' : ''}${factor.impact})` : ''}: ${factor.message || factor.source || 'Included in the score.'}`)} empty="No factor trace is available." />
          </>
        );
      case 'travel':
      case 'start-times':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Hours within limits', value: `${travelWindowInsights.passHours}/${travelWindowRows.length}`, tone: passAll ? 'ok' : travelWindowInsights.passHours === 0 ? 'bad' : 'warn' },
              { label: 'Best stretch', value: bestWindowLabel, note: travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h continuous` : undefined },
              { label: 'Trend', value: travelWindowInsights.trendLabel, note: travelWindowInsights.trendSummary },
              { label: 'Planned window', value: windowLabel, note: key === 'start-times' ? 'Current departure baseline' : undefined },
            ]} />
            {coverageShifted && <p className="ssr-console-detail-notice"><TriangleAlert size={14} aria-hidden /> Forecast rows cover {coverageStartLabel}–{coverageEndLabel}, while the plan starts at {plannedStartLabel}.</p>}
            {hourlyDetail}
          </>
        );
      case 'weather':
      case 'wind':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Conditions', value: safetyData.weather.description || 'Not reported' },
              { label: 'Temperature', value: formatTempDisplay(safetyData.weather.temp), note: `Feels ${formatTempDisplay(safetyData.weather.feelsLike ?? safetyData.weather.temp)}` },
              { label: 'Wind', value: formatWindDisplay(safetyData.weather.windSpeed), note: `${safetyData.weather.windDirection || '—'} · gust ${formatWindDisplay(peakGust)}`, tone: peakGust >= maxGustMph ? 'bad' : peakGust >= maxGustMph * .7 ? 'warn' : 'ok' },
              { label: 'Precipitation', value: `${Math.round(safetyData.weather.precipChance)}%`, note: `Humidity ${Math.round(safetyData.weather.humidity)}%` },
            ]} />
            {key === 'wind' && <p className="ssr-console-detail-notice">Your configured gust ceiling is {formatWindDisplay(maxGustMph)}. Compare every exposed hour, not only the start reading.</p>}
            {hourlyDetail}
          </>
        );
      case 'daylight':
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Sunrise', value: safetyData.solar ? formatClock(safetyData.solar.sunrise) : '—' },
              { label: 'Sunset', value: safetyData.solar ? formatClock(safetyData.solar.sunset) : '—' },
              { label: 'Available daylight', value: dayLengthLabel || '—' },
              { label: 'Planned window', value: windowLabel },
            ]} />
            <DashboardDetailList title="Daylight plan" items={[
              `Confirm the route is easy to follow around the planned ${plannedStartLabel || 'start'}.`,
              'Carry independent lighting and keep turnaround decisions tied to real progress.',
              'Recheck sunrise and sunset for the objective location before departure.',
            ]} empty="No daylight guidance available." />
          </>
        );
      case 'heat': {
        const heat = safetyData.heatRisk;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Heat risk', value: heat?.label || heatRiskLabel || 'Not rated', tone: ledTone(heatRiskTone) },
              { label: 'At start', value: formatTempDisplay(heat?.metrics?.feelsLikeF ?? safetyData.weather.feelsLike ?? safetyData.weather.temp) },
              { label: 'Peak next 12h', value: formatTempDisplay(heat?.metrics?.peakFeelsLike12hF) },
              { label: 'Humidity', value: typeof heat?.metrics?.humidity === 'number' ? `${Math.round(heat.metrics.humidity)}%` : `${Math.round(safetyData.weather.humidity)}%` },
            ]} />
            {heat?.guidance && <p className="ssr-console-detail-callout">{heat.guidance}</p>}
            <DashboardDetailList title="Why this rating" items={heat?.reasons || []} empty="No additional heat drivers were reported." />
          </>
        );
      }
      case 'precip': {
        const totals = safetyData.rainfall?.totals;
        const expected = safetyData.rainfall?.expected;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Peak hourly chance', value: `${Math.round(peakPrecip)}%`, tone: peakPrecip >= 50 ? 'warn' : 'ok' },
              { label: 'Rain past 24h', value: formatInches(totals?.rainPast24hIn ?? totals?.past24hIn) },
              { label: 'Rain past 48h', value: formatInches(totals?.rainPast48hIn ?? totals?.past48hIn) },
              { label: 'Expected in window', value: formatInches(expected?.rainWindowIn), note: `Snow ${formatInches(expected?.snowWindowIn)}` },
            ]} />
            {hourlyDetail}
            {safetyData.rainfall?.note && <p className="ssr-console-detail-callout">{safetyData.rainfall.note}</p>}
          </>
        );
      }
      case 'avalanche': {
        const avalanche = safetyData.avalanche;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Rating', value: avalancheLabel, tone: ledTone(avalancheTone) },
              { label: 'Danger level', value: typeof avalanche?.dangerLevel === 'number' && avalanche.dangerLevel > 0 ? `${avalanche.dangerLevel}/5` : '—' },
              { label: 'Forecast zone', value: avalanche?.zone || 'Not matched', note: avalanche?.center },
              { label: 'Coverage', value: avalanche?.coverageStatus?.replaceAll('_', ' ') || (avalanche?.relevant === false ? 'Not relevant' : 'Unknown') },
            ]} />
            {avalanche?.bottomLine && <p className="ssr-console-detail-callout">{avalanche.bottomLine}</p>}
            <DashboardDetailList title="Avalanche problems" items={(avalanche?.problems || []).map((problem) => [problem.name, problem.likelihood, Array.isArray(problem.location) ? problem.location.join(', ') : typeof problem.location === 'string' ? problem.location : ''].filter(Boolean).join(' · '))} empty="No avalanche problems were reported for this objective." />
            {avalanche?.advice && <p className="ssr-console-detail-notice">{avalanche.advice}</p>}
          </>
        );
      }
      case 'snowpack': {
        const snowpack = safetyData.snowpack;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Best depth', value: snowDepth || formatInches(snowpack?.nohrsc?.snowDepthIn ?? snowpack?.cdec?.snowDepthIn) },
              { label: 'SNOTEL SWE', value: formatInches(snowpack?.snotel?.sweIn), note: snowpack?.snotel?.stationName },
              { label: 'NOHRSC depth', value: formatInches(snowpack?.nohrsc?.snowDepthIn), note: snowpack?.nohrsc?.sampleCount ? `${snowpack.nohrsc.sampleCount} nearby samples` : undefined },
              { label: 'Historical', value: snowpack?.historical?.overall?.status?.replaceAll('_', ' ') || 'Unavailable', note: snowpack?.historical?.overall?.percentOfAverage ? `${Math.round(snowpack.historical.overall.percentOfAverage)}% of average` : undefined },
            ]} />
            {snowpack?.summary && <p className="ssr-console-detail-callout">{snowpack.summary}</p>}
            <DashboardDetailList title="Source notes" items={[snowpack?.snotel?.note, snowpack?.nohrsc?.note, snowpack?.cdec?.note, snowpack?.historical?.summary].filter((item): item is string => Boolean(item))} empty="No additional snowpack source notes were reported." />
          </>
        );
      }
      case 'fire': {
        const fire = safetyData.fireRisk;
        const wildfire = safetyData.localConditions?.wildfire;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Fire risk', value: fire?.label || fireRiskLabel || 'Not rated', tone: ledTone(fireRiskTone) },
              { label: 'Temperature', value: formatTempDisplay(safetyData.weather.temp) },
              { label: 'Humidity', value: `${Math.round(safetyData.weather.humidity)}%` },
              { label: 'Nearby incidents', value: typeof wildfire?.nearbyIncidentCount === 'number' ? String(wildfire.nearbyIncidentCount) : 'Unavailable' },
            ]} />
            {fire?.guidance && <p className="ssr-console-detail-callout">{fire.guidance}</p>}
            <DashboardDetailList title="Risk drivers" items={fire?.reasons || []} empty="No additional fire-weather drivers were reported." />
            <DashboardDetailList title="Nearby incidents" items={(wildfire?.incidents || []).map((incident) => `${incident.name || 'Incident'}${typeof incident.distanceKm === 'number' ? ` · ${incident.distanceKm.toFixed(1)} km away` : ''}${typeof incident.acres === 'number' ? ` · ${Math.round(incident.acres)} acres` : ''}`)} empty="No nearby incidents were returned." />
          </>
        );
      }
      case 'aqi': {
        const air = safetyData.airQuality;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'US AQI', value: typeof air?.usAqi === 'number' ? String(Math.round(air.usAqi)) : '—', note: air?.category, tone: ledTone(aqiTone) },
              { label: 'PM2.5', value: typeof air?.pm25 === 'number' ? String(Math.round(air.pm25)) : '—' },
              { label: 'PM10', value: typeof air?.pm10 === 'number' ? String(Math.round(air.pm10)) : '—' },
              { label: 'Ozone', value: typeof air?.ozone === 'number' ? String(Math.round(air.ozone)) : '—' },
            ]} />
            {air?.note && <p className="ssr-console-detail-callout">{air.note}</p>}
            <DashboardDetailList title="Observed pollutants" items={(air?.observation?.pollutants || []).map((pollutant) => `${pollutant.parameter || 'Pollutant'}: ${pollutant.aqi ?? '—'}${pollutant.category ? ` · ${pollutant.category}` : ''}`)} empty="No observed monitor pollutants were returned; the headline may be modeled." />
          </>
        );
      }
      case 'alerts': {
        const alerts = safetyData.alerts?.alerts || [];
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Active in window', value: String(alertCount), tone: alertCount ? 'warn' : 'ok' },
              { label: 'Highest severity', value: safetyData.alerts?.highestSeverity || 'None' },
              { label: 'Source status', value: safetyData.alerts?.status || 'Unknown' },
              { label: 'Decision cautions', value: String(decision.cautions.length), tone: decision.cautions.length ? 'warn' : 'ok' },
            ]} />
            <DashboardDetailList title="Official alerts" items={alerts.map((alert) => `${alert.event || alert.headline || 'Alert'}${alert.severity ? ` · ${alert.severity}` : ''}${alert.areaDesc ? ` · ${alert.areaDesc}` : ''}`)} empty="No official alerts intersect the selected window." />
            <DashboardDetailList title="Modeled cautions" items={decision.cautions} empty="No modeled cautions are active." />
          </>
        );
      }
      case 'observations': {
        const local = safetyData.localConditions;
        const observation = local?.weatherObservation;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Nearby station', value: observation?.stationName || 'Unavailable', note: typeof observation?.distanceKm === 'number' ? `${observation.distanceKm.toFixed(1)} km away` : undefined },
              { label: 'Station temp', value: formatTempDisplay(observation?.tempF) },
              { label: 'Streamflow', value: typeof local?.streamflow?.dischargeCfs === 'number' ? `${Math.round(local.streamflow.dischargeCfs)} cfs` : 'Unavailable', note: local?.streamflow?.trend },
              { label: 'Access results', value: typeof local?.access?.closedRoadCount === 'number' ? String(local.access.closedRoadCount) : 'Unavailable', note: 'Mapped roads to review' },
            ]} />
            <DashboardDetailList title="Closures and access" items={[
              ...(local?.closures?.alerts || []).map((alert) => alert.title || alert.description || 'Land-manager alert'),
              ...(local?.access?.roads || []).slice(0, 5).map((road) => `${road.name || 'Road'} · ${road.routeStatus || road.operatingLevel || 'Verify status'}`),
            ]} empty="No nearby closure or access result was returned." />
          </>
        );
      }
      case 'terrain-window': {
        const terrain = safetyData.terrainCondition;
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Surface outlook', value: terrain?.label || 'Not rated' },
              { label: 'Travel impact', value: terrain?.impact || 'Unknown', tone: terrain?.impact === 'high' ? 'bad' : terrain?.impact === 'moderate' ? 'warn' : 'ok' },
              { label: 'Confidence', value: terrain?.confidence || 'Unknown' },
              { label: 'Expected rain', value: formatInches(terrain?.signals?.expectedRainWindowIn), note: `Snow ${formatInches(terrain?.signals?.expectedSnowWindowIn)}` },
            ]} />
            {terrain?.summary && <p className="ssr-console-detail-callout">{terrain.summary}</p>}
            <DashboardDetailList title="Why this outlook" items={terrain?.reasons || []} empty="No additional terrain signals were reported." />
            {terrain?.recommendedTravel && <p className="ssr-console-detail-notice">{terrain.recommendedTravel}</p>}
          </>
        );
      }
      case 'gear': {
        const gear = (safetyData.gear || []).map((item) => typeof item === 'string' ? item : `${item.title}: ${item.detail}`);
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Recommended items', value: String(gear.length) },
              { label: 'Decision', value: decision.level.replace('-', ' '), tone: levelTone },
              { label: 'Peak gust', value: formatWindDisplay(peakGust) },
              { label: 'Peak precip', value: `${Math.round(peakPrecip)}%` },
            ]} />
            <DashboardDetailList title="Conditions-matched additions" items={gear} empty="No extra gear additions were generated; carry your normal backcountry kit." ordered />
          </>
        );
      }
      default:
        return (
          <>
            <DashboardDetailMetrics items={[
              { label: 'Decision', value: decision.level.replace('-', ' '), tone: levelTone },
              { label: 'Safety score', value: `${score}/100` },
              { label: 'Travel window', value: `${travelWindowInsights.passHours}/${travelWindowRows.length} clear` },
              { label: 'Sources', value: sourceReadiness, tone: sourceTone },
            ]} />
            <DashboardDetailList title="Dashboard briefing" items={safetyData.safety.explanations || []} empty="This Dashboard view has no additional data for the selected report." />
          </>
        );
    }
  };

  const detailSummaries: Record<string, string> = {
    decision: 'The combined go/no-go read, blockers, cautions, and the evidence behind it.',
    actions: 'The adjustments and field checks that should change the plan before departure.',
    checks: 'Every modeled gate, separated into passing checks and items needing attention.',
    score: 'A transparent view of the confidence-weighted score and the factors that shaped it.',
    travel: 'Hour-by-hour exposure across the selected travel window.',
    'start-times': 'The current departure as a timing baseline, with every hourly gate visible.',
    weather: 'Start conditions and hourly weather through the selected window.',
    wind: 'Sustained wind and gust exposure compared with your configured ceiling.',
    daylight: 'Sunrise, sunset, available light, and the timing decisions they create.',
    heat: 'Apparent temperature, humidity, peak exposure, and the modeled heat plan.',
    precip: 'Recent precipitation plus the hourly and travel-window forecast.',
    avalanche: 'Forecast coverage, danger rating, problems, and the bottom-line terrain signal.',
    snowpack: 'Nearby measurements, source agreement, and historical context.',
    fire: 'Fire-weather drivers and nearby incident context.',
    aqi: 'Air-quality headline, pollutants, and observation context.',
    alerts: 'Official alerts and modeled cautions affecting the plan.',
    observations: 'Nearby field observations, water, closures, and approach-road context.',
    'terrain-window': 'Surface conditions and the travel impact expected during this window.',
    gear: 'Conditions-matched additions to the normal backcountry kit.',
  };
  const activeNavigationKey = ({
    daylight: 'weather',
    heat: 'weather',
    wind: 'weather',
    precip: 'weather',
    fire: 'alerts',
    aqi: 'observations',
  } as Record<string, string>)[activeDetail?.key || ''] || activeDetail?.key;

  const detailView = activeDetail ? (
      <section
        className="ssr-console-detail-view"
        aria-labelledby="ssr-console-detail-heading"
      >
        <header className="ssr-console-detail-head">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={closeDetail} className="ssr-console-detail-back" aria-label="Back to Dashboard overview">
            <ArrowLeft size={16} aria-hidden /> Overview
          </button>
          <div>
            <span className="ssr-console-section-kicker">Dashboard view</span>
            <h3 id="ssr-console-detail-heading">{activeDetail.label}</h3>
            <p>{detailSummaries[activeDetail.key] || 'A focused planning view built from this report.'}</p>
          </div>
          <span className={`ssr-console-decision-pill ${levelTone}`}><i className={`ssr-console-led-dot ${levelTone}`} /> {decision.level.replace('-', ' ')}</span>
        </header>
        <div className="ssr-console-detail-layout">
          {detailSections.length > 0 && (
            <nav className="ssr-console-detail-nav" aria-label="Dashboard views">
              <span className="ssr-console-detail-nav-label">Dashboard views</span>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={closeDetail} className="ssr-console-detail-overview">
                <ArrowLeft size={13} aria-hidden /> Overview
              </button>
              {detailSections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={section.key === activeNavigationKey ? 'active' : ''}
                  aria-pressed={section.key === activeNavigationKey}
                  onClick={() => openDetail(section.key, section.label)}
                >
                  <span>{section.label}</span>
                  <i aria-hidden />
                </button>
              ))}
            </nav>
          )}
          <div className="ssr-console-detail-body">
            <div className="ssr-console-detail-content">
              {renderDetailContent(activeDetail.key)}
            </div>
            <footer className="ssr-console-detail-context" aria-label="Report context">
              <div><span>Decision</span><strong className={`is-${levelTone}`}>{decision.level.replace('-', ' ')}</strong></div>
              <div><span>Planned window</span><strong>{windowLabel}</strong></div>
              <div><span>Source readiness</span><strong className={`is-${sourceTone}`}>{sourceReadiness}</strong></div>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={closeDetail}>
                <ArrowLeft size={14} aria-hidden /> Return to overview
              </button>
            </footer>
          </div>
        </div>
      </section>
  ) : null;

  return (
    <div className={`ssr-console-stage${activeDetail ? ' is-detail' : ''}`}>
    <div
      className={`ssr-console${activeDetail ? ' is-inactive' : ''}`}
      aria-label="Conditions dashboard"
      aria-hidden={activeDetail ? true : undefined}
      inert={activeDetail ? true : undefined}
    >
      {detailSections.length > 0 && (
        <nav className="ssr-console-sections" aria-label="Dashboard views">
          <span className="ssr-console-sections-label">
            <strong>Explore report</strong>
            <small>{detailSections.length} focused views</small>
          </span>
          <div className="ssr-console-sections-list">
            {detailSections.map((section) => (
              <button key={section.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openDetail(section.key, section.label)}>
                {section.label}
              </button>
            ))}
          </div>
        </nav>
      )}
      <section className="ssr-console-mod ssr-console-verdict" aria-label="Trip decision">
        <div className="ssr-console-verdict-body">
          <div className="ssr-console-verdict-topline">
            <span className={`ssr-console-decision-pill ${levelTone}`}>
              <i className={`ssr-console-led-dot ${levelTone}`} />
              {decision.level.replace('-', ' ')}
            </span>
            <span className="ssr-console-h-meta">Planned {windowLabel}</span>
          </div>
          <div className="ssr-console-click" {...detailHandlers('decision', 'Conditions brief')}>
            <span className="ssr-console-section-kicker">Trip decision</span>
            <h3>{decision.headline}</h3>
            <p>{clampText(verdictSummary, 220)}</p>
          </div>

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
            <div className="ssr-console-action-block">
              <span className="ssr-console-section-kicker">Carry into the plan</span>
              <ol className="ssr-console-actions" aria-label="Top adjustments">
                {actions.slice(0, 3).map((action, index) => (
                  <li key={index} className="ssr-console-click" {...detailHandlers('actions', 'What to adjust')}>
                    <span className="ssr-console-action-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="ssr-console-action-title">{action.title}</span>
                    <b className={`ssr-console-action-tag ${ledTone(action.tone)}`}>{action.tag}</b>
                  </li>
                ))}
              </ol>
            </div>
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
        <div className="ssr-console-mod-h">
          <span>Safety score</span>
          <span className="ssr-console-h-meta">Confidence weighted</span>
        </div>
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
          <div className="ssr-console-score-copy">
            <span className={`ssr-console-chip ${levelTone}`}>
              <ShieldCheck size={12} aria-hidden /> {decision.level.replace('-', ' ')}
            </span>
            <strong className="ssr-console-score-tier">{tier}</strong>
            <span className="ssr-console-score-meta">
              {confidence !== null ? `${confidence}% evidence confidence` : 'Confidence unrated'}
            </span>
            {generatedAge && <span className="ssr-console-score-age">Updated {generatedAge}</span>}
          </div>
        </div>
      </section>

      {travelWindowRows.length > 0 && (
        <section className="ssr-console-mod ssr-console-window ssr-console-click" {...detailHandlers('travel', 'Travel window')}>
          <div className="ssr-console-window-head">
            <div>
              <span className="ssr-console-section-kicker">{coverageShifted ? 'Forecast coverage' : 'Travel window'}</span>
              <strong>{passAll ? 'Every forecast hour is within your limits' : `${travelWindowInsights.passHours} of ${travelWindowRows.length} forecast hours are within limits`}</strong>
            </div>
            <span className={`ssr-console-window-count ${passAll ? 'ok' : travelWindowInsights.passHours === 0 ? 'bad' : 'warn'}`}>
              {travelWindowInsights.passHours}/{travelWindowRows.length} clear
            </span>
          </div>
          <div
            className="ssr-console-window-band"
            style={{ gridTemplateColumns: `repeat(${travelWindowRows.length}, minmax(44px, 1fr))` }}
            role="img"
            aria-label={`${travelWindowInsights.passHours} of ${travelWindowRows.length} forecast hours stay within your limits.`}
          >
            {travelWindowRows.map((row, index) => {
              const tone = row.pass
                ? 'ok'
                : row.lightningRisk || row.failedRules.length > 1 || row.gust >= maxGustMph
                  ? 'bad'
                  : 'warn';
              return (
                <span key={`${row.time}-${index}`} className={tone} title={`${formatClock(row.time)}: ${row.reasonSummary}`}>
                  <i />
                  <b>{formatClock(row.time).replace(':00', '')}</b>
                </span>
              );
            })}
          </div>
          {coverageShifted && (
            <p className="ssr-console-window-gap" role="status">
              <TriangleAlert size={13} aria-hidden /> Available rows run {coverageStartLabel}–{coverageEndLabel}; the plan starts at {plannedStartLabel}.
            </p>
          )}
        </section>
      )}

      <section className="ssr-console-mod ssr-console-kpis" aria-label="Key condition readings">
        <div className="ssr-console-mod-h">
          <span>Conditions at a glance</span>
          <span className="ssr-console-h-meta">Select any card for detail</span>
        </div>
        <ul className="ssr-console-kpi-list">
          {kpis.map((kpi) => {
            const Icon = kpi.icon as (props: { size?: number; 'aria-hidden'?: boolean }) => ReactNode;
            return (
              <li key={kpi.key} className="ssr-console-kpi ssr-console-click" {...detailHandlers(kpi.detailKey, kpi.detailTitle)}>
                <span className={`ssr-console-kpi-icon ${ledTone(kpi.tone)}`} aria-hidden><Icon size={18} aria-hidden /></span>
                <span className="ssr-console-kpi-label">{kpi.label}</span>
                <span className="ssr-console-kpi-value">{kpi.value}</span>
                {kpi.sub && <span className="ssr-console-kpi-sub">{kpi.sub}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <dl className="ssr-console-foot" aria-label="Additional readings">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className={`ssr-console-fact${fact.detailKey ? ' ssr-console-click' : ''}`}
            {...(fact.detailKey ? detailHandlers(fact.detailKey, fact.detailTitle || fact.label) : {})}
          >
            <i className={`ssr-console-led-dot ${ledTone(fact.tone)}`} />
            <span>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </span>
          </div>
        ))}
        <div className="ssr-console-fact ssr-console-fact-note">
          <TriangleAlert size={12} aria-hidden />
          <span>
            <dt>Reminder</dt>
            <dd>Point-in-time snapshot — recheck official sources before departure.</dd>
          </span>
        </div>
      </dl>

    </div>
    {detailView}
    </div>
  );
}
