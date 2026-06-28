/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import {
  Mountain,
  Clock,
  Thermometer,
  Wind,
  CloudRain,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Snowflake,
  ShieldAlert,
  Radio,
} from 'lucide-react';
import type { PlannerViewProps } from './PlannerView';
import type { ElevationForecastBand } from '../../app/types';
import { DashboardSummaryCard } from './DashboardSummaryCard';

const DANGER_COLORS = [
  'var(--ssr-surface-3)',
  'var(--ssr-risk-1)',
  'var(--ssr-risk-2)',
  'var(--ssr-risk-3)',
  'var(--ssr-risk-4)',
  'var(--ssr-risk-5)',
];

function bandRisk(gustMph: number, maxGustMph: number): 'low' | 'watch' | 'high' {
  if (Number.isFinite(gustMph) && gustMph >= maxGustMph) return 'high';
  if (Number.isFinite(gustMph) && gustMph >= maxGustMph * 0.7) return 'watch';
  return 'low';
}

/* ── Elevation cross-section plot ── */
function ElevationCrossPlot({
  bands,
  maxGustMph,
  formatTempDisplay,
  formatWindDisplay,
}: {
  bands: ElevationForecastBand[];
  maxGustMph: number;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  formatWindDisplay: PlannerViewProps['formatWindDisplay'];
}) {
  const W = 900;
  const H = 230;
  const pad = { l: 50, r: 16, t: 26, b: 40 };
  const [hover, setHover] = React.useState<number | null>(null);

  const fts = bands.map((b) => b.elevationFt);
  const minFt = Math.min(...fts);
  const maxFt = Math.max(...fts);
  const rg = Math.max(1, maxFt - minFt);

  const pts = bands.map((b, i) => ({
    x: pad.l + (i / Math.max(1, bands.length - 1)) * (W - pad.l - pad.r),
    y: H - pad.b - ((b.elevationFt - minFt) / rg) * (H - pad.t - pad.b),
    b,
    i,
  }));

  let d = `M ${pad.l} ${H - pad.b}`;
  pts.forEach((p, i) => {
    if (i === 0) {
      d += ` L ${p.x} ${p.y}`;
    } else {
      const prev = pts[i - 1];
      const cx1 = prev.x + (p.x - prev.x) * 0.45;
      const cx2 = prev.x + (p.x - prev.x) * 0.55;
      d += ` C ${cx1} ${prev.y}, ${cx2} ${p.y}, ${p.x} ${p.y}`;
    }
  });
  d += ` L ${W - pad.r} ${H - pad.b} Z`;

  const ticks: Array<{ ft: number; y: number }> = [];
  const step = rg > 6000 ? 2000 : rg > 2500 ? 1000 : 500;
  const first = Math.ceil(minFt / step) * step;
  for (let ft = first; ft <= maxFt; ft += step) {
    ticks.push({ ft, y: H - pad.b - ((ft - minFt) / rg) * (H - pad.t - pad.b) });
  }

  const riskCol: Record<string, string> = {
    low: 'var(--ssr-risk-1)',
    watch: 'var(--ssr-risk-3)',
    high: 'var(--ssr-risk-4)',
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {ticks.map((t) => (
        <g key={t.ft}>
          <line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} stroke="var(--ssr-line)" strokeDasharray="2 3" />
          <text x={pad.l - 8} y={t.y + 3} textAnchor="end" fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
            {(t.ft / 1000).toFixed(t.ft % 1000 === 0 ? 0 : 1)}k
          </text>
        </g>
      ))}
      <path d={d} fill="var(--ssr-surface-3)" stroke="var(--ssr-line-strong)" strokeWidth="1" />
      {pts.map((p) => {
        const risk = bandRisk(p.b.windGust, maxGustMph);
        return (
          <g key={p.i} onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r="5" fill={riskCol[risk]} stroke="var(--ssr-surface)" strokeWidth="2" />
            <text x={p.x} y={H - pad.b + 14} textAnchor="middle" fontSize="9.5" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
              {Math.round(p.b.elevationFt).toLocaleString()}
            </text>
            <text x={p.x} y={H - pad.b + 28} textAnchor="middle" fontSize="10" fill="var(--ssr-text-2)" fontWeight="500">
              {p.b.label}
            </text>
          </g>
        );
      })}
      {hover !== null &&
        (() => {
          const p = pts[hover];
          const tx = Math.min(W - 160, Math.max(pad.l, p.x - 75));
          const ty = Math.max(4, p.y - 52);
          return (
            <g>
              <rect x={tx} y={ty} width="150" height="40" rx="4" fill="var(--ssr-surface)" stroke="var(--ssr-line-strong)" />
              <text x={tx + 10} y={ty + 15} fontSize="11" fontWeight="600" fill="var(--ssr-text)">
                {p.b.label} · {Math.round(p.b.elevationFt).toLocaleString()} ft
              </text>
              <text x={tx + 10} y={ty + 30} fontSize="10" fill="var(--ssr-text-3)" fontFamily="var(--ssr-mono)">
                {formatTempDisplay(p.b.temp)} · {formatWindDisplay(p.b.windSpeed, { includeUnit: false })}G
                {formatWindDisplay(p.b.windGust, { includeUnit: false })}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

export function RedesignView(props: PlannerViewProps) {
  const {
    safetyData,
    decision,
    preferences,
    objectiveName,
    position,
    getScoreColor,
    displayStartTime,
    returnTimeFormatted,
    returnExtendsPastMidnight,
    formatClockForStyle,
    formatTempDisplay,
    formatWindDisplay,
    formatElevationDisplay,
    decisionActionLine,
    handleReportLayoutChange,
    travelWindowRows,
    travelWindowHoursLabel,
    travelWindowInsights,
    travelWindowSummary,
    elevationForecastBands,
    objectiveElevationFt,
    avalancheRelevant,
    avalancheUnknown,
    overallAvalancheLevel,
    avalancheElevationRows,
    avalancheNotApplicableReason,
    getDangerText,
    snotelDepthDisplay,
    snotelSweDisplay,
    snotelDistanceDisplay,
    snowpackStatusLabel,
    snowpackPillClass,
    snowpackHistoricalComparisonLine,
    nwsTopAlerts,
    sourceFreshnessRows,
    formatAgeFromNow,
    localizeUnitText,
    toPlainText,
    summarizeText,
    aiBriefNarrative,
    aiBriefError,
    aiBriefLoading,
    handleRequestAiBriefAction,
  } = props;

  if (!safetyData || !decision) return null;

  const maxGustMph = preferences.maxWindGustMph || 35;

  const region = safetyData.location
    ? `${safetyData.location.lat.toFixed(4)}°, ${safetyData.location.lon.toFixed(4)}°`
    : `${position.lat.toFixed(4)}°, ${position.lng.toFixed(4)}°`;

  // ── Avalanche ──
  const avyLevel = avalancheUnknown ? 0 : overallAvalancheLevel ?? 0;
  const avyColor = DANGER_COLORS[Math.max(0, Math.min(5, avyLevel))];
  const avyProblems = (safetyData.avalanche?.problems || []).slice(0, 3);
  const avyBottomLine = safetyData.avalanche?.bottomLine ? toPlainText(safetyData.avalanche.bottomLine) : '';

  // ── Alerts/cautions ──
  const cautionItems = decision.cautions || [];
  const blockerItems = decision.blockers || [];
  const alertItems = nwsTopAlerts || [];
  const openCount = cautionItems.length + blockerItems.length + alertItems.length;

  // ── Sources ──
  const sourceState = (row: (typeof sourceFreshnessRows)[number]): string => {
    if (row.stateOverride) return row.stateOverride;
    if (row.issued == null) return 'missing';
    if (row.staleHours <= 2) return 'fresh';
    if (row.staleHours <= 12) return 'aging';
    return 'stale';
  };
  const freshCount = sourceFreshnessRows.filter((r) => ['fresh', 'ok'].includes(sourceState(r))).length;

  const bands = elevationForecastBands || [];
  const stripCols = `repeat(${Math.max(1, travelWindowRows.length)}, minmax(0, 1fr))`;

  return (
    <div className="ssr-report" role="main" aria-label="Conditions report (redesign)">
      {/* OBJECTIVE HEADER */}
      <header className="ssr-hdr">
        <div className="ssr-hdr-title">
          <span className="ssr-hdr-icon">
            <Mountain size={24} />
          </span>
          <h1>
            {objectiveName || 'Objective'}
            <span className="ssr-sub">
              {region} · {safetyData.weather.description || 'Backcountry'}
            </span>
          </h1>
        </div>
        <div className="ssr-hdr-stats">
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Elevation</div>
            <div className="ssr-v">{formatElevationDisplay(objectiveElevationFt)}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Start</div>
            <div className="ssr-v">{displayStartTime}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Window</div>
            <div className="ssr-v">{travelWindowHoursLabel}</div>
          </div>
          <div className="ssr-hdr-stat">
            <div className="ssr-k">Return</div>
            <div className="ssr-v">
              {returnTimeFormatted ? formatClockForStyle(returnTimeFormatted, preferences.timeStyle) : '—'}
              {returnExtendsPastMidnight ? <small>+1</small> : null}
            </div>
          </div>
        </div>
      </header>

      <main className="ssr-main">
        {/* VERDICT */}
        <DashboardSummaryCard
          safetyData={safetyData}
          decision={decision}
          preferences={preferences}
          objectiveName={objectiveName}
          displayStartTime={displayStartTime}
          returnTimeFormatted={returnTimeFormatted}
          returnExtendsPastMidnight={returnExtendsPastMidnight}
          formatClockForStyle={formatClockForStyle}
          getScoreColor={getScoreColor}
          formatTempDisplay={formatTempDisplay}
          formatWindDisplay={formatWindDisplay}
          decisionActionLine={decisionActionLine}
          localizeUnitText={localizeUnitText}
          travelWindowRows={travelWindowRows}
          travelWindowInsights={travelWindowInsights}
          handleReportLayoutChange={handleReportLayoutChange}
          aiBriefNarrative={aiBriefNarrative}
          aiBriefError={aiBriefError}
          aiBriefLoading={aiBriefLoading}
          onRequestAiBrief={handleRequestAiBriefAction}
        />

        {/* TRAVEL WINDOW STRIP */}
        {travelWindowRows.length > 0 && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon"><Clock size={16} /></span>
                Travel Window
              </h2>
              <span className="ssr-h-meta">
                Start {displayStartTime} · {travelWindowHoursLabel}
              </span>
            </div>
            <div className="ssr-card-b ssr-tight">
              <div className="ssr-strip-rows">
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl"><Clock size={14} /> Hour</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell hour-header">
                        {formatClockForStyle(r.time, preferences.timeStyle)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl"><Thermometer size={14} /> Temp</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell">
                        <span className="ssr-cv">{formatTempDisplay(r.temp, { includeUnit: false })}°</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl"><Wind size={14} /> Wind·Gust</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell">
                        <span className="ssr-cv">{formatWindDisplay(r.wind, { includeUnit: false })}</span>
                        <span
                          className="ssr-cv-sub"
                          style={{
                            color: r.gust >= maxGustMph ? 'var(--ssr-nogo-ink)' : 'var(--ssr-text-3)',
                            fontWeight: r.gust >= maxGustMph ? 600 : 400,
                          }}
                        >
                          G{formatWindDisplay(r.gust, { includeUnit: false })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl"><CloudRain size={14} /> Precip</div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div key={i} className="ssr-scell">
                        <span className="ssr-cv" style={{ opacity: r.precipChance === 0 ? 0.35 : 1 }}>
                          {r.precipChance === 0 ? '—' : `${Math.round(r.precipChance)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ssr-srow">
                  <div className="ssr-srow-lbl" style={{ fontWeight: 700, color: 'var(--ssr-text)' }}>
                    <CheckCircle2 size={14} /> Move OK
                  </div>
                  <div className="ssr-srow-cells" style={{ gridTemplateColumns: stripCols }}>
                    {travelWindowRows.map((r, i) => (
                      <div
                        key={i}
                        className={`ssr-scell move ${r.pass ? 'pass' : 'gate'}`}
                        title={r.reasonSummary ? localizeUnitText(r.reasonSummary) : undefined}
                      >
                        <span
                          className="ssr-cv"
                          style={{ color: r.pass ? 'var(--ssr-go-ink)' : 'var(--ssr-nogo-ink)', fontSize: 11 }}
                        >
                          {r.pass ? '✓' : '✕'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ssr-strip-foot">
                <div className="ssr-keys">
                  <span className="ssr-key">Clean</span>
                  <span className="ssr-key gate">Gated</span>
                </div>
                <span>{localizeUnitText(travelWindowSummary)}</span>
              </div>
            </div>
          </section>
        )}

        {/* ELEVATION */}
        {bands.length >= 2 && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon"><Layers size={16} /></span>
                Elevation profile
              </h2>
              <span className="ssr-h-meta">{bands.length} bands</span>
            </div>
            <div className="ssr-cross-wrap">
              <ElevationCrossPlot
                bands={bands}
                maxGustMph={maxGustMph}
                formatTempDisplay={formatTempDisplay}
                formatWindDisplay={formatWindDisplay}
              />
            </div>
            <div className="ssr-card-b ssr-tight">
              <table className="ssr-bands-table">
                <thead>
                  <tr>
                    <th>Band</th>
                    <th className="num">Elev</th>
                    <th className="num">Temp</th>
                    <th className="num">Feels</th>
                    <th className="num">Wind·Gust</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => {
                    const risk = bandRisk(b.windGust, maxGustMph);
                    return (
                      <tr key={i}>
                        <td>
                          <span className="ssr-band-name-cell">
                            <span className={`ssr-risk-pip ${risk}`} />
                            {b.label}
                          </span>
                        </td>
                        <td className="num">{formatElevationDisplay(b.elevationFt)}</td>
                        <td className="num">{formatTempDisplay(b.temp)}</td>
                        <td className="num">{formatTempDisplay(b.feelsLike)}</td>
                        <td className="num">
                          {formatWindDisplay(b.windSpeed, { includeUnit: false })}G
                          {formatWindDisplay(b.windGust, { includeUnit: false })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ssr-cross-note" style={{ padding: '0 24px 20px' }}>
              Colored pips mark relative wind hazard along the ascent. Hover any node for temp and wind.
            </p>
          </section>
        )}
      </main>

      {/* SIDEBAR */}
      <aside className="ssr-side">
        {/* AVALANCHE */}
        <section className="ssr-card">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon"><AlertTriangle size={16} /></span>
              Avalanche
            </h2>
            {safetyData.avalanche?.center && <span className="ssr-h-meta">{safetyData.avalanche.center}</span>}
          </div>
          <div className="ssr-card-b">
            {avalancheRelevant && !avalancheUnknown ? (
              <>
                <div className="ssr-avy-head">
                  <div className="ssr-avy-max">
                    <span
                      className="ssr-lv-num"
                      style={{ background: avyColor, color: avyLevel >= 4 ? 'white' : 'oklch(25% 0.08 55)' }}
                    >
                      {avyLevel || '—'}
                    </span>
                    {getDangerText(avyLevel)}
                  </div>
                  {safetyData.avalanche?.zone && <div className="ssr-avy-sub">Zone · {safetyData.avalanche.zone}</div>}
                </div>
                {avalancheElevationRows.length > 0 && (
                  <div className="ssr-avy-bands">
                    {avalancheElevationRows.map((b) => {
                      const r = b.rating ?? 0;
                      return (
                        <div className="ssr-avy-b" key={b.key}>
                          <span className="ssr-avy-b-k">{b.label}</span>
                          <span className="ssr-avy-b-scale">
                            <i style={{ ['--ssr-w' as any]: `${r * 20}%`, ['--ssr-c' as any]: DANGER_COLORS[Math.max(0, Math.min(5, r))] }} />
                          </span>
                          <span className="ssr-avy-b-v">{r ? getDangerText(r) : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {avyProblems.length > 0 && (
                  <div className="ssr-problems">
                    {avyProblems.map((p, i) => {
                      const loc = Array.isArray(p.location) ? p.location.join(', ') : typeof p.location === 'string' ? p.location : '';
                      const size = Array.isArray(p.size) ? p.size.join('–') : p.size != null ? String(p.size) : '';
                      return (
                        <div className="ssr-problem-row" key={i}>
                          <span className="ssr-problem-name">
                            <span className="ssr-problem-dot" />
                            {p.name || 'Problem'}
                          </span>
                          {size && <span className="ssr-problem-size">{size}</span>}
                          {(p.likelihood || loc) && (
                            <span className="ssr-problem-meta">
                              {[p.likelihood, loc].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {avyBottomLine && (
                  <div className="ssr-bottom-line">
                    <b>Bottom line.</b> {summarizeText(avyBottomLine, 320)}
                  </div>
                )}
              </>
            ) : (
              <div className="ssr-empty">{avalancheNotApplicableReason || 'No avalanche forecast applies to this objective.'}</div>
            )}
          </div>
        </section>

        {/* SNOWPACK */}
        {safetyData.snowpack?.snotel && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon"><Snowflake size={16} /></span>
                Snowpack
              </h2>
              {safetyData.snowpack.snotel.stationName && (
                <span className="ssr-h-meta">{safetyData.snowpack.snotel.stationName}</span>
              )}
            </div>
            <div className="ssr-card-b">
              <div className="ssr-snow-hero">
                <span className="ssr-snow-depth">{snotelDepthDisplay}</span>
                {snowpackStatusLabel && (
                  <span className={`ssr-snow-delta ${snowpackPillClass?.includes('warn') ? 'warn' : ''}`}>
                    {snowpackStatusLabel}
                  </span>
                )}
              </div>
              <div className="ssr-snow-station">
                {[snotelDistanceDisplay, safetyData.snowpack.snotel.elevationFt != null
                  ? formatElevationDisplay(safetyData.snowpack.snotel.elevationFt)
                  : null]
                  .filter(Boolean)
                  .join(' · ')}
                {snowpackHistoricalComparisonLine ? ` · ${snowpackHistoricalComparisonLine}` : ''}
              </div>
              <div className="ssr-snow-kv">
                <span className="ssr-k">SWE</span>
                <span className="ssr-v">{snotelSweDisplay}</span>
              </div>
              {safetyData.snowpack.snotel.obsTempF != null && (
                <div className="ssr-snow-kv">
                  <span className="ssr-k">Observed temp</span>
                  <span className="ssr-v">{formatTempDisplay(safetyData.snowpack.snotel.obsTempF)}</span>
                </div>
              )}
              {safetyData.snowpack.snotel.elevationFt != null && (
                <div className="ssr-snow-kv">
                  <span className="ssr-k">Station elevation</span>
                  <span className="ssr-v">{formatElevationDisplay(safetyData.snowpack.snotel.elevationFt)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* CAUTIONS & ALERTS */}
        <section className="ssr-card">
          <div className="ssr-card-h">
            <h2>
              <span className="ssr-h-icon"><ShieldAlert size={16} /></span>
              Cautions &amp; Alerts
            </h2>
            <span className="ssr-h-meta">{openCount} open</span>
          </div>
          <div className="ssr-card-b">
            {openCount === 0 && <div className="ssr-empty">No open cautions or active alerts.</div>}
            {blockerItems.map((c, i) => (
              <div className="ssr-ac-item nogo" key={`b${i}`}>
                <span className="ssr-ac-icon"><AlertTriangle size={12} /></span>
                <div>
                  <div className="ssr-ac-text">{localizeUnitText(c)}</div>
                  <div className="ssr-ac-meta">Blocker · NO-GO</div>
                </div>
              </div>
            ))}
            {cautionItems.map((c, i) => (
              <div className="ssr-ac-item" key={`c${i}`}>
                <span className="ssr-ac-icon"><AlertTriangle size={12} /></span>
                <div>
                  <div className="ssr-ac-text">{localizeUnitText(c)}</div>
                  <div className="ssr-ac-meta">Critical check · CAUTION</div>
                </div>
              </div>
            ))}
            {alertItems.map((a: any, i: number) => (
              <div className="ssr-ac-item" key={`a${i}`}>
                <span className="ssr-ac-icon"><AlertTriangle size={12} /></span>
                <div>
                  <div className="ssr-ac-text">{a.headline || a.event || 'Weather alert'}</div>
                  <div className="ssr-ac-meta">
                    {[a.event, a.senderName || a.source].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SOURCES */}
        {sourceFreshnessRows.length > 0 && (
          <section className="ssr-card">
            <div className="ssr-card-h">
              <h2>
                <span className="ssr-h-icon"><Radio size={16} /></span>
                Sources
              </h2>
              <span className="ssr-h-meta">{freshCount}/{sourceFreshnessRows.length} fresh</span>
            </div>
            <div className="ssr-card-b">
              <div className="ssr-src-list">
                {sourceFreshnessRows.map((s, i) => (
                  <div className="ssr-src-item" key={i}>
                    <span className={`ssr-src-dot ${sourceState(s)}`} />
                    <span className="ssr-src-name">{s.label}</span>
                    <span className="ssr-src-age">{s.issued ? formatAgeFromNow(s.issued) : 'missing'}</span>
                    <span className="ssr-src-link">{s.displayValue || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
