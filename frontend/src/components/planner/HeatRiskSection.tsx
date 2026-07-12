import React from 'react';
import { AlertTriangle, ShieldCheck, Sun } from 'lucide-react';
import type { HeatRiskMetrics } from '../../app/types';
import type { PlannerViewProps } from './PlannerView';
import '../../styles/heat-risk-section.css';

const HEAT_LEVELS = ['Low', 'Caution', 'Elevated', 'High', 'Extreme'] as const;

interface HeatRiskSectionProps {
  level: number | null | undefined;
  label: string;
  pillClass: string;
  guidance: string;
  reasons: string[];
  metrics: HeatRiskMetrics;
  lowerTerrainLabel: string | null;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  localizeUnitText: PlannerViewProps['localizeUnitText'];
}

interface HeatMetric {
  key: string;
  label: string;
  value: string;
  detail: string | null;
}

function finiteNumber(value: number | null | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export const HeatRiskSection = React.memo(function HeatRiskSection({
  level,
  label,
  pillClass,
  guidance,
  reasons,
  metrics,
  lowerTerrainLabel,
  formatTempDisplay,
  localizeUnitText,
}: HeatRiskSectionProps) {
  const fallbackLevel = HEAT_LEVELS.findIndex((heatLabel) => heatLabel.toLowerCase() === label.toLowerCase());
  const numericLevel = finiteNumber(level);
  const resolvedLevel = Math.max(0, Math.min(4, Math.round(numericLevel ?? Math.max(0, fallbackLevel))));

  const tempF = finiteNumber(metrics.tempF);
  const feelsLikeF = finiteNumber(metrics.feelsLikeF);
  const peakTempF = finiteNumber(metrics.peakTemp12hF);
  const peakFeelsLikeF = finiteNumber(metrics.peakFeelsLike12hF);
  const lowerTerrainTempF = finiteNumber(metrics.lowerTerrainTempF);
  const lowerTerrainFeelsLikeF = finiteNumber(metrics.lowerTerrainFeelsLikeF);
  const humidity = finiteNumber(metrics.humidity);

  const metricItems: HeatMetric[] = [];
  if (tempF !== null || feelsLikeF !== null) {
    const primary = feelsLikeF ?? tempF;
    metricItems.push({
      key: 'start',
      label: 'At selected start',
      value: formatTempDisplay(primary),
      detail: tempF !== null && feelsLikeF !== null && Math.round(tempF) !== Math.round(feelsLikeF)
        ? `Air temperature ${formatTempDisplay(tempF)}`
        : 'Forecast apparent temperature',
    });
  }
  if (peakTempF !== null || peakFeelsLikeF !== null) {
    const primary = peakFeelsLikeF ?? peakTempF;
    metricItems.push({
      key: 'peak',
      label: 'Next 12 hours',
      value: formatTempDisplay(primary),
      detail: peakTempF !== null && peakFeelsLikeF !== null && Math.round(peakTempF) !== Math.round(peakFeelsLikeF)
        ? `Peak air temperature ${formatTempDisplay(peakTempF)}`
        : 'Peak apparent temperature',
    });
  }
  if (lowerTerrainTempF !== null || lowerTerrainFeelsLikeF !== null) {
    const primary = lowerTerrainFeelsLikeF ?? lowerTerrainTempF;
    metricItems.push({
      key: 'lower-terrain',
      label: 'Warmest lower terrain',
      value: formatTempDisplay(primary),
      detail: lowerTerrainLabel || 'Approach terrain estimate',
    });
  }
  if (humidity !== null) {
    metricItems.push({
      key: 'humidity',
      label: 'Humidity',
      value: `${Math.round(humidity)}%`,
      detail: metrics.isDaytime === false ? 'Selected start is after dark' : 'At the selected start',
    });
  }

  const normalizedGuidance = guidance.trim().toLowerCase();
  const distinctReasons = reasons.filter((reason) => reason && reason.trim().toLowerCase() !== normalizedGuidance);
  const needsExtraCaution = resolvedLevel >= 2;
  const ActionIcon = needsExtraCaution ? AlertTriangle : ShieldCheck;

  return (
    <section className="ssr-card ssr-heat-card">
      <div className="ssr-card-h">
        <h2>
          <span className="ssr-h-icon icon-orange"><Sun size={16} aria-hidden /></span>
          Heat Risk
        </h2>
        <span className={`ssr-pill ${pillClass}`}>{String(label || 'Low').toUpperCase()}</span>
      </div>
      <div className="ssr-card-b">
        <ol className="ssr-heat-scale" aria-label={`Heat risk: ${HEAT_LEVELS[resolvedLevel]}, level ${resolvedLevel} of 4`}>
          {HEAT_LEVELS.map((heatLabel, index) => (
            <li
              className={`${index === resolvedLevel ? 'active' : ''} ${index < resolvedLevel ? 'passed' : ''}`.trim()}
              key={heatLabel}
              aria-current={index === resolvedLevel ? 'step' : undefined}
            >
              <span aria-hidden />
              <small>{heatLabel}</small>
            </li>
          ))}
        </ol>

        {metricItems.length > 0 && (
          <div className="ssr-heat-metrics" aria-label="Heat exposure forecast details">
            {metricItems.map((metric) => (
              <div className="ssr-heat-metric" key={metric.key}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                {metric.detail && <small>{localizeUnitText(metric.detail)}</small>}
              </div>
            ))}
          </div>
        )}

        <div className={`ssr-heat-action ${needsExtraCaution ? 'caution' : 'clear'}`}>
          <ActionIcon size={17} aria-hidden />
          <div>
            <span>{needsExtraCaution ? 'Recommended trip adjustment' : 'Heat plan'}</span>
            <p>{localizeUnitText(guidance)}</p>
          </div>
        </div>

        {distinctReasons.length > 0 && (
          <div className="ssr-heat-reasons">
            <h3>Why this rating</h3>
            <ul className="ssr-bullets">
              {distinctReasons.map((reason) => <li key={reason}>{localizeUnitText(reason)}</li>)}
            </ul>
          </div>
        )}

        <p className="ssr-heat-caveat">
          Forecast-derived estimate. Direct sun, pace, pack weight, acclimatization, and water access can increase real heat strain.
        </p>
      </div>
    </section>
  );
});
