const createUnavailableHeatRiskData = (status = 'unavailable') => ({
  source: 'Derived from NOAA forecast temperature, apparent temperature, and humidity',
  status,
  level: 0,
  label: 'Low',
  guidance: 'Heat-risk signal unavailable.',
  reasons: ['Heat-risk signal unavailable.'],
  metrics: {
    tempF: null,
    feelsLikeF: null,
    humidity: null,
    peakTemp12hF: null,
    peakFeelsLike12hF: null,
    lowerTerrainTempF: null,
    lowerTerrainFeelsLikeF: null,
    lowerTerrainLabel: null,
    lowerTerrainElevationFt: null,
    isDaytime: null,
  },
});

const HEAT_LABELS = ['Low', 'Guarded', 'Elevated', 'High', 'Extreme'];
const HEAT_GUIDANCE = [
  'No notable heat signal from current forecast inputs.',
  'Warm exposure possible. Bring extra water and manage sun/shade transitions.',
  'Heat stress is plausible during sustained movement. Increase hydration and pace control.',
  'High heat-stress risk. Shorten exposed pushes and enforce frequent cooling breaks.',
  'Extreme heat-stress risk. Avoid committing to long, exposed objectives in this window.',
];

const buildHeatRiskData = ({ weatherData }) => {
  const tempF = Number(weatherData?.temp);
  const feelsLikeF = Number.isFinite(Number(weatherData?.feelsLike)) ? Number(weatherData?.feelsLike) : tempF;
  const humidity = Number(weatherData?.humidity);
  const isDaytime = weatherData?.isDaytime;

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const trendTemps = trend
    .map((point) => Number(point?.temp))
    .filter((value) => Number.isFinite(value));
  const peakTemp12hF = Number.isFinite(tempF) ? Math.max(tempF, ...trendTemps) : trendTemps.length > 0 ? Math.max(...trendTemps) : null;
  const peakFeelsLike12hF = Number.isFinite(feelsLikeF)
    ? Math.max(feelsLikeF, Number.isFinite(peakTemp12hF) ? peakTemp12hF : Number.NEGATIVE_INFINITY)
    : peakTemp12hF;
  const elevationBands = Array.isArray(weatherData?.elevationForecast) ? weatherData.elevationForecast : [];
  const lowerTerrainBands = elevationBands.filter((band) => Number(band?.deltaFromObjectiveFt) < 0);
  const lowerTerrainWarmestBand = lowerTerrainBands.reduce((warmest, band) => {
    const bandTemp = Number(band?.temp);
    const bandFeels = Number.isFinite(Number(band?.feelsLike)) ? Number(band?.feelsLike) : bandTemp;
    if (!Number.isFinite(bandFeels)) {
      return warmest;
    }
    if (!warmest || bandFeels > warmest.feelsLikeF) {
      return {
        label: band?.label || 'Lower terrain',
        elevationFt: Number.isFinite(Number(band?.elevationFt)) ? Number(band.elevationFt) : null,
        tempF: Number.isFinite(bandTemp) ? bandTemp : null,
        feelsLikeF: bandFeels,
      };
    }
    return warmest;
  }, null);
  const lowerTerrainPeakTempF = Number(lowerTerrainWarmestBand?.tempF);
  const lowerTerrainPeakFeelsLikeF = Number(lowerTerrainWarmestBand?.feelsLikeF);
  const effectivePeakTempF = Number.isFinite(lowerTerrainPeakTempF)
    ? Number.isFinite(peakTemp12hF)
      ? Math.max(peakTemp12hF, lowerTerrainPeakTempF)
      : lowerTerrainPeakTempF
    : peakTemp12hF;
  const effectivePeakFeelsLikeF = Number.isFinite(lowerTerrainPeakFeelsLikeF)
    ? Number.isFinite(peakFeelsLike12hF)
      ? Math.max(peakFeelsLike12hF, lowerTerrainPeakFeelsLikeF)
      : lowerTerrainPeakFeelsLikeF
    : peakFeelsLike12hF;

  let level = 0;
  const reasons = [];

  if (Number.isFinite(effectivePeakFeelsLikeF)) {
    if (effectivePeakFeelsLikeF >= 100) {
      level = Math.max(level, 4);
      reasons.push(`Peak apparent temperature in the travel window reaches ${Math.round(effectivePeakFeelsLikeF)}F.`);
    } else if (effectivePeakFeelsLikeF >= 92) {
      level = Math.max(level, 3);
      reasons.push(`Peak apparent temperature in the travel window reaches ${Math.round(effectivePeakFeelsLikeF)}F.`);
    } else if (effectivePeakFeelsLikeF >= 84) {
      level = Math.max(level, 2);
      reasons.push(`Apparent temperature in the travel window is near ${Math.round(effectivePeakFeelsLikeF)}F.`);
    } else if (effectivePeakFeelsLikeF >= 76 && isDaytime !== false) {
      level = Math.max(level, 1);
      reasons.push(`Warm daytime apparent temperature near ${Math.round(effectivePeakFeelsLikeF)}F.`);
    }
  }

  if (Number.isFinite(effectivePeakTempF) && Number.isFinite(humidity)) {
    if (effectivePeakTempF >= 92 && humidity >= 55) {
      level = Math.max(level, 4);
      reasons.push(`Heat + humidity pattern (${Math.round(effectivePeakTempF)}F, RH ${Math.round(humidity)}%).`);
    } else if (effectivePeakTempF >= 86 && humidity >= 55) {
      level = Math.max(level, 3);
      reasons.push(`Warm/humid pattern (${Math.round(effectivePeakTempF)}F, RH ${Math.round(humidity)}%).`);
    } else if (effectivePeakTempF >= 80 && humidity >= 45) {
      level = Math.max(level, 2);
      reasons.push(`Moderate humidity can increase heat load (${Math.round(effectivePeakTempF)}F, RH ${Math.round(humidity)}%).`);
    }
  }
  if (lowerTerrainWarmestBand && Number.isFinite(lowerTerrainPeakFeelsLikeF)) {
    const lowerBandLabel = lowerTerrainWarmestBand.label || 'Lower terrain';
    const lowerBandElevationText = Number.isFinite(lowerTerrainWarmestBand.elevationFt)
      ? ` (${Math.round(lowerTerrainWarmestBand.elevationFt)} ft)`
      : '';
    reasons.push(
      `Lower terrain can run warmer: ${lowerBandLabel}${lowerBandElevationText} is estimated near ${Math.round(lowerTerrainPeakFeelsLikeF)}F apparent.`,
    );
  }

  if (Number.isFinite(tempF) && tempF >= 85 && isDaytime === false && level > 0) {
    reasons.push('Selected start appears after dark, but daytime heat exposure can still matter later in the window.');
  }

  const label = HEAT_LABELS[level] || 'Low';
  const guidance = HEAT_GUIDANCE[level] || HEAT_GUIDANCE[0];

  return {
    source: 'Derived from forecast temperature, apparent temperature, humidity, and lower-terrain elevation estimates',
    status: 'ok',
    level,
    label,
    guidance,
    reasons: reasons.length > 0 ? reasons : [HEAT_GUIDANCE[0]],
    metrics: {
      tempF: Number.isFinite(tempF) ? tempF : null,
      feelsLikeF: Number.isFinite(feelsLikeF) ? feelsLikeF : null,
      humidity: Number.isFinite(humidity) ? humidity : null,
      peakTemp12hF: Number.isFinite(peakTemp12hF) ? peakTemp12hF : null,
      peakFeelsLike12hF: Number.isFinite(peakFeelsLike12hF) ? peakFeelsLike12hF : null,
      lowerTerrainTempF: Number.isFinite(lowerTerrainPeakTempF) ? lowerTerrainPeakTempF : null,
      lowerTerrainFeelsLikeF: Number.isFinite(lowerTerrainPeakFeelsLikeF) ? lowerTerrainPeakFeelsLikeF : null,
      lowerTerrainLabel: lowerTerrainWarmestBand?.label || null,
      lowerTerrainElevationFt: Number.isFinite(lowerTerrainWarmestBand?.elevationFt) ? Number(lowerTerrainWarmestBand.elevationFt) : null,
      isDaytime: typeof isDaytime === 'boolean' ? isDaytime : null,
    },
  };
};

module.exports = {
  createUnavailableHeatRiskData,
  buildHeatRiskData,
};
