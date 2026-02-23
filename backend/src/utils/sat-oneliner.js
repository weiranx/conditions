const createSatOneLinerBuilder = ({ parseStartClock, computeFeelsLikeF }) => {
  const satDecisionLevelFromScore = (scoreValue) => {
    const score = Number(scoreValue);
    if (!Number.isFinite(score)) {
      return 'UNKNOWN';
    }
    if (score >= 80) return 'GO';
    if (score >= 50) return 'CAUTION';
    return 'NO-GO';
  };

  const satAvalancheSnippet = (avalancheData) => {
    if (!avalancheData || avalancheData.relevant === false) {
      return 'Avy n/a';
    }
    if (avalancheData.dangerUnknown || avalancheData.coverageStatus !== 'reported') {
      return 'Avy unknown';
    }
    const level = Number(avalancheData.dangerLevel);
    if (!Number.isFinite(level) || level <= 0) {
      return 'Avy n/a';
    }
    const labels = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];
    const label = labels[level] || 'Unknown';
    return `Avy L${Math.round(level)} ${label}`;
  };

  const satCompactCondition = (text) => {
    const value = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) return '';
    if (/thunder|storm|lightning/.test(value)) return 'storm';
    if (/snow|sleet|freezing|ice|blizzard|flurr|wintry/.test(value)) return 'snow';
    if (/rain|drizzle|shower/.test(value)) return 'rain';
    if (/fog|smoke|haze/.test(value)) return 'visibility';
    return 'clear';
  };

  const satWorst12hSnippet = (weatherData) => {
    const trend = Array.isArray(weatherData?.trend) ? weatherData.trend.slice(0, 12) : [];
    if (!trend.length) {
      return 'Worst12h n/a';
    }

    let best = null;
    for (const point of trend) {
      const gust = Number(point?.gust);
      const precip = Number(point?.precipChance);
      const temp = Number(point?.temp);
      const feelsLike = Number.isFinite(Number(point?.feelsLike))
        ? Number(point.feelsLike)
        : computeFeelsLikeF(temp, Number(point?.wind) || 0);
      const condition = satCompactCondition(point?.condition);
      const gustRisk = Number.isFinite(gust) ? Math.max(0, gust - 20) * 1.4 : 0;
      const precipRisk = Number.isFinite(precip) ? Math.max(0, precip - 25) * 0.85 : 0;
      const coldRisk = Number.isFinite(feelsLike) ? Math.max(0, 20 - feelsLike) * 0.7 : 0;
      const weatherRisk = /storm/.test(condition) ? 22 : /snow/.test(condition) ? 12 : /rain|visibility/.test(condition) ? 7 : 0;
      const severity = gustRisk + precipRisk + coldRisk + weatherRisk;

      if (!best || severity > best.severity) {
        best = {
          time: String(point?.time || ''),
          gust,
          precip,
          feelsLike,
          condition,
          severity,
        };
      }
    }

    if (!best) {
      return 'Worst12h n/a';
    }

    const parts = [];
    if (best.time) parts.push(best.time);
    if (best.condition && best.condition !== 'clear') parts.push(best.condition);
    if (Number.isFinite(best.gust)) parts.push(`g${Math.round(best.gust)}mph`);
    if (Number.isFinite(best.precip)) parts.push(`p${Math.round(best.precip)}%`);
    if (Number.isFinite(best.feelsLike)) parts.push(`f${Math.round(best.feelsLike)}F`);
    return `Worst12h ${parts.join(' ')}`.trim();
  };

  const satStartLabel = (startClock) => {
    const normalized = parseStartClock(startClock);
    if (!normalized) return '';
    const [hourRaw, minuteRaw] = normalized.split(':').map((part) => Number(part));
    if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return normalized;
    const meridiem = hourRaw >= 12 ? 'PM' : 'AM';
    const hour12 = hourRaw % 12 === 0 ? 12 : hourRaw % 12;
    return `${hour12}:${String(minuteRaw).padStart(2, '0')}${meridiem}`;
  };

  return ({ safetyPayload, objectiveName = '', startClock = '', maxLength = 170 }) => {
    const payload = safetyPayload && typeof safetyPayload === 'object' ? safetyPayload : {};
    const weather = payload.weather && typeof payload.weather === 'object' ? payload.weather : {};
    const avalanche = payload.avalanche && typeof payload.avalanche === 'object' ? payload.avalanche : {};
    const safety = payload.safety && typeof payload.safety === 'object' ? payload.safety : {};
    const forecastDate = payload.forecast && typeof payload.forecast === 'object' ? payload.forecast.selectedDate : null;

    const label = String(objectiveName || 'Objective')
      .split(',')[0]
      .trim()
      .slice(0, 24);
    const temp = Number(weather.temp);
    const feelsLike = Number.isFinite(Number(weather.feelsLike)) ? Number(weather.feelsLike) : computeFeelsLikeF(temp, Number(weather.windSpeed) || 0);
    const wind = Number(weather.windSpeed);
    const gust = Number(weather.windGust);
    const precip = Number(weather.precipChance);
    const score = Number(safety.score);
    const decision = satDecisionLevelFromScore(score);
    const worst12h = satWorst12hSnippet(weather);
    const startLabel = satStartLabel(startClock);

    const line = [
      label || 'Objective',
      forecastDate || new Date().toISOString().slice(0, 10),
      startLabel ? `start ${startLabel}` : '',
      '|',
      Number.isFinite(temp) ? `${Math.round(temp)}F` : 'temp n/a',
      Number.isFinite(feelsLike) ? `feels ${Math.round(feelsLike)}F` : '',
      Number.isFinite(wind) ? `w${Math.round(wind)}mph` : '',
      Number.isFinite(gust) ? `g${Math.round(gust)}mph` : '',
      Number.isFinite(precip) ? `p${Math.round(precip)}%` : '',
      '|',
      satAvalancheSnippet(avalanche),
      '|',
      worst12h,
      '|',
      decision,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cap = Number.isFinite(Number(maxLength)) ? Math.max(80, Math.min(320, Math.round(Number(maxLength)))) : 170;
    if (line.length <= cap) {
      return line;
    }
    return `${line.slice(0, cap - 1).trimEnd()}…`;
  };
};

module.exports = {
  createSatOneLinerBuilder,
};
