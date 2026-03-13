import React from 'react';
import {
  ShieldCheck,
  Thermometer,
  Wind,
  CloudRain,
  AlertTriangle,
  Mountain,
  Clock,
  Route,
  Flame,
  Sun,
  Zap,
  CheckCircle2,
  Backpack,
  Radio,
} from 'lucide-react';
import { ScoreGauge } from './ScoreGauge';
import { freshnessClass, formatAgeFromNow as computeAge } from '../../app/core';
import type { PlannerViewProps } from './PlannerView';

/* ── Helpers ── */

function Pill({ text, cls }: { text: string; cls?: string }) {
  return <span className={`briefing-pill ${cls || ''}`}>{text}</span>;
}

function Kv({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="briefing-kv">
      <span className="briefing-kv-label">{label}</span>
      <span className={`briefing-kv-value ${cls || ''}`}>{value}</span>
    </div>
  );
}

function Section({
  icon,
  title,
  pill,
  pillClass,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  pill?: string;
  pillClass?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="briefing-section">
      <div className="briefing-section-header">
        <span className="briefing-section-title">{icon} {title}</span>
        {pill && <Pill text={pill} cls={pillClass} />}
      </div>
      <div className="briefing-section-body">{children}</div>
    </section>
  );
}

/* ── Main Component ── */

