import type {
  ElevationUnit,
  SafetyData,
  SnowpackInsightBadge,
  SnowpackInterpretation,
  SnowpackSnapshotInsights,
} from './types';
import {
  convertElevationFeetToDisplayValue,
  formatCompactAge,
  formatDistanceForElevationUnit,
  formatSnowDepthForElevationUnit,
  formatSweForElevationUnit,
  parseIsoDateToUtcMs,
  parseIsoToMs,
} from './core';

export function buildSnowpackInterpretation(
  snowpack: SafetyData['snowpack'] | null | undefined,
  objectiveElevationFt: number | null | undefined,
  elevationUnit: ElevationUnit = 'ft',
): SnowpackInterpretation | null {
  const snotel = snowpack?.snotel || null;
  const nohrsc = snowpack?.nohrsc || null;
  const cdec = snowpack?.cdec || null;

  const snotelDepth = Number(snotel?.snowDepthIn);
  const nohrscDepth = Number(nohrsc?.snowDepthIn);
  const cdecDepth = Number(cdec?.snowDepthIn);
  const snotelSwe = Number(snotel?.sweIn);
  const nohrscSwe = Number(nohrsc?.sweIn);
  const cdecSwe = Number(cdec?.sweIn);
  const stationDistanceKm = Number(snotel?.distanceKm);
  const stationElevationFt = Number(snotel?.elevationFt);

  const hasSnotelDepth = Number.isFinite(snotelDepth);
  const hasNohrscDepth = Number.isFinite(nohrscDepth);
  const hasCdecDepth = Number.isFinite(cdecDepth);
  const hasSnotelSwe = Number.isFinite(snotelSwe);
  const hasNohrscSwe = Number.isFinite(nohrscSwe);
  const hasCdecSwe = Number.isFinite(cdecSwe);
  const hasAnySnowSignal =
    (hasSnotelDepth && snotelDepth > 0) ||
    (hasNohrscDepth && nohrscDepth > 0) ||
    (hasCdecDepth && cdecDepth > 0) ||
    (hasSnotelSwe && snotelSwe > 0) ||
    (hasNohrscSwe && nohrscSwe > 0) ||
    (hasCdecSwe && cdecSwe > 0);
  const maxDepthIn = Math.max(
    hasSnotelDepth ? snotelDepth : 0,
    hasNohrscDepth ? nohrscDepth : 0,
    hasCdecDepth ? cdecDepth : 0,
  );
  const maxSweIn = Math.max(
    hasSnotelSwe ? snotelSwe : 0,
    hasNohrscSwe ? nohrscSwe : 0,
    hasCdecSwe ? cdecSwe : 0,
  );
  const lowBroadSnowSignal =
    (hasSnotelDepth || hasNohrscDepth || hasCdecDepth || hasSnotelSwe || hasNohrscSwe || hasCdecSwe) &&
    maxDepthIn <= 1 &&
    maxSweIn <= 0.2;

  if (!hasSnotelDepth && !hasNohrscDepth && !hasCdecDepth && !hasSnotelSwe && !hasNohrscSwe && !hasCdecSwe) {
    return null;
  }

  let confidence: SnowpackInterpretation['confidence'] = 'solid';
  const bullets: string[] = [];

  if (hasSnotelDepth && hasNohrscDepth) {
    const baseline = Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1);
    const depthDeltaPct = (Math.abs(nohrscDepth - snotelDepth) / baseline) * 100;
    if (depthDeltaPct <= 30) {
      bullets.push('SNOTEL and NOHRSC depth are broadly aligned, so snow coverage confidence is higher.');
    } else {
      confidence = lowBroadSnowSignal ? 'solid' : 'watch';
      bullets.push('SNOTEL vs NOHRSC depth diverge significantly, indicating patchy or elevation-sensitive snow distribution.');
    }
  } else {
    confidence = lowBroadSnowSignal ? 'solid' : 'watch';
    bullets.push(
      lowBroadSnowSignal
        ? 'Only one depth source is available, but broad snow signal remains minimal.'
        : 'Only one depth source is available; treat this as directional context, not a full snowpack picture.',
    );
  }

  if (Number.isFinite(stationDistanceKm) && !lowBroadSnowSignal) {
    const stationDistanceDisplay = formatDistanceForElevationUnit(stationDistanceKm, elevationUnit);
    if (stationDistanceKm <= 10) {
      bullets.push(`Nearest SNOTEL is close (${stationDistanceDisplay}), improving local representativeness.`);
    } else if (stationDistanceKm > 25) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`Nearest SNOTEL is ${stationDistanceDisplay} away, so conditions may differ materially at your objective.`);
    }
  }

  if (Number.isFinite(stationElevationFt) && Number.isFinite(Number(objectiveElevationFt)) && !lowBroadSnowSignal) {
    const elevDelta = Math.abs(stationElevationFt - Number(objectiveElevationFt));
    if (elevDelta >= 2000) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      const displayDelta = convertElevationFeetToDisplayValue(elevDelta, elevationUnit);
      bullets.push(
        `SNOTEL station elevation differs by ~${Math.round(displayDelta).toLocaleString()} ${elevationUnit} from the objective; expect vertical snowpack variability.`,
      );
    }
  }

  const observedDateMs = parseIsoDateToUtcMs(snotel?.observedDate || null);
  if (observedDateMs !== null) {
    const ageDays = Math.max(0, Math.floor((Date.now() - observedDateMs) / (24 * 60 * 60 * 1000)));
    if (ageDays >= 3) {
      confidence = lowBroadSnowSignal ? 'watch' : 'low';
      bullets.push(
        lowBroadSnowSignal
          ? `SNOTEL observation is ${ageDays} days old; broad no-snow signal is likely still valid, but verify for shaded pockets.`
          : `SNOTEL observation is ${ageDays} days old; re-verify with latest center/weather products before committing.`,
      );
    } else if (ageDays >= 1) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`SNOTEL observation is ${ageDays} day${ageDays === 1 ? '' : 's'} old; recent weather may have changed conditions.`);
    }
  }

  const nohrscIsZeroOrMissing = !hasNohrscDepth || nohrscDepth <= 0;
  const cdecIsZeroOrMissing = !hasCdecDepth || cdecDepth <= 0;
  const snotelIsZeroOrMissing = !hasSnotelDepth || snotelDepth <= 0;
  const highElevation = Number.isFinite(Number(objectiveElevationFt)) && Number(objectiveElevationFt) >= 7500;

  if (
    highElevation &&
    !hasAnySnowSignal &&
    nohrscIsZeroOrMissing &&
    cdecIsZeroOrMissing &&
    snotelIsZeroOrMissing
  ) {
    bullets.push(
      'All automated sources show minimal or no snow at this elevation. Gridded models can underrepresent isolated mountain snowpack — verify with local avalanche center, ranger station, or recent trip reports.',
    );
  }

  if (hasAnySnowSignal) {
    const headline =
      (hasNohrscDepth && nohrscDepth >= 24) || (hasCdecDepth && cdecDepth >= 24) ||
      (hasSnotelSwe && snotelSwe >= 8) || (hasNohrscSwe && nohrscSwe >= 8) || (hasCdecSwe && cdecSwe >= 8)
        ? 'Substantial snowpack signal. Treat avalanche terrain as consequential.'
        : 'Some snowpack signal present. Validate terrain-specific stability as you travel.';
    return {
      headline,
      confidence,
      bullets: bullets.slice(0, 4),
    };
  }

  return {
    headline: 'Minimal broad snow signal in these sources. Non-snow travel is more likely, but isolated snow/ice pockets can remain.',
    confidence: confidence === 'low' ? 'watch' : confidence,
    bullets: bullets.slice(0, 4),
  };
}

