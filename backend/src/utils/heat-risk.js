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

  let level = 0;
  const reasons = [];

  if (Number.isFinite(peakFeelsLike12hF)) {
    if (peakFeelsLike12hF >= 100) {
      level = Math.max(level, 4);
      reasons.push(`Peak apparent temperature in the 12h window reaches ${Math.round(peakFeelsLike12hF)}F.`);
    } else if (peakFeelsLike12hF >= 92) {
      level = Math.max(level, 3);
      reasons.push(`Peak apparent temperature in the 12h window reaches ${Math.round(peakFeelsLike12hF)}F.`);
    } else if (peakFeelsLike12hF >= 84) {
      level = Math.max(level, 2);
      reasons.push(`Apparent temperature near selected start is ${Math.round(peakFeelsLike12hF)}F.`);
    } else if (peakFeelsLike12hF >= 76 && isDaytime !== false) {
      level = Math.max(level, 1);
      reasons.push(`Warm daytime apparent temperature near ${Math.round(peakFeelsLike12hF)}F.`);
    }
  }

  if (Number.isFinite(peakTemp12hF) && Number.isFinite(humidity)) {
    if (peakTemp12hF >= 92 && humidity >= 55) {
      level = Math.max(level, 4);
      reasons.push(`Heat + humidity pattern (${Math.round(peakTemp12hF)}F, RH ${Math.round(humidity)}%).`);
    } else if (peakTemp12hF >= 86 && humidity >= 55) {
      level = Math.max(level, 3);
      reasons.push(`Warm/humid pattern (${Math.round(peakTemp12hF)}F, RH ${Math.round(humidity)}%).`);
    } else if (peakTemp12hF >= 80 && humidity >= 45) {
      level = Math.max(level, 2);
      reasons.push(`Moderate humidity can increase heat load (${Math.round(peakTemp12hF)}F, RH ${Math.round(humidity)}%).`);
    }
  }

  if (Number.isFinite(tempF) && tempF >= 85 && isDaytime === false && level > 0) {
    reasons.push('Selected start appears after dark, but daytime heat exposure can still matter later in the window.');
  }

  const label = HEAT_LABELS[level] || 'Low';
  const guidance = HEAT_GUIDANCE[level] || HEAT_GUIDANCE[0];

  return {
    source: 'Derived from NOAA forecast temperature, apparent temperature, and humidity',
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
      isDaytime: typeof isDaytime === 'boolean' ? isDaytime : null,
    },
  };
};

module.exports = {
  createUnavailableHeatRiskData,
  buildHeatRiskData,
};
