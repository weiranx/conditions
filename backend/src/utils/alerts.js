const { normalizeHttpUrl } = require('./url-utils');
const { parseIsoTimeToMs, findClosestTimeIndex, withExplicitTimezone } = require('./time');

const ALERT_SEVERITY_RANK = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
};

const normalizeAlertSeverity = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized in ALERT_SEVERITY_RANK) {
    return normalized;
  }
  return 'unknown';
};

const formatAlertSeverity = (value) => {
  const normalized = normalizeAlertSeverity(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getHigherSeverity = (a, b) => {
  const normalizedA = normalizeAlertSeverity(a);
  const normalizedB = normalizeAlertSeverity(b);
  return ALERT_SEVERITY_RANK[normalizedA] >= ALERT_SEVERITY_RANK[normalizedB] ? normalizedA : normalizedB;
};

const normalizeNwsAlertText = (value, maxLength = 4000) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const normalizeNwsAreaList = (areaDescValue) => {
  if (typeof areaDescValue !== 'string') {
    return [];
  }
  return areaDescValue
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
};

const classifyUsAqi = (aqi) => {
  if (!Number.isFinite(aqi)) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
};

const createUnavailableAirQualityData = (status = 'unavailable') => ({
  source: 'Open-Meteo Air Quality API',
  status,
  usAqi: null,
  category: 'Unknown',
  pm25: null,
  pm10: null,
  ozone: null,
  measuredTime: null,
  note: null,
});

const createUnavailableAlertsData = (status = 'unavailable') => ({
  source: 'NOAA/NWS Active Alerts',
  status,
  activeCount: 0,
  totalActiveCount: 0,
  targetTime: null,
  highestSeverity: 'Unknown',
  note: null,
  alerts: [],
});

const buildNwsAlertUrlFromId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = normalizeHttpUrl(trimmed);
  if (absolute) {
    return absolute;
  }
  return `https://api.weather.gov/alerts/${encodeURIComponent(trimmed)}`;
};

const isGenericNwsLink = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    if (host === 'weather.gov' && (pathname === '/' || pathname === '/index' || pathname === '/index.html')) {
      return true;
    }
    if (host === 'api.weather.gov' && (pathname === '/alerts' || pathname === '/alerts/active')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

const isIndividualNwsAlertLink = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/g, '');
    if (host !== 'api.weather.gov') {
      return false;
    }
    if (!pathname.startsWith('/alerts/')) {
      return false;
    }
    return pathname !== '/alerts' && pathname !== '/alerts/active';
  } catch {
    return false;
  }
};

