import React from 'react';
import { AlertTriangle, ExternalLink, Flame, ShieldCheck } from 'lucide-react';
import type { FireRiskAlertItem, SafetyData } from '../../app/types';
import type { PlannerViewProps } from './PlannerView';
import '../../styles/fire-risk-section.css';

const FIRE_LEVELS = ['Low', 'Caution', 'Elevated', 'High', 'Extreme'] as const;

interface FireRiskSectionProps {
  level: number | null | undefined;
  label: string;
  pillClass: string;
  guidance: string;
  reasons: string[];
  alerts: FireRiskAlertItem[];
  weather: SafetyData['weather'];
  airQuality: SafetyData['airQuality'];
  wildfire: NonNullable<SafetyData['localConditions']>['wildfire'];
  source: string | null;
  formatTempDisplay: PlannerViewProps['formatTempDisplay'];
  formatWindDisplay: PlannerViewProps['formatWindDisplay'];
  localizeUnitText: PlannerViewProps['localizeUnitText'];
}

interface FireMetric {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone?: 'attention';
}

function finiteNumber(value: number | null | undefined): number | null {
  const numeric = Number(value);
  return value == null || !Number.isFinite(numeric) ? null : numeric;
}

function formatAlertExpiry(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const FireRiskSection = React.memo(function FireRiskSection({
  level,
  label,
  pillClass,
  guidance,
  reasons,
  alerts,
  weather,
  airQuality,
  wildfire,
  source,
  formatTempDisplay,
  formatWindDisplay,
  localizeUnitText,
}: FireRiskSectionProps) {
  const numericLevel = finiteNumber(level);
  const resolvedLevel = numericLevel === null ? null : Math.max(0, Math.min(4, Math.round(numericLevel)));
  const tempF = finiteNumber(weather.temp);
  const humidity = finiteNumber(weather.humidity);
  const windMph = finiteNumber(weather.windSpeed);
  const gustMph = finiteNumber(weather.windGust);
  const aqi = finiteNumber(airQuality?.usAqi);
  const incidents = Array.isArray(wildfire?.incidents) ? wildfire.incidents : [];
  const incidentCount = finiteNumber(wildfire?.nearbyIncidentCount) ?? incidents.length;
  const detectionCount = finiteNumber(wildfire?.firmsDetectionCount)
    ?? (Array.isArray(wildfire?.firmsDetections) ? wildfire.firmsDetections.length : 0);
  const nearestIncidentKm = incidents.reduce<number | null>((nearest, incident) => {
    const distance = finiteNumber(incident.distanceKm);
    if (distance === null) return nearest;
    return nearest === null || distance < nearest ? distance : nearest;
  }, null);
  const radiusKm = finiteNumber(wildfire?.searchRadiusKm);

  const metricItems: FireMetric[] = [];
  if (tempF !== null) {
    metricItems.push({
      key: 'temperature',
      label: 'Temperature',
      value: formatTempDisplay(tempF),
      detail: 'At the selected start',
      tone: tempF >= 80 ? 'attention' : undefined,
    });
  }
  if (humidity !== null) {
    metricItems.push({
      key: 'humidity',
      label: 'Relative humidity',
      value: `${Math.round(humidity)}%`,
      detail: humidity <= 30 ? 'Dry fuels can ignite and spread faster' : 'At the selected start',
      tone: humidity <= 30 ? 'attention' : undefined,
    });
  }
  if (windMph !== null || gustMph !== null) {
    const primaryWind = windMph ?? gustMph;
    metricItems.push({
      key: 'wind',
      label: 'Wind / gust',
      value: `${formatWindDisplay(primaryWind)}${gustMph !== null ? ` / ${formatWindDisplay(gustMph)}` : ''}`,
      detail: 'Stronger wind can accelerate fire spread',
      tone: (windMph ?? 0) >= 12 || (gustMph ?? 0) >= 20 ? 'attention' : undefined,
    });
  }
  if (wildfire?.available) {
    const incidentValue = incidentCount > 0 ? `${Math.round(incidentCount)} nearby` : 'None found';
    const distanceDetail = nearestIncidentKm !== null
      ? `Nearest mapped incident ${localizeUnitText(`${Math.round(nearestIncidentKm)} km away`)}`
      : `Current perimeter feed${radiusKm !== null ? ` within ${localizeUnitText(`${Math.round(radiusKm)} km`)}` : ''}`;
    metricItems.push({
      key: 'activity',
      label: 'Current fire activity',
      value: incidentValue,
      detail: detectionCount > 0 ? `${distanceDetail} · ${Math.round(detectionCount)} recent thermal detection${detectionCount === 1 ? '' : 's'}` : distanceDetail,
      tone: incidentCount > 0 || detectionCount > 0 ? 'attention' : undefined,
    });
  } else if (aqi !== null) {
    metricItems.push({
      key: 'aqi',
      label: 'Smoke signal',
      value: `AQI ${Math.round(aqi)}`,
      detail: airQuality?.category || 'US Air Quality Index',
      tone: aqi >= 101 ? 'attention' : undefined,
    });
  }

  const normalizedGuidance = guidance.trim().toLowerCase();
  const distinctReasons = reasons.filter((reason) => reason && reason.trim().toLowerCase() !== normalizedGuidance);
  const actionTone = resolvedLevel !== null && resolvedLevel >= 4 ? 'urgent' : resolvedLevel !== null && resolvedLevel >= 2 ? 'caution' : 'clear';
  const ActionIcon = actionTone === 'clear' ? ShieldCheck : AlertTriangle;

  return (
    <section className={`ssr-card ssr-fire-card ${actionTone}`}>
      <div className="ssr-card-h">
        <h2>
          <span className="ssr-h-icon icon-orange"><Flame size={16} aria-hidden /></span>
          Fire Risk
        </h2>
        <span className={`ssr-pill ${pillClass}`}>{String(label || 'Unknown').toUpperCase()}</span>
      </div>
      <div className="ssr-card-b">
        <ol
          className="ssr-fire-scale"
          aria-label={resolvedLevel === null ? 'Fire risk level unavailable' : `Fire risk: ${FIRE_LEVELS[resolvedLevel]}, level ${resolvedLevel} of 4`}
        >
          {FIRE_LEVELS.map((fireLabel, index) => (
            <li
              className={`${index === resolvedLevel ? 'active' : ''} ${resolvedLevel !== null && index < resolvedLevel ? 'passed' : ''}`.trim()}
              key={fireLabel}
              aria-current={index === resolvedLevel ? 'step' : undefined}
            >
              <span aria-hidden />
              <small>{fireLabel}</small>
            </li>
          ))}
        </ol>

        {metricItems.length > 0 && (
          <div className="ssr-fire-metrics" aria-label="Fire risk inputs">
            {metricItems.map((metric) => (
              <div className={`ssr-fire-metric ${metric.tone || ''}`.trim()} key={metric.key}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </div>
            ))}
          </div>
        )}

        <div className={`ssr-fire-action ${actionTone}`}>
          <ActionIcon size={18} aria-hidden />
          <div>
            <span>{actionTone === 'urgent' ? 'Choose another plan' : actionTone === 'caution' ? 'Recommended trip adjustment' : 'Fire plan'}</span>
            <p>{localizeUnitText(guidance)}</p>
          </div>
        </div>

        {distinctReasons.length > 0 && (
          <div className="ssr-fire-reasons">
            <h3>Why this rating</h3>
            <ul className="ssr-bullets">
              {distinctReasons.map((reason) => <li key={reason}>{localizeUnitText(reason)}</li>)}
            </ul>
          </div>
        )}

        {alerts.length > 0 && (
          <div className="ssr-fire-alerts">
            <h3>Official fire-weather alerts <span>{alerts.length}</span></h3>
            <div className="ssr-fire-alert-list">
              {alerts.map((alert, index) => {
                const expiry = formatAlertExpiry(alert.expires);
                const content = (
                  <>
                    <span className="ssr-fire-alert-icon"><Flame size={13} aria-hidden /></span>
                    <span className="ssr-fire-alert-copy">
                      <strong>{alert.event || 'Fire alert'}</strong>
                      <small>{[alert.severity && `${alert.severity} severity`, expiry && `expires ${expiry}`].filter(Boolean).join(' · ')}</small>
                    </span>
                    {alert.link && <ExternalLink size={13} aria-hidden />}
                  </>
                );
                return alert.link ? (
                  <a href={alert.link} target="_blank" rel="noreferrer" key={`${alert.event || 'alert'}-${index}`}>{content}</a>
                ) : (
                  <div key={`${alert.event || 'alert'}-${index}`}>{content}</div>
                );
              })}
            </div>
          </div>
        )}

        <p className="ssr-fire-caveat">
          {source || 'Forecast-derived estimate from fire-weather, alert, air-quality, and incident signals.'} Current incident feeds can change quickly; confirm closures and official maps before departure.
        </p>
      </div>
    </section>
  );
});