export function BriefingView(props: PlannerViewProps) {
  const {
    safetyData,
    decision,
    preferences,
    avalancheRelevant,
    getScoreColor,
    formatTempDisplay,
    formatWindDisplay,

    decisionActionLine,
    decisionKeyDrivers,

    weatherCardTemp,
    weatherCardFeelsLike,
    weatherCardWind,
    weatherCardWindDirection,
    weatherCardPrecip,
    weatherCardWithEmoji,
    formattedGust,
    weatherPressureTrendSummary,
    pressureTrendDirection,

    travelWindowInsights,
    travelWindowHoursLabel,
    formatTravelWindowSpan,
    travelWindowSummary,

    overallAvalancheLevel,
    avalancheUnknown,
    avalancheElevationRows,
    getDangerLevelClass,
    getDangerText,
    getDangerGlyph,
    safeAvalancheLink,

    orderedCriticalChecks,
    shouldRenderRankedCard,

    dayOverDay,

    nwsAlertCount,
    nwsTopAlerts,

    heatRiskGuidance,
    heatRiskReasons,
    heatRiskLabel,
    heatRiskPillClass,

    terrainConditionDetails,
    terrainConditionPillClass,

    precipInsightLine,
    rainfall24hDisplay,
    rainfall24hSeverityClass,
    snowfall24hDisplay,

    windLoadingHintsRelevant,
    windLoadingLevel,
    windLoadingPillClass,
    windLoadingSummary,
    windLoadingActionLine,
    leewardAspectHints,

    airQualityPillClassFn,
    airQualityFutureNotApplicable,

    snowpackInterpretation,
    snowpackStatusLabel,
    snowpackPillClass,
    snotelDepthDisplay,
    snotelSweDisplay,
    snowpackTakeaways,

    fireRiskLabel,
    fireRiskPillClass,

    displayStartTime,
    returnTimeFormatted,
    daylightRemainingFromStartLabel,

    gearRecommendations,

    sourceFreshnessRows,
    reportGeneratedAt,
    formatAgeFromNow,

    weatherVisibilityRisk,
    weatherVisibilityPill,
    weatherVisibilityDetail,
  } = props;

  if (!safetyData || !decision) return null;

  const score = safetyData.safety.score;
  const decisionColorClass = decision.level.toLowerCase().replace('-', '');
  const criticalCheckPassCount = orderedCriticalChecks.filter((c) => c.ok).length;
  const criticalCheckTotal = orderedCriticalChecks.length;
  const criticalCheckFailCount = criticalCheckTotal - criticalCheckPassCount;
  const topFactors = (safetyData.safety.factors || [])
    .filter((f) => f.impact && Math.abs(f.impact) >= 1)
    .sort((a, b) => Math.abs(b.impact!) - Math.abs(a.impact!))
    .slice(0, 4);

  return (
    <div className="briefing-layout">

      {/* ── Decision Banner ── */}
      <div className={`briefing-banner briefing-banner-${decisionColorClass}`}>
        <div className="briefing-banner-decision">
          <div className="briefing-banner-level">{decision.level}</div>
          <div className="briefing-banner-headline">{decision.headline}</div>
        </div>
        <div className="briefing-banner-score">
          <ScoreGauge score={score} scoreColor={getScoreColor(score)} size={80} />
          <span className="briefing-banner-score-label">Safety {score}</span>
        </div>
      </div>

      {/* ── Quick Metrics Strip ── */}
      <div className="briefing-metrics">
        <div className="briefing-metric">
          <span className="briefing-metric-label">Temp</span>
          <span className="briefing-metric-value">{formatTempDisplay(weatherCardTemp)}</span>
          <span className="briefing-metric-sub">Feels {formatTempDisplay(weatherCardFeelsLike)}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Wind</span>
          <span className="briefing-metric-value">{formatWindDisplay(weatherCardWind)}</span>
          <span className="briefing-metric-sub">{weatherCardWindDirection || 'Calm'} {formattedGust ? `G ${formattedGust}` : ''}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Precip</span>
          <span className="briefing-metric-value">{Number.isFinite(weatherCardPrecip) ? `${weatherCardPrecip}%` : 'N/A'}</span>
          <span className="briefing-metric-sub">24h: {rainfall24hDisplay}</span>
        </div>
        <div className="briefing-metric">
          <span className="briefing-metric-label">Travel</span>
          <span className="briefing-metric-value">{travelWindowInsights.bestWindow ? formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle) : 'None'}</span>
          <span className="briefing-metric-sub">{travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h clear` : 'No safe window'}</span>
        </div>
        {avalancheRelevant && overallAvalancheLevel != null && (
          <div className="briefing-metric">
            <span className="briefing-metric-label">Avalanche</span>
            <span className={`briefing-metric-value ${getDangerLevelClass(overallAvalancheLevel)}`}>{getDangerText(overallAvalancheLevel)}</span>
          </div>
        )}
        {nwsAlertCount > 0 && (
          <div className="briefing-metric briefing-metric-alert">
            <span className="briefing-metric-label">Alerts</span>
            <span className="briefing-metric-value nogo">{nwsAlertCount}</span>
            <span className="briefing-metric-sub">{nwsTopAlerts[0]?.event || 'Active'}</span>
          </div>
        )}
      </div>

      {/* ── Visibility Warning ── */}
      {(weatherVisibilityRisk.level === 'Moderate' || weatherVisibilityRisk.level === 'High' || weatherVisibilityRisk.level === 'Extreme') && (
        <div className={`visibility-banner visibility-banner-${weatherVisibilityPill}`}>
          Visibility risk: <strong>{weatherVisibilityRisk.level}</strong>{weatherVisibilityDetail ? ` — ${weatherVisibilityDetail}` : ''}
        </div>
      )}

      {/* ── Sections ── */}
      <div className="briefing-sections">

        {/* Decision — action line + driver chips */}
        <Section icon={<ShieldCheck size={14} />} title="Decision" pill={decision.level} pillClass={decisionColorClass}>
          <p className="briefing-body-line">{decisionActionLine}</p>
          {decisionKeyDrivers.length > 0 && (
            <div className="briefing-chip-row">
              {decisionKeyDrivers.map((d, i) => (
                <span key={i} className="briefing-chip briefing-chip-caution">{d}</span>
              ))}
            </div>
          )}
        </Section>

        {/* Weather — condition + pressure trend */}
        <Section
          icon={<Thermometer size={14} />}
          title="Weather"
          pill={safetyData.forecast?.isFuture ? 'Forecast' : 'Current'}
          pillClass={safetyData.forecast?.isFuture ? 'watch' : ''}
        >
          <p className="briefing-body-line">{weatherCardWithEmoji}</p>
          {weatherPressureTrendSummary && pressureTrendDirection && (
            <p className="briefing-body-sub">
              Pressure {pressureTrendDirection.toLowerCase()} — {weatherPressureTrendSummary}
            </p>
          )}
        </Section>

        {/* Travel Window — best window + summary */}
        <Section
          icon={<Clock size={14} />}
          title={`Travel Window (${travelWindowHoursLabel})`}
          pill={travelWindowInsights.bestWindow ? `${travelWindowInsights.bestWindow.length}h clear` : 'No window'}
          pillClass={travelWindowInsights.bestWindow ? 'go' : 'nogo'}
        >
          {travelWindowInsights.bestWindow && (
            <p className="briefing-body-line">
              Best: <strong>{formatTravelWindowSpan(travelWindowInsights.bestWindow, preferences.timeStyle)}</strong>
            </p>
          )}
          <p className="briefing-body-sub">{travelWindowSummary}</p>
        </Section>

        {/* Avalanche — elevation bands + bottom line */}
        {avalancheRelevant && (
          <Section
            icon={<Zap size={14} />}
            title="Avalanche"
            pill={avalancheUnknown ? 'Unknown' : overallAvalancheLevel != null ? getDangerText(overallAvalancheLevel) : 'Unknown'}
            pillClass={avalancheUnknown ? 'watch' : getDangerLevelClass(overallAvalancheLevel ?? undefined)}
          >
            {avalancheElevationRows.length > 0 && (
              <div className="briefing-elev-bands">
                {avalancheElevationRows.map((row, i) => (
                  <div key={i} className="briefing-elev-band">
                    <span className="briefing-elev-band-label">{row.label}</span>
                    <span className={`briefing-elev-band-danger ${getDangerLevelClass(row.rating ?? undefined)}`}>
                      {row.rating != null ? `${getDangerGlyph(row.rating)} ${getDangerText(row.rating)}` : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {safetyData.avalanche?.bottomLine && (
              <p className="briefing-body-sub">{safetyData.avalanche.bottomLine}</p>
            )}
            {safetyData.avalanche?.problems && safetyData.avalanche.problems.length > 0 && (
              <div className="briefing-chip-row">
                {safetyData.avalanche.problems.slice(0, 3).map((p, i) => (
                  <span key={i} className="briefing-chip briefing-chip-caution">{p.name || `Problem ${i + 1}`}</span>
                ))}
              </div>
            )}
            {safeAvalancheLink && (
              <a href={safeAvalancheLink} target="_blank" rel="noopener noreferrer" className="briefing-link">Full forecast →</a>
            )}
          </Section>
        )}

        {/* Critical Checks — pass/fail list */}
        {shouldRenderRankedCard('criticalChecks') && (
          <Section
            icon={<CheckCircle2 size={14} />}
            title="Critical Checks"
            pill={`${criticalCheckPassCount}/${criticalCheckTotal}`}
            pillClass={criticalCheckFailCount === 0 ? 'go' : 'caution'}
          >
            <div className="briefing-checks">
              {orderedCriticalChecks.map((c, i) => (
                <div key={i} className={`briefing-check ${c.ok ? 'briefing-check-pass' : 'briefing-check-fail'}`}>
                  <span className="briefing-check-icon">{c.ok ? '✓' : '✗'}</span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Score Breakdown — top factors */}
        {shouldRenderRankedCard('scoreTrace') && topFactors.length > 0 && (
          <Section
            icon={<ShieldCheck size={14} />}
            title="Score Breakdown"
            pill={dayOverDay ? `${dayOverDay.delta > 0 ? '+' : ''}${dayOverDay.delta} vs ${dayOverDay.previousDate}` : undefined}
            pillClass={dayOverDay ? (dayOverDay.delta <= -1 ? 'nogo' : dayOverDay.delta >= 1 ? 'go' : 'caution') : undefined}
          >
            <div className="briefing-factors">
              {topFactors.map((f, i) => (
                <div key={i} className="briefing-factor">
                  <span className="briefing-factor-name">{f.hazard || f.source || 'Unknown'}</span>
                  <span className={`briefing-factor-impact ${(f.impact ?? 0) < 0 ? 'neg' : 'pos'}`}>
                    {(f.impact ?? 0) > 0 ? '+' : ''}{f.impact}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Alerts — event + severity */}
        {nwsAlertCount > 0 && (
          <Section icon={<AlertTriangle size={14} />} title="Alerts" pill={`${nwsAlertCount} active`} pillClass="nogo">
            <div className="briefing-alerts">
              {nwsTopAlerts.slice(0, 3).map((a, i) => (
                <div key={i} className="briefing-alert">
                  <strong>{a.event}</strong>
                  {a.severity && <Pill text={a.severity} cls={a.severity === 'Extreme' || a.severity === 'Severe' ? 'nogo' : 'caution'} />}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Heat Risk — guidance + reasons */}
        {shouldRenderRankedCard('heatRisk') && (
          <Section icon={<Sun size={14} />} title="Heat Risk" pill={(heatRiskLabel || 'Low').toUpperCase()} pillClass={heatRiskPillClass}>
            <p className="briefing-body-line">{heatRiskGuidance}</p>
            {heatRiskReasons.length > 0 && (
              <ul className="briefing-short-list">
                {heatRiskReasons.slice(0, 2).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </Section>
        )}

        {/* Terrain — summary + mode + footwear */}
        {shouldRenderRankedCard('terrainTrailCondition') && terrainConditionDetails && (
          <Section
            icon={<Route size={14} />}
            title="Terrain"
            pill={safetyData.terrainCondition?.label || safetyData.trail || 'Unknown'}
            pillClass={terrainConditionPillClass}
          >
            {terrainConditionDetails.summary && <p className="briefing-body-line">{terrainConditionDetails.summary}</p>}
            <div className="briefing-kv-row">
              {terrainConditionDetails.recommendedTravel && <Kv label="Travel" value={terrainConditionDetails.recommendedTravel} />}
              {terrainConditionDetails.footwear && <Kv label="Footwear" value={terrainConditionDetails.footwear} />}
            </div>
          </Section>
        )}

        {/* Precipitation — insight + 24h totals */}
        {shouldRenderRankedCard('recentRainfall') && (
          <Section icon={<CloudRain size={14} />} title="Precipitation" pill={`24h: ${rainfall24hDisplay}`} pillClass={rainfall24hSeverityClass}>
            {precipInsightLine && <p className="briefing-body-line">{precipInsightLine}</p>}
            <div className="briefing-kv-row">
              <Kv label="Rain 24h" value={rainfall24hDisplay} />
              <Kv label="Snow 24h" value={snowfall24hDisplay} />
            </div>
          </Section>
        )}

        {/* Wind Loading — summary + action + lee aspects */}
        {(shouldRenderRankedCard('windLoading') || shouldRenderRankedCard('windLoadingHints')) && windLoadingHintsRelevant && (
          <Section icon={<Wind size={14} />} title="Wind Loading" pill={windLoadingLevel} pillClass={windLoadingPillClass}>
            <p className="briefing-body-line">{windLoadingSummary}</p>
            {windLoadingActionLine && <p className="briefing-body-sub">{windLoadingActionLine}</p>}
            {leewardAspectHints.length > 0 && (
              <div className="briefing-chip-row">
                <span className="briefing-chip-label">Lee aspects:</span>
                {leewardAspectHints.map((a) => <span key={a} className="briefing-chip">{a}</span>)}
              </div>
            )}
          </Section>
        )}

        {/* Air Quality — category + AQI */}
        {shouldRenderRankedCard('airQuality') && (
          <Section
            icon={<Wind size={14} />}
            title="Air Quality"
            pill={`AQI ${Number.isFinite(Number(safetyData.airQuality?.usAqi)) ? Math.round(Number(safetyData.airQuality?.usAqi)) : 'N/A'}`}
            pillClass={airQualityFutureNotApplicable ? 'go' : airQualityPillClassFn(safetyData.airQuality?.usAqi)}
          >
            <div className="briefing-kv-row">
              <Kv label="Category" value={safetyData.airQuality?.category || 'Unknown'} />
              {safetyData.airQuality?.pm25 != null && <Kv label="PM2.5" value={`${Math.round(safetyData.airQuality.pm25)} µg/m³`} />}
            </div>
            {safetyData.airQuality?.note && <p className="briefing-body-sub">{safetyData.airQuality.note}</p>}
          </Section>
        )}

        {/* Snowpack — interpretation + depth + takeaways */}
        {shouldRenderRankedCard('snowpackSnapshot') && (
          <Section icon={<Mountain size={14} />} title="Snowpack" pill={snowpackStatusLabel} pillClass={snowpackPillClass}>
            {snowpackInterpretation?.headline && <p className="briefing-body-line">{snowpackInterpretation.headline}</p>}
            <div className="briefing-kv-row">
              {snotelDepthDisplay && <Kv label="Depth" value={snotelDepthDisplay} />}
              {snotelSweDisplay && <Kv label="SWE" value={snotelSweDisplay} />}
            </div>
            {snowpackTakeaways.length > 0 && (
              <ul className="briefing-short-list">
                {snowpackTakeaways.slice(0, 2).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
          </Section>
        )}

        {/* Fire Risk — guidance + reasons */}
        {shouldRenderRankedCard('fireRisk') && (
          <Section icon={<Flame size={14} />} title="Fire Risk" pill={fireRiskLabel.toUpperCase()} pillClass={fireRiskPillClass}>
            <p className="briefing-body-line">{safetyData.fireRisk?.guidance || 'No fire-risk guidance available.'}</p>
            {(safetyData.fireRisk?.reasons || []).length > 0 && (
              <ul className="briefing-short-list">
                {(safetyData.fireRisk?.reasons || []).slice(0, 2).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </Section>
        )}

        {/* Daylight — start / return / remaining */}
        {shouldRenderRankedCard('planSnapshot') && (
          <Section icon={<Sun size={14} />} title="Daylight" pill={`${daylightRemainingFromStartLabel} daylight`}>
            <div className="briefing-kv-row">
              <Kv label="Start" value={displayStartTime} />
              <Kv label="Return" value={returnTimeFormatted || '—'} />
              <Kv label="Daylight left" value={daylightRemainingFromStartLabel} />
            </div>
          </Section>
        )}

        {/* Gear — category pills */}
        {shouldRenderRankedCard('recommendedGear') && gearRecommendations.length > 0 && (
          <Section icon={<Backpack size={14} />} title="Gear" pill={`${gearRecommendations.length} items`}>
            <div className="briefing-chip-row briefing-chip-row-wrap">
              {gearRecommendations.map((g, i) => (
                <span key={i} className="briefing-chip" title={g.detail || undefined}>{g.title}</span>
              ))}
            </div>
          </Section>
        )}

        {/* Source Freshness — compact list */}
        {shouldRenderRankedCard('sourceFreshness') && (
          <Section icon={<Radio size={14} />} title="Sources" pill={reportGeneratedAt ? formatAgeFromNow(reportGeneratedAt) : 'N/A'}>
            <div className="briefing-freshness">
              {sourceFreshnessRows.map((r, i) => {
                const age = r.issued ? computeAge(r.issued) : 'N/A';
                const cls = r.stateOverride || (r.issued ? freshnessClass(r.issued, r.staleHours) : 'missing');
                return (
                  <div key={i} className="briefing-freshness-row">
                    <span className="briefing-freshness-label">{r.label}</span>
                    <Pill text={r.displayValue || age} cls={cls} />
                  </div>
                );
              })}
            </div>
          </Section>
        )}

      </div>
    </div>
  );
}