const resolveNwsAlertSourceLink = ({ feature, props, lat, lon }) => {
  const individualAlertUrl = [feature?.id, props?.['@id'], props?.id, props?.identifier]
    .map(buildNwsAlertUrlFromId)
    .find(isIndividualNwsAlertLink);
  if (individualAlertUrl) {
    return individualAlertUrl;
  }

  const directUrl = [props?.uri, props?.web, props?.url, props?.link, props?.['@id'], feature?.id]
    .map(normalizeHttpUrl)
    .filter((candidate) => !isGenericNwsLink(candidate))
    .find(Boolean);
  if (directUrl) {
    return directUrl;
  }

  const idBasedUrl = [props?.id, feature?.id, props?.identifier]
    .map(buildNwsAlertUrlFromId)
    .find(Boolean);
  if (idBasedUrl) {
    return idBasedUrl;
  }

  return `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
};

const createAlertsService = ({ fetchWithTimeout }) => {
  const fetchWeatherAlertsData = async (lat, lon, fetchOptions, targetTimeIso = null) => {
    const targetTimeMs = parseIsoTimeToMs(targetTimeIso) ?? Date.now();

    const alertsRes = await fetchWithTimeout(
      `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
      fetchOptions,
    );
    if (!alertsRes.ok) {
      throw new Error(`NWS alerts request failed with status ${alertsRes.status}`);
    }

    const alertsJson = await alertsRes.json();
    const features = Array.isArray(alertsJson?.features) ? alertsJson.features : [];
    if (features.length === 0) {
      return {
        ...createUnavailableAlertsData('none'),
        targetTime: targetTimeIso || null,
      };
    }

    const alertsActiveAtTarget = features.filter((feature) => {
      const props = feature?.properties || {};
      const startMs =
        parseIsoTimeToMs(props.onset) ??
        parseIsoTimeToMs(props.effective) ??
        parseIsoTimeToMs(props.sent);
      const endMs =
        parseIsoTimeToMs(props.ends) ??
        parseIsoTimeToMs(props.expires);
      const startsBeforeTarget = startMs === null || targetTimeMs >= startMs;
      const endsAfterTarget = endMs === null || targetTimeMs <= endMs;
      return startsBeforeTarget && endsAfterTarget;
    });
    if (alertsActiveAtTarget.length === 0) {
      return {
        ...createUnavailableAlertsData('none_for_selected_start'),
        totalActiveCount: features.length,
        targetTime: targetTimeIso || null,
        note: 'No currently issued alert is active at the selected start time.',
      };
    }

    let highestSeverity = 'unknown';
    const parsedAlerts = alertsActiveAtTarget
      .map((feature) => {
        const props = feature?.properties || {};
        const severity = normalizeAlertSeverity(props.severity);
        highestSeverity = getHigherSeverity(highestSeverity, severity);
        return {
          event: props.event || 'Weather Alert',
          severity: formatAlertSeverity(severity),
          urgency: props.urgency || 'Unknown',
          certainty: props.certainty || 'Unknown',
          headline: props.headline || props.description || '',
          description: normalizeNwsAlertText(props.description),
          instruction: normalizeNwsAlertText(props.instruction),
          areaDesc: normalizeNwsAlertText(props.areaDesc, 1200),
          affectedAreas: normalizeNwsAreaList(props.areaDesc),
          senderName: normalizeNwsAlertText(props.senderName || props.sender, 240),
          response: normalizeNwsAlertText(props.response, 120),
          messageType: normalizeNwsAlertText(props.messageType, 120),
          category: normalizeNwsAlertText(props.category, 120),
          onset: props.onset || null,
          ends: props.ends || null,
          sent: props.sent || null,
          effective: props.effective || null,
          expires: props.expires || null,
          link: resolveNwsAlertSourceLink({ feature, props, lat, lon }),
        };
      })
      .sort(
        (a, b) =>
          ALERT_SEVERITY_RANK[normalizeAlertSeverity(b.severity)] - ALERT_SEVERITY_RANK[normalizeAlertSeverity(a.severity)],
      )
      .slice(0, 6);

    return {
      source: 'NOAA/NWS Active Alerts',
      status: 'ok',
      activeCount: alertsActiveAtTarget.length,
      totalActiveCount: features.length,
      targetTime: targetTimeIso || null,
      highestSeverity: formatAlertSeverity(highestSeverity),
      alerts: parsedAlerts,
    };
  };

  const fetchAirQualityData = async (lat, lon, targetForecastTimeIso, fetchOptions) => {
    const aqiRes = await fetchWithTimeout(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm2_5,pm10,ozone&timezone=UTC`,
      fetchOptions,
    );
    if (!aqiRes.ok) {
      throw new Error(`Open-Meteo air quality request failed with status ${aqiRes.status}`);
    }

    const aqiJson = await aqiRes.json();
    const hourly = aqiJson?.hourly || {};
    const timeArray = Array.isArray(hourly?.time) ? hourly.time : [];
    if (!timeArray.length) {
      return createUnavailableAirQualityData('no_data');
    }

    const targetTimeMs = parseIsoTimeToMs(targetForecastTimeIso) ?? Date.now();
    const timeIdx = findClosestTimeIndex(timeArray, targetTimeMs);
    if (timeIdx < 0) {
      return createUnavailableAirQualityData('no_data');
    }

    const usAqi = Number(hourly?.us_aqi?.[timeIdx]);
    const pm25 = Number(hourly?.pm2_5?.[timeIdx]);
    const pm10 = Number(hourly?.pm10?.[timeIdx]);
    const ozone = Number(hourly?.ozone?.[timeIdx]);
    const measuredTime = withExplicitTimezone(timeArray[timeIdx] || null, aqiJson?.timezone || 'UTC');

    return {
      source: 'Open-Meteo Air Quality API',
      status: 'ok',
      usAqi: Number.isFinite(usAqi) ? Math.round(usAqi) : null,
      category: classifyUsAqi(usAqi),
      pm25: Number.isFinite(pm25) ? Number(pm25.toFixed(1)) : null,
      pm10: Number.isFinite(pm10) ? Number(pm10.toFixed(1)) : null,
      ozone: Number.isFinite(ozone) ? Number(ozone.toFixed(1)) : null,
      measuredTime,
    };
  };

  return { fetchWeatherAlertsData, fetchAirQualityData };
};

module.exports = {
  ALERT_SEVERITY_RANK,
  normalizeAlertSeverity,
  formatAlertSeverity,
  getHigherSeverity,
  normalizeNwsAlertText,
  normalizeNwsAreaList,
  classifyUsAqi,
  createUnavailableAirQualityData,
  createUnavailableAlertsData,
  buildNwsAlertUrlFromId,
  isGenericNwsLink,
  isIndividualNwsAlertLink,
  resolveNwsAlertSourceLink,
  createAlertsService,
};
