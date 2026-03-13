import type { FreshnessState, SafetyData } from './types';
import {
  classifySnowpackFreshness,
  formatAgeFromNow,
  freshnessClass,
  pickNewestIsoTimestamp,
  pickOldestIsoTimestamp,
  resolveSelectedTravelWindowMs,
  isTravelWindowCoveredByAlertWindow,
} from './core';

export interface FreshnessRow {
  label: string;
  issued: string | null;
  staleHours: number;
  displayValue?: string;
  stateOverride?: FreshnessState;
}

export interface SourceFreshnessDisplay {
  sourceFreshnessRows: FreshnessRow[];
  staleOrMissingFreshnessRows: Array<FreshnessRow & { state: string }>;
  hasFreshnessWarning: boolean;
  freshnessWarningSummary: string;
  reportGeneratedAt: string | null;
  alertsNoActiveForSelectedTime: boolean;
  alertsWindowCovered: boolean;
  airQualityFutureNotApplicable: boolean;
}

export function buildSourceFreshnessDisplay(
  safetyData: SafetyData | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rainfallPayload: any,
  avalancheRelevant: boolean,
  travelWindowHours: number,
): SourceFreshnessDisplay {
  const alertsStatus = safetyData?.alerts?.status || null;
  const alertsNoActiveForSelectedTime = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const selectedTravelWindowMs = resolveSelectedTravelWindowMs(safetyData, travelWindowHours);
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(selectedTravelWindowMs, safetyData?.alerts?.alerts || []);
  const reportGeneratedAt = safetyData?.generatedAt || null;
  const weatherFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.weather.issuedTime || null,
        safetyData.weather.forecastStartTime || null,
      ])
    : null;
  const avalancheFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.avalanche.publishedTime || null,
      ])
    : null;
  const alertsFreshnessTimestamp = safetyData
    ? pickNewestIsoTimestamp(
        (safetyData.alerts?.alerts || []).flatMap((alert) => [
          alert.sent || null,
          alert.effective || null,
          alert.onset || null,
        ]),
      )
    : null;
  const airQualityFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        safetyData.airQuality?.measuredTime || null,
      ])
    : null;
  const airQualityStatus = String(safetyData?.airQuality?.status || '').toLowerCase();
  const airQualityFutureNotApplicable = airQualityStatus === 'not_applicable_future_date';
  const precipitationFreshnessTimestamp = safetyData
    ? pickOldestIsoTimestamp([
        rainfallPayload?.anchorTime || null,
      ])
    : null;
  const snowpackFreshness = classifySnowpackFreshness(
    safetyData?.snowpack?.snotel?.observedDate || null,
    safetyData?.snowpack?.nohrsc?.sampledTime || null,
  );
  const snowpackFreshnessTimestamp = snowpackFreshness.referenceTimestamp;
  const sourceFreshnessRows: FreshnessRow[] = safetyData
    ? [
        { label: 'Weather', issued: weatherFreshnessTimestamp, staleHours: 12 },
        ...(avalancheRelevant
          ? [
              {
                label: 'Avalanche',
                issued: avalancheFreshnessTimestamp,
                staleHours: 24,
              },
            ]
          : []),
        {
          label: 'Alerts',
          issued: alertsFreshnessTimestamp,
          staleHours: 6,
          displayValue: alertsNoActiveForSelectedTime ? 'No active' : alertsWindowCovered ? 'Window covered' : undefined,
          stateOverride: alertsNoActiveForSelectedTime || alertsWindowCovered ? ('fresh' as const) : undefined,
        },
        {
          label: 'Air Quality',
          issued: airQualityFreshnessTimestamp,
          staleHours: 8,
          displayValue: airQualityFutureNotApplicable ? 'Current-day only' : undefined,
          stateOverride: airQualityFutureNotApplicable ? ('fresh' as const) : undefined,
        },
        {
          label: 'Precipitation',
          issued: precipitationFreshnessTimestamp,
          staleHours: 8,
        },
        {
          label: 'Snowpack',
          issued: snowpackFreshnessTimestamp,
          staleHours: 30,
          displayValue: snowpackFreshness.displayValue,
          stateOverride: snowpackFreshness.state,
        },
      ]
    : [];
  const staleOrMissingFreshnessRows = sourceFreshnessRows
    .map((row) => ({
      ...row,
      state: row.stateOverride || freshnessClass(row.issued, row.staleHours),
    }))
    .filter((row) => row.state === 'stale' || row.state === 'missing');
  const hasFreshnessWarning = staleOrMissingFreshnessRows.length > 0;
  const freshnessWarningSummary = staleOrMissingFreshnessRows
    .slice(0, 3)
    .map((row) => {
      const ageLabel = row.displayValue || (row.state === 'missing' ? 'missing' : formatAgeFromNow(row.issued));
      return `${row.label}: ${ageLabel}`;
    })
    .join(' • ');

  return {
    sourceFreshnessRows,
    staleOrMissingFreshnessRows,
    hasFreshnessWarning,
    freshnessWarningSummary,
    reportGeneratedAt,
    alertsNoActiveForSelectedTime,
    alertsWindowCovered,
    airQualityFutureNotApplicable,
  };
}
