const computeFeelsLikeF = (tempF, windMph) => {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (tempF <= 50 && windMph >= 3) {
    const feelsLike = 35.74 + (0.6215 * tempF) - (35.75 * Math.pow(windMph, 0.16)) + (0.4275 * tempF * Math.pow(windMph, 0.16));
    return Math.round(feelsLike);
  }
  return Math.round(tempF);
};

const celsiusToF = (valueC) => {
  const numeric = Number(valueC);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return (numeric * 9) / 5 + 32;
};

const normalizeNoaaDewPointF = (dewpointField) => {
  const value = Number(dewpointField?.value);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unitCode = String(dewpointField?.unitCode || '').toLowerCase();
  if (unitCode.includes('degc') || unitCode.includes('unit:degc') || unitCode.includes('wmo:degc')) {
    const converted = celsiusToF(value);
    return Number.isFinite(converted) ? Math.round(converted) : null;
  }
  return Math.round(value);
};

const normalizePressureHpa = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric * 10) / 10;
};

const normalizeNoaaPressureHpa = (barometricPressureField) => {
  if (barometricPressureField === null || barometricPressureField === undefined) {
    return null;
  }
  if (typeof barometricPressureField === 'number') {
    return normalizePressureHpa(barometricPressureField > 2000 ? barometricPressureField / 100 : barometricPressureField);
  }

  const rawValue = Number(barometricPressureField?.value);
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const unitCode = String(barometricPressureField?.unitCode || '').toLowerCase();
  if (unitCode.includes('hpa') || unitCode.includes('hectopascal') || unitCode.includes('millibar') || unitCode.includes('mb')) {
    return normalizePressureHpa(rawValue);
  }
  if (unitCode.includes('pa') || rawValue > 2000) {
    return normalizePressureHpa(rawValue / 100);
  }
  return normalizePressureHpa(rawValue);
};

const clampPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const inferNoaaCloudCoverFromIcon = (iconUrl) => {
  const icon = String(iconUrl || '').toLowerCase();
  if (!icon) {
    return null;
  }
  const tokens = icon
    .split(/[\/,?]/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token.startsWith('ovc'))) return 95;
  if (tokens.some((token) => token.startsWith('bkn'))) return 75;
  if (tokens.some((token) => token.startsWith('sct'))) return 50;
  if (tokens.some((token) => token.startsWith('few'))) return 20;
  if (tokens.some((token) => token === 'skc' || token === 'clr')) return 5;
  return null;
};

const inferNoaaCloudCoverFromForecastText = (shortForecast) => {
  const text = String(shortForecast || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }
  if (text.includes('overcast')) return 95;
  if (text.includes('mostly cloudy')) return 80;
  if (text.includes('partly cloudy') || text.includes('partly sunny')) return 50;
  if (text.includes('mostly sunny')) return 25;
  if (text.includes('sunny') || text.includes('clear')) return 10;
  if (text.includes('cloudy')) return 70;
  return null;
};

const resolveNoaaCloudCover = (forecastPeriod) => {
  const skyCoverValue = clampPercent(forecastPeriod?.skyCover?.value);
  if (Number.isFinite(skyCoverValue)) {
    return { value: skyCoverValue, source: 'NOAA skyCover' };
  }
  const fromIcon = inferNoaaCloudCoverFromIcon(forecastPeriod?.icon);
  if (Number.isFinite(fromIcon)) {
    return { value: fromIcon, source: 'NOAA icon-derived cloud cover' };
  }
  const fromText = inferNoaaCloudCoverFromForecastText(forecastPeriod?.shortForecast);
  if (Number.isFinite(fromText)) {
    return { value: fromText, source: 'NOAA shortForecast-derived cloud cover' };
  }
  return { value: null, source: 'Unavailable' };
};

const toFiniteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

module.exports = {
  computeFeelsLikeF,
  celsiusToF,
  normalizeNoaaDewPointF,
  normalizePressureHpa,
  normalizeNoaaPressureHpa,
  clampPercent,
  inferNoaaCloudCoverFromIcon,
  inferNoaaCloudCoverFromForecastText,
  resolveNoaaCloudCover,
  toFiniteNumberOrNull,
};