export function buildSnowpackInsights(
  snowpack: SafetyData['snowpack'] | null | undefined,
  objectiveElevationFt: number | null | undefined,
  elevationUnit: ElevationUnit = 'ft',
): SnowpackSnapshotInsights {
  const snotel = snowpack?.snotel || null;
  const nohrsc = snowpack?.nohrsc || null;
  const cdec = snowpack?.cdec || null;

  const snotelDepth = Number(snotel?.snowDepthIn);
  const nohrscDepth = Number(nohrsc?.snowDepthIn);
  const cdecDepth = Number(cdec?.snowDepthIn);
  const snotelSwe = Number(snotel?.sweIn);
  const nohrscSwe = Number(nohrsc?.sweIn);
  const cdecSwe = Number(cdec?.sweIn);
  const maxDepth = Math.max(
    Number.isFinite(snotelDepth) ? snotelDepth : 0,
    Number.isFinite(nohrscDepth) ? nohrscDepth : 0,
    Number.isFinite(cdecDepth) ? cdecDepth : 0,
  );
  const maxSwe = Math.max(
    Number.isFinite(snotelSwe) ? snotelSwe : 0,
    Number.isFinite(nohrscSwe) ? nohrscSwe : 0,
    Number.isFinite(cdecSwe) ? cdecSwe : 0,
  );
  const hasObservedSnowpack =
    Number.isFinite(snotelDepth) ||
    Number.isFinite(nohrscDepth) ||
    Number.isFinite(cdecDepth) ||
    Number.isFinite(snotelSwe) ||
    Number.isFinite(nohrscSwe) ||
    Number.isFinite(cdecSwe);
  const lowBroadSnowSignal = hasObservedSnowpack && maxDepth <= 1 && maxSwe <= 0.2;

  let signal: SnowpackInsightBadge;
  if (!hasObservedSnowpack) {
    signal = {
      label: 'Signal limited',
      detail: 'No usable SNOTEL/NOHRSC/CDEC snow metrics were returned.',
      tone: 'watch',
    };
  } else if (maxDepth >= 24 || maxSwe >= 8) {
    signal = {
      label: 'Strong signal',
      detail: `Depth up to ${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)} or SWE up to ${formatSweForElevationUnit(maxSwe, elevationUnit)}.`,
      tone: 'watch',
    };
  } else if (maxDepth >= 6 || maxSwe >= 1.5) {
    signal = {
      label: 'Measurable signal',
      detail: `Depth up to ${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)} and SWE up to ${formatSweForElevationUnit(maxSwe, elevationUnit)}.`,
      tone: 'watch',
    };
  } else {
    signal = {
      label: 'Minimal broad signal',
      detail: `Depth/SWE are low (${formatSnowDepthForElevationUnit(maxDepth, elevationUnit)}, ${formatSweForElevationUnit(maxSwe, elevationUnit)}), but isolated snow terrain may still exist.`,
      tone: 'good',
    };
  }

  const snotelDistanceKm = Number(snotel?.distanceKm);
  const snotelElevationFt = Number(snotel?.elevationFt);
  const objectiveElevation = Number(objectiveElevationFt);
  const hasDistance = Number.isFinite(snotelDistanceKm);
  const hasElevDelta = Number.isFinite(snotelElevationFt) && Number.isFinite(objectiveElevation);
  const elevDeltaFt = hasElevDelta ? Math.abs(snotelElevationFt - objectiveElevation) : null;
  const distanceText = hasDistance ? formatDistanceForElevationUnit(snotelDistanceKm, elevationUnit) : 'N/A';
  const elevDeltaText =
    elevDeltaFt !== null
      ? `${Math.round(convertElevationFeetToDisplayValue(elevDeltaFt, elevationUnit)).toLocaleString()} ${elevationUnit}`
      : 'N/A';

  let representativeness: SnowpackInsightBadge;
  if (!hasDistance && !hasElevDelta) {
    representativeness = {
      label: lowBroadSnowSignal ? 'Context optional' : 'Representativeness unknown',
      detail: lowBroadSnowSignal
        ? 'Distance/elevation context is unavailable, but broad no-snow signal is still informative.'
        : 'Nearest SNOTEL distance/elevation context is unavailable.',
      tone: lowBroadSnowSignal ? 'good' : 'warn',
    };
  } else if ((hasDistance && snotelDistanceKm <= 10) && (elevDeltaFt === null || elevDeltaFt <= 1500)) {
    representativeness = {
      label: 'High representativeness',
      detail: `Nearest station is ${distanceText} away${elevDeltaFt !== null ? ` with ~${elevDeltaText} elevation offset` : ''}.`,
      tone: 'good',
    };
  } else if ((hasDistance && snotelDistanceKm > 30) || (elevDeltaFt !== null && elevDeltaFt > 3000)) {
    representativeness = {
      label: lowBroadSnowSignal ? 'Lower representativeness' : 'Low representativeness',
      detail: `Station context is less local (${distanceText}${elevDeltaFt !== null ? `, ~${elevDeltaText} elevation offset` : ''}); verify with on-route observations.`,
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  } else {
    representativeness = {
      label: 'Moderate representativeness',
      detail: `Station context is usable but not exact (${distanceText}${elevDeltaFt !== null ? `, ~${elevDeltaText} elevation offset` : ''}).`,
      tone: 'watch',
    };
  }

  const depthPairAvailable = Number.isFinite(snotelDepth) && Number.isFinite(nohrscDepth);
  const swePairAvailable = Number.isFinite(snotelSwe) && Number.isFinite(nohrscSwe);
  const depthDeltaIn = depthPairAvailable ? Math.abs((snotelDepth as number) - (nohrscDepth as number)) : null;
  const sweDeltaIn = swePairAvailable ? Math.abs((snotelSwe as number) - (nohrscSwe as number)) : null;
  const depthDeltaPct =
    depthPairAvailable && Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1) > 0
      ? (Math.abs((snotelDepth as number) - (nohrscDepth as number)) / Math.max(Math.abs(snotelDepth), Math.abs(nohrscDepth), 1)) * 100
      : null;
  const sweDeltaPct =
    swePairAvailable && Math.max(Math.abs(snotelSwe), Math.abs(nohrscSwe), 0.1) > 0
      ? (Math.abs((snotelSwe as number) - (nohrscSwe as number)) / Math.max(Math.abs(snotelSwe), Math.abs(nohrscSwe), 0.1)) * 100
      : null;
  const maxDeltaPct = Math.max(depthDeltaPct ?? 0, sweDeltaPct ?? 0);

  let agreement: SnowpackInsightBadge;
  if (!depthPairAvailable && !swePairAvailable) {
    agreement = {
      label: 'Single-source view',
      detail: 'Only one source has usable snow metrics. Treat this as directional context.',
      tone: lowBroadSnowSignal ? 'good' : 'watch',
    };
  } else {
    const agreementParts = [
      depthDeltaIn !== null
        ? `Depth \u0394 ${formatSnowDepthForElevationUnit(depthDeltaIn, elevationUnit)}${depthDeltaPct !== null ? ` (${Math.round(depthDeltaPct)}%)` : ''}`
        : null,
      sweDeltaIn !== null
        ? `SWE \u0394 ${formatSweForElevationUnit(sweDeltaIn, elevationUnit)}${sweDeltaPct !== null ? ` (${Math.round(sweDeltaPct)}%)` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' \u2022 ');

    if (maxDeltaPct <= 35) {
      agreement = {
        label: 'Sources aligned',
        detail: agreementParts || 'SNOTEL and NOHRSC broadly agree.',
        tone: 'good',
      };
    } else if (maxDeltaPct <= 70 || lowBroadSnowSignal) {
      agreement = {
        label: 'Partial agreement',
        detail: `${agreementParts || 'Sources diverge somewhat.'} Expect patchy distribution.`,
        tone: 'watch',
      };
    } else {
      agreement = {
        label: 'Sources diverge',
        detail: `${agreementParts || 'Large disagreement between sources.'} Verify snow coverage on route before committing.`,
        tone: 'warn',
      };
    }
  }

  const snotelObsAgeLabel = formatCompactAge(snotel?.observedDate || null);
  const nohrscAgeLabel = formatCompactAge(nohrsc?.sampledTime || null);
  const snotelObsMs = parseIsoToMs(snotel?.observedDate || null);
  const nohrscObsMs = parseIsoToMs(nohrsc?.sampledTime || null);
  const snotelAgeHours = snotelObsMs === null ? null : (Date.now() - snotelObsMs) / 3600000;
  const nohrscAgeHours = nohrscObsMs === null ? null : (Date.now() - nohrscObsMs) / 3600000;

  let freshness: SnowpackInsightBadge;
  if (snotelAgeHours === null && nohrscAgeHours === null) {
    freshness = {
      label: lowBroadSnowSignal ? 'Timestamp limited' : 'Freshness unknown',
      detail: lowBroadSnowSignal
        ? 'No timestamps were returned; broad no-snow signal is likely still directionally useful.'
        : 'No observation timestamps were returned.',
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  } else if ((nohrscAgeHours === null || nohrscAgeHours <= 8) && (snotelAgeHours === null || snotelAgeHours <= 60)) {
    freshness = {
      label: 'Fresh data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' \u2022 '),
      tone: 'good',
    };
  } else if ((nohrscAgeHours === null || nohrscAgeHours <= 18) && (snotelAgeHours === null || snotelAgeHours <= 96)) {
    freshness = {
      label: 'Aging data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' \u2022 '),
      tone: 'watch',
    };
  } else {
    freshness = {
      label: lowBroadSnowSignal ? 'Aging data' : 'Stale data',
      detail: [
        snotelObsAgeLabel ? `SNOTEL ${snotelObsAgeLabel}` : null,
        nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null,
      ]
        .filter(Boolean)
        .join(' \u2022 ') || 'Observation times are outdated.',
      tone: lowBroadSnowSignal ? 'watch' : 'warn',
    };
  }

  return { signal, freshness, representativeness, agreement };
}
