'use strict';

const { sanitizeReportForFeatureFlags } = require('../utils/report-feature-filter');

const APP_NAME = 'Backcountry Conditions';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const emailShell = ({ preview, heading, body, actionLabel, actionUrl, footer }) => {
  const safeUrl = escapeHtml(actionUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin:0;background:#f2f4ef;color:#172019;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce2da;border-radius:16px;">
            <tr>
              <td style="padding:34px 34px 12px;">
                <p style="margin:0 0 20px;color:#48705a;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${APP_NAME}</p>
                <h1 style="margin:0;color:#172019;font-size:28px;line-height:1.2;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 34px 32px;color:#4d5b51;font-size:15px;line-height:1.65;">
                ${body}
                <p style="margin:26px 0;">
                  <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#315f45;color:#ffffff;font-weight:700;text-decoration:none;">${escapeHtml(actionLabel)}</a>
                </p>
                <p style="margin:0 0 8px;font-size:12px;color:#6d786f;">If the button does not work, copy and paste this link:</p>
                <p style="margin:0;word-break:break-all;font-size:12px;"><a href="${safeUrl}" style="color:#315f45;">${safeUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 34px;border-top:1px solid #e7ebe5;color:#7a847c;font-size:12px;line-height:1.5;">${escapeHtml(footer)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildVerificationEmail = ({ displayName, actionUrl }) => {
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hello,';
  return {
    subject: `Verify your ${APP_NAME} email`,
    text: `${displayName ? `Hi ${displayName},\n\n` : ''}Verify your email address to finish securing your ${APP_NAME} account. This link expires in 24 hours.\n\n${actionUrl}\n\nIf you did not create this account, you can ignore this email.`,
    html: emailShell({
      preview: `Verify your ${APP_NAME} email`,
      heading: 'Verify your email address',
      body: `<p style="margin:0 0 14px;">${greeting}</p><p style="margin:0;">Confirm this email address to finish securing your account. This link expires in 24 hours.</p>`,
      actionLabel: 'Verify email',
      actionUrl,
      footer: 'If you did not create this account, you can safely ignore this email.',
    }),
  };
};

const buildPasswordResetEmail = ({ displayName, actionUrl }) => {
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hello,';
  return {
    subject: `Reset your ${APP_NAME} password`,
    text: `${displayName ? `Hi ${displayName},\n\n` : ''}Use this link to reset your ${APP_NAME} password. This link expires in 45 minutes and can be used once.\n\n${actionUrl}\n\nIf you did not request a password reset, you can ignore this email.`,
    html: emailShell({
      preview: `Reset your ${APP_NAME} password`,
      heading: 'Reset your password',
      body: `<p style="margin:0 0 14px;">${greeting}</p><p style="margin:0;">Use the link below to choose a new password. It expires in 45 minutes and can be used once.</p>`,
      actionLabel: 'Reset password',
      actionUrl,
      footer: 'If you did not request a password reset, you can safely ignore this email.',
    }),
  };
};

const compactText = (value, fallback = '', maxLength = 280) => {
  const text = String(value || '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
};

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasReportValue = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(hasReportValue);
  if (isRecord(value)) return Object.values(value).some(hasReportValue);
  return true;
};

const REPORT_LABELS = Object.freeze({
  ai: 'AI',
  apiWarning: 'Data warning',
  gpx: 'GPX',
  lat: 'Latitude',
  lon: 'Longitude',
  nohrsc: 'NOHRSC',
  nws: 'NWS',
  pm25: 'PM2.5',
  pm10: 'PM10',
  snotel: 'SNOTEL',
  swe: 'SWE',
  usAqi: 'US AQI',
  viirs: 'VIIRS',
});

const reportLabel = (key) => {
  if (Object.hasOwn(REPORT_LABELS, key)) return REPORT_LABELS[key];
  return String(key || 'Details')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
};

const isWebUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const reportDisplayValue = (key, value) => {
  if (key === 'snowVisionImage' && typeof value === 'string' && value) {
    return isWebUrl(value)
      ? value
      : 'Snow image retained in the saved report; open the app to view it.';
  }
  if (key === 'displayTrack' && Array.isArray(value)) {
    return `${value.length} mapped track points retained in the saved report; open the app to view the route geometry.`;
  }
  return value;
};

const renderReportValueText = (value, key = '', depth = 0) => {
  const displayValue = reportDisplayValue(key, value);
  if (!hasReportValue(displayValue)) return '';
  const indent = '  '.repeat(depth);
  if (!Array.isArray(displayValue) && !isRecord(displayValue)) {
    return String(typeof displayValue === 'boolean' ? (displayValue ? 'Yes' : 'No') : displayValue);
  }
  if (Array.isArray(displayValue)) {
    return displayValue.map((item) => {
      const rendered = renderReportValueText(item, '', depth + 1);
      return `${indent}- ${rendered.replace(/^\s+/u, '')}`;
    }).join('\n');
  }
  return Object.entries(displayValue)
    .filter(([, item]) => hasReportValue(item))
    .map(([childKey, item]) => {
      const rendered = renderReportValueText(item, childKey, depth + 1);
      if (!Array.isArray(reportDisplayValue(childKey, item)) && !isRecord(reportDisplayValue(childKey, item))) {
        return `${indent}${reportLabel(childKey)}: ${rendered}`;
      }
      return `${indent}${reportLabel(childKey)}:\n${rendered}`;
    })
    .join('\n');
};

const pickReportFields = (source, keys) => Object.fromEntries(
  keys.filter((key) => hasReportValue(source?.[key])).map((key) => [key, source[key]]),
);

const omitReportFields = (source, keys) => Object.fromEntries(
  Object.entries(isRecord(source) ? source : {}).filter(([key, value]) => !keys.includes(key) && hasReportValue(value)),
);

const buildCompleteReport = (report) => {
  const safetyData = isRecord(report?.safetyData) ? report.safetyData : {};
  const avalancheEnabled = safetyData.featureFlags?.avalancheDetails !== false;
  const snowpackEnabled = safetyData.featureFlags?.snowpackDetails !== false;
  const snowSectionTitle = avalancheEnabled && snowpackEnabled
    ? 'Avalanche and snowpack'
    : avalancheEnabled ? 'Avalanche' : 'Snowpack';
  const snowSectionKeys = [
    ...(avalancheEnabled ? ['avalanche'] : []),
    ...(snowpackEnabled ? ['snowpack'] : []),
  ];
  const groupedSafetyKeys = [
    'safety', 'pleasantness', 'terrainCondition', 'trail', 'gear',
    'forecast', 'weather', 'solar', 'atmosphere', 'heatRisk', 'airQuality', 'rainfall',
    'avalanche', 'snowpack', 'alerts', 'fireRisk', 'localConditions',
    'generatedAt', 'partialData', 'apiWarning', 'location', 'capabilities',
    'featureFlags', 'disabledProductDomains',
  ];
  const groupedReportKeys = ['version', 'savedAt', 'plan', 'preferences', 'safetyData', 'route', 'ai'];
  const sections = [
    ['Plan details', report?.plan],
    ['Decision, scoring, terrain, and gear', pickReportFields(safetyData, ['safety', 'pleasantness', 'terrainCondition', 'trail', 'gear'])],
    ['Weather, travel window, and atmosphere', pickReportFields(safetyData, ['forecast', 'weather', 'solar', 'atmosphere', 'heatRisk', 'airQuality', 'rainfall'])],
    [snowSectionTitle, pickReportFields(safetyData, snowSectionKeys)],
    ['Alerts, fire, access, and field observations', pickReportFields(safetyData, ['alerts', 'fireRisk', 'localConditions'])],
    ['Route plan and analysis', report?.route],
    ['AI analysis and report conversation', report?.ai],
    ['Report metadata and preferences', {
      savedAt: report?.savedAt,
      version: report?.version,
      preferences: report?.preferences,
      ...pickReportFields(safetyData, ['generatedAt', 'partialData', 'apiWarning', 'location', 'capabilities']),
    }],
    ['Additional report data', {
      safetyData: omitReportFields(safetyData, groupedSafetyKeys),
      report: omitReportFields(report, groupedReportKeys),
    }],
  ].filter(([, value]) => hasReportValue(value));

  return {
    text: sections.map(([heading, value]) => `${heading.toUpperCase()}\n${renderReportValueText(value)}`).join('\n\n'),
  };
};

const fullReportText = (value, fallback = '') => compactText(value, fallback, 100000);

const reportFactTable = (facts) => {
  const rows = facts.filter(([, value]) => hasReportValue(value));
  if (!rows.length) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows.map(([label, value, detail]) => `<tr>
    <td valign="top" style="width:31%;padding:9px 12px 9px 0;border-bottom:1px solid #e8ece7;color:#718078;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(label)}</td>
    <td valign="top" style="padding:9px 0;border-bottom:1px solid #e8ece7;color:#25362c;font-size:13px;font-weight:650;line-height:1.45;">${isWebUrl(value) ? `<a href="${escapeHtml(value)}" style="color:#315f45;word-break:break-word;">${escapeHtml(detail || value)}</a>` : `${escapeHtml(value)}${detail ? `<span style="display:block;margin-top:2px;color:#6a776f;font-size:11px;font-weight:400;line-height:1.45;">${escapeHtml(detail)}</span>` : ''}`}</td>
  </tr>`).join('')}</table>`;
};

const reportListHtml = (items, color = '#5d7767') => {
  const values = items.map((item) => fullReportText(item)).filter(Boolean);
  if (!values.length) return '';
  return `<ul style="margin:0;padding:0;list-style:none;">${values.map((item) => `<li style="margin:0 0 8px;padding:0;color:#405047;font-size:13px;line-height:1.55;"><span style="color:${color};font-size:16px;line-height:1;">•</span>&nbsp;&nbsp;${escapeHtml(item)}</li>`).join('')}</ul>`;
};

const reportNarrativeHtml = (title, value, tone = 'neutral') => {
  const text = fullReportText(value);
  if (!text) return '';
  const background = tone === 'warning' ? '#fff8e7' : tone === 'danger' ? '#fff1ee' : '#f5f8f5';
  const border = tone === 'warning' ? '#d5a43d' : tone === 'danger' ? '#b75547' : '#5d7767';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px;border-collapse:separate;background:${background};border-left:4px solid ${border};border-radius:9px;"><tr><td style="padding:13px 15px;">
    ${title ? `<strong style="display:block;margin:0 0 5px;color:#27382d;font-size:11px;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(title)}</strong>` : ''}
    <span style="display:block;color:#405047;font-size:13px;line-height:1.58;">${escapeHtml(text)}</span>
  </td></tr></table>`;
};

const reportSectionHtml = ({ eyebrow, title, intro, body }) => {
  if (!body) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;border-collapse:separate;background:#ffffff;border:1px solid #dce3dc;border-radius:12px;overflow:hidden;">
    <tr><td bgcolor="#f3f6f3" style="padding:14px 17px 12px;background:#f3f6f3;border-bottom:1px solid #dfe5df;">
      ${eyebrow ? `<p style="margin:0 0 4px;color:#54705e;font-size:9px;font-weight:850;letter-spacing:.11em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>` : ''}
      <h2 style="margin:0;color:#1e3025;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:600;line-height:1.2;">${escapeHtml(title)}</h2>
      ${intro ? `<p style="margin:5px 0 0;color:#66736b;font-size:11px;line-height:1.5;">${escapeHtml(intro)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:8px 17px 14px;">${body}</td></tr>
  </table>`;
};

const reportItemCardsHtml = (items, renderItem) => {
  const rendered = items.map(renderItem).filter(Boolean);
  return rendered.map((content, index) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:${index ? '9px' : '4px'} 0 0;border-collapse:separate;background:#fbfcfb;border:1px solid #e3e8e3;border-radius:9px;"><tr><td style="padding:12px 13px;">${content}</td></tr></table>`).join('');
};

const buildReadableReportHtml = (report, { temperatureUnit, windUnit }) => {
  const data = isRecord(report?.safetyData) ? report.safetyData : {};
  const safety = isRecord(data.safety) ? data.safety : {};
  const weather = isRecord(data.weather) ? data.weather : {};
  const solar = isRecord(data.solar) ? data.solar : {};
  const forecast = isRecord(data.forecast) ? data.forecast : {};
  const atmosphere = isRecord(data.atmosphere) ? data.atmosphere : {};
  const avalanche = isRecord(data.avalanche) ? data.avalanche : {};
  const snowpack = isRecord(data.snowpack) ? data.snowpack : {};
  const terrain = isRecord(data.terrainCondition) ? data.terrainCondition : {};
  const alerts = isRecord(data.alerts) ? data.alerts : {};
  const airQuality = isRecord(data.airQuality) ? data.airQuality : {};
  const rainfall = isRecord(data.rainfall) ? data.rainfall : {};
  const heatRisk = isRecord(data.heatRisk) ? data.heatRisk : {};
  const fireRisk = isRecord(data.fireRisk) ? data.fireRisk : {};
  const local = isRecord(data.localConditions) ? data.localConditions : {};
  const route = isRecord(report?.route) ? report.route : {};
  const routeAnalysis = isRecord(route.routeAnalysis) ? route.routeAnalysis : {};
  const ai = isRecord(report?.ai) ? report.ai : {};
  const temp = (value) => {
    const number = finiteNumber(value);
    if (number === null) return '';
    return temperatureUnit === 'c' ? `${Math.round((number - 32) * (5 / 9))}°C` : `${Math.round(number)}°F`;
  };
  const wind = (value) => {
    const number = finiteNumber(value);
    if (number === null) return '';
    return windUnit === 'kph' ? `${Math.round(number * 1.609344)} kph` : `${Math.round(number)} mph`;
  };
  const percent = (value) => finiteNumber(value) === null ? '' : `${Math.round(Number(value))}%`;
  const numberWithUnit = (value, unit) => finiteNumber(value) === null ? '' : `${Math.round(Number(value) * 10) / 10} ${unit}`;
  const sections = [];

  const decisionBody = [
    reportFactTable([
      ['Primary hazard', fullReportText(safety.primaryHazard, 'Not identified')],
      ['Confidence', percent(safety.confidence)],
      ['Comfort outlook', isRecord(data.pleasantness) ? `${fullReportText(data.pleasantness.label, 'Unknown')}${finiteNumber(data.pleasantness.score) === null ? '' : ` · ${Math.round(Number(data.pleasantness.score))}/100`}` : ''],
    ]),
    reportNarrativeHtml('Decision context', Array.isArray(safety.explanations) ? safety.explanations.join(' · ') : ''),
    reportListHtml(Array.isArray(safety.factors) ? safety.factors.map((factor) => factor?.message || factor?.hazard) : []),
    reportListHtml(Array.isArray(safety.confidenceReasons) ? safety.confidenceReasons : [], '#87958c'),
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Verdict', title: 'Decision snapshot', intro: 'The strongest signals behind the score and conditions tier.', body: decisionBody }));

  const trendRows = Array.isArray(weather.trend) ? weather.trend : [];
  const hourlyHtml = trendRows.length ? `<p style="margin:14px 0 7px;color:#54705e;font-size:9px;font-weight:850;letter-spacing:.10em;text-transform:uppercase;">Hourly travel window</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:11px;">
      <tr><th width="22%" align="left" style="padding:7px 5px;border-bottom:2px solid #cbd5cc;color:#6d7a72;">Time</th><th align="left" style="padding:7px 5px;border-bottom:2px solid #cbd5cc;color:#6d7a72;">Forecast</th></tr>
      ${trendRows.map((point) => `<tr><td valign="top" style="padding:8px 5px;border-bottom:1px solid #e8ece8;color:#34463a;font-weight:750;">${escapeHtml(fullReportText(point?.time || point?.timeIso, '—'))}</td><td style="padding:8px 5px;border-bottom:1px solid #e8ece8;"><strong style="display:block;color:#34463a;font-size:11px;">${escapeHtml(fullReportText(point?.condition, '—'))}</strong><span style="display:block;margin-top:2px;color:#6a776f;font-size:10px;line-height:1.45;">${escapeHtml([temp(point?.temp), `wind ${wind(point?.wind) || '—'}`, `gusts ${wind(point?.gust) || '—'}`, `${percent(point?.precipChance) || '—'} precip`].filter(Boolean).join(' · '))}</span></td></tr>`).join('')}
    </table>` : '';
  const elevationRows = Array.isArray(weather.elevationForecast) ? weather.elevationForecast : [];
  const elevationHtml = elevationRows.length ? reportItemCardsHtml(elevationRows, (band) => `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(band?.label, numberWithUnit(band?.elevationFt, 'ft')))}</strong><span style="display:block;margin-top:4px;color:#5f6d65;font-size:12px;line-height:1.5;">${escapeHtml([temp(band?.temp), `feels ${temp(band?.feelsLike)}`, `wind ${wind(band?.windSpeed)}`, `gusts ${wind(band?.windGust)}`].filter(Boolean).join(' · '))}</span>`) : '';
  const weatherBody = [
    reportFactTable([
      ['Forecast period', [fullReportText(forecast.selectedStartTime), fullReportText(forecast.selectedEndTime)].filter(Boolean).join(' – ')],
      ['Conditions', fullReportText(weather.description || weather.condition, 'Not available')],
      ['Temperature', temp(weather.temp), temp(weather.feelsLike) ? `Feels like ${temp(weather.feelsLike)}` : ''],
      ['Wind', wind(weather.windSpeed), wind(weather.windGust) ? `Gusts ${wind(weather.windGust)} · ${fullReportText(weather.windDirection)}` : fullReportText(weather.windDirection)],
      ['Precipitation', percent(weather.precipChance)],
      ['Humidity / cloud', [percent(weather.humidity), percent(weather.cloudCover)].filter(Boolean).join(' · ')],
      ['Sunrise / sunset', [fullReportText(solar.sunrise), fullReportText(solar.sunset)].filter(Boolean).join(' · '), fullReportText(solar.dayLength)],
      ['Visibility', isRecord(weather.visibilityRisk) ? fullReportText(weather.visibilityRisk.level, 'Unknown') : '', isRecord(weather.visibilityRisk) ? fullReportText(weather.visibilityRisk.summary) : ''],
    ]),
    reportNarrativeHtml('Elevation forecast', weather.elevationForecastNote),
    elevationHtml,
    hourlyHtml,
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Travel', title: 'Weather and travel window', intro: 'Forecast conditions for the selected start and travel window.', body: weatherBody }));

  const terrainBody = [
    reportFactTable([
      ['Surface', fullReportText(terrain.label || data.trail, 'Not available')],
      ['Impact', fullReportText(terrain.impact)],
      ['Recommended travel', fullReportText(terrain.recommendedTravel)],
      ['Freezing level', numberWithUnit(atmosphere.freezingLevelFt, 'ft')],
      ['Snow level', numberWithUnit(atmosphere.snowLevelFt, 'ft')],
      ['UV', finiteNumber(atmosphere.uvIndex) === null ? '' : `${atmosphere.uvIndex} · ${fullReportText(atmosphere.uvCategory)}`],
      ['Thunder', percent(atmosphere.thunderProbability), fullReportText(atmosphere.thunderCategory)],
    ]),
    reportNarrativeHtml('Terrain summary', terrain.summary),
    reportListHtml(Array.isArray(terrain.reasons) ? terrain.reasons : []),
    isRecord(terrain.snowProfile) ? reportNarrativeHtml(fullReportText(terrain.snowProfile.label, 'Snow surface'), terrain.snowProfile.summary) : '',
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Terrain', title: 'Surface and atmosphere', intro: 'Modeled surface character and mountain-weather context.', body: terrainBody }));

  const problems = Array.isArray(avalanche.problems) ? avalanche.problems : [];
  const avalancheBody = [
    reportFactTable([
      ['Danger', avalanche.dangerUnknown ? 'Unknown — verify the bulletin' : fullReportText(avalanche.risk, 'Not available')],
      ['Relevance', avalanche.relevant === false ? 'Not applicable to this objective' : fullReportText(avalanche.relevanceReason, 'Applicable terrain may be present')],
      ['Center / zone', [fullReportText(avalanche.center), fullReportText(avalanche.zone)].filter(Boolean).join(' · ')],
      ['Published / expires', [fullReportText(avalanche.publishedTime), fullReportText(avalanche.expiresTime)].filter(Boolean).join(' · ')],
      ['Bulletin', fullReportText(avalanche.link), 'Open official avalanche bulletin'],
    ]),
    reportNarrativeHtml('Bottom line', avalanche.bottomLine, avalanche.dangerUnknown ? 'warning' : 'neutral'),
    reportNarrativeHtml('Travel advice', avalanche.advice, 'warning'),
    reportItemCardsHtml(problems, (problem) => {
      const title = fullReportText(problem?.name, 'Avalanche problem');
      const meta = [fullReportText(problem?.likelihood), Array.isArray(problem?.size) ? problem.size.join('–') : fullReportText(problem?.size), Array.isArray(problem?.location) ? problem.location.join(', ') : fullReportText(problem?.location)].filter(Boolean).join(' · ');
      const discussion = fullReportText(problem?.discussion || problem?.problem_description);
      return `<strong style="display:block;color:#26382c;font-size:14px;">${escapeHtml(title)}</strong>${meta ? `<span style="display:block;margin-top:3px;color:#8a641e;font-size:11px;font-weight:700;">${escapeHtml(meta)}</span>` : ''}${discussion ? `<p style="margin:7px 0 0;color:#526158;font-size:12px;line-height:1.55;">${escapeHtml(discussion)}</p>` : ''}`;
    }),
  ].join('');
  if (data.featureFlags?.avalancheDetails !== false) {
    sections.push(reportSectionHtml({ eyebrow: 'Avalanche', title: 'Avalanche conditions', intro: 'Official bulletin context and listed avalanche problems.', body: avalancheBody }));
  }

  const snowBody = [
    reportNarrativeHtml('Snowpack summary', snowpack.summary),
    reportFactTable([
      ['SNOTEL', isRecord(snowpack.snotel) ? fullReportText(snowpack.snotel.stationName, 'Nearby station') : '', isRecord(snowpack.snotel) ? [numberWithUnit(snowpack.snotel.snowDepthIn, 'in depth'), numberWithUnit(snowpack.snotel.sweIn, 'in SWE'), fullReportText(snowpack.snotel.observedDate)].filter(Boolean).join(' · ') : ''],
      ['NOHRSC', isRecord(snowpack.nohrsc) ? [numberWithUnit(snowpack.nohrsc.snowDepthIn, 'in depth'), numberWithUnit(snowpack.nohrsc.sweIn, 'in SWE')].filter(Boolean).join(' · ') : '', isRecord(snowpack.nohrsc) ? fullReportText(snowpack.nohrsc.sampledTime) : ''],
      ['CDEC', isRecord(snowpack.cdec) ? fullReportText(snowpack.cdec.stationName, 'Nearby station') : '', isRecord(snowpack.cdec) ? [numberWithUnit(snowpack.cdec.snowDepthIn, 'in depth'), numberWithUnit(snowpack.cdec.sweIn, 'in SWE'), fullReportText(snowpack.cdec.observedDate)].filter(Boolean).join(' · ') : ''],
      ['Historical context', isRecord(snowpack.historical) ? fullReportText(snowpack.historical.summary) : ''],
    ]),
    reportNarrativeHtml('Snow image analysis', ai.snowVisionAnalysis),
  ].join('');
  if (data.featureFlags?.snowpackDetails !== false) {
    sections.push(reportSectionHtml({ eyebrow: 'Snowpack', title: 'Snowpack and snow surface', intro: 'Station, modeled, historical, and image-derived snow context.', body: snowBody }));
  }

  const alertItems = Array.isArray(alerts.alerts) ? alerts.alerts : [];
  const closures = isRecord(local.closures) && Array.isArray(local.closures.alerts) ? local.closures.alerts : [];
  const roads = isRecord(local.access) && Array.isArray(local.access.roads) ? local.access.roads : [];
  const alertBody = [
    reportFactTable([
      ['Weather alerts', finiteNumber(alerts.activeCount) === null ? 'None included' : `${Math.round(Number(alerts.activeCount))} active`, fullReportText(alerts.highestSeverity)],
      ['Access alerts', isRecord(local.closures) && finiteNumber(local.closures.alertCount) !== null ? `${Math.round(Number(local.closures.alertCount))} active` : 'None included', isRecord(local.closures) ? fullReportText(local.closures.parkName) : ''],
      ['Nearby observation', isRecord(local.weatherObservation) ? fullReportText(local.weatherObservation.stationName, 'Available') : '', isRecord(local.weatherObservation) ? [temp(local.weatherObservation.tempF), wind(local.weatherObservation.windMph), fullReportText(local.weatherObservation.observedTime)].filter(Boolean).join(' · ') : ''],
      ['Radar / lightning', isRecord(local.radar) ? fullReportText(local.radar.status, 'Available') : '', isRecord(local.radar?.lightning) ? fullReportText(local.radar.lightning.note) : ''],
      ['Streamflow', isRecord(local.streamflow) ? fullReportText(local.streamflow.trend, 'Available') : '', isRecord(local.streamflow) ? [fullReportText(local.streamflow.siteName), numberWithUnit(local.streamflow.dischargeCfs, 'cfs')].filter(Boolean).join(' · ') : ''],
    ]),
    reportItemCardsHtml(alertItems, (alert) => `<strong style="display:block;color:#79372e;font-size:14px;">${escapeHtml(fullReportText(alert?.headline || alert?.event, 'Weather alert'))}</strong><span style="display:block;margin-top:3px;color:#7d655f;font-size:11px;font-weight:700;">${escapeHtml([fullReportText(alert?.severity), fullReportText(alert?.urgency), fullReportText(alert?.ends || alert?.expires)].filter(Boolean).join(' · '))}</span>${fullReportText(alert?.description) ? `<p style="margin:7px 0 0;color:#526158;font-size:12px;line-height:1.55;">${escapeHtml(fullReportText(alert.description))}</p>` : ''}${fullReportText(alert?.instruction) ? reportNarrativeHtml('Instruction', alert.instruction, 'warning') : ''}`),
    reportItemCardsHtml(closures, (closure) => `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(closure?.title, 'Access notice'))}</strong>${fullReportText(closure?.description) ? `<p style="margin:6px 0 0;color:#526158;font-size:12px;line-height:1.55;">${escapeHtml(fullReportText(closure.description))}</p>` : ''}`),
    reportItemCardsHtml(roads, (road) => `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(road?.name, 'Access road'))}</strong><span style="display:block;margin-top:3px;color:#66736b;font-size:11px;">${escapeHtml([fullReportText(road?.routeStatus), fullReportText(road?.operatingLevel), fullReportText(road?.county)].filter(Boolean).join(' · '))}</span>`),
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Field checks', title: 'Alerts, access, and observations', intro: 'Official alerts and nearby field signals captured in the report.', body: alertBody }));

  const environmentBody = [
    reportFactTable([
      ['Air quality', finiteNumber(airQuality.usAqi) === null ? fullReportText(airQuality.status) : `AQI ${Math.round(Number(airQuality.usAqi))} · ${fullReportText(airQuality.category)}`, fullReportText(airQuality.note)],
      ['Rain / snow window', isRecord(rainfall.expected) ? [numberWithUnit(rainfall.expected.rainWindowIn, 'in rain'), numberWithUnit(rainfall.expected.snowWindowIn, 'in snow')].filter(Boolean).join(' · ') : '', isRecord(rainfall.expected) ? fullReportText(rainfall.expected.note) : fullReportText(rainfall.note)],
      ['Heat risk', fullReportText(heatRisk.label), fullReportText(heatRisk.guidance)],
      ['Fire risk', fullReportText(fireRisk.label), fullReportText(fireRisk.guidance)],
      ['Nearby wildfire', isRecord(local.wildfire) && finiteNumber(local.wildfire.nearbyIncidentCount) !== null ? `${Math.round(Number(local.wildfire.nearbyIncidentCount))} incident${Math.round(Number(local.wildfire.nearbyIncidentCount)) === 1 ? '' : 's'}` : '', isRecord(local.wildfire) ? fullReportText(local.wildfire.note) : ''],
      ['Smoke', isRecord(local.smoke) ? fullReportText(local.smoke.currentCategory, 'Available') : '', isRecord(local.smoke) ? numberWithUnit(local.smoke.currentPm25, 'µg/m³ PM2.5') : ''],
    ]),
    reportListHtml(Array.isArray(heatRisk.reasons) ? heatRisk.reasons : []),
    reportListHtml(Array.isArray(fireRisk.reasons) ? fireRisk.reasons : []),
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Environment', title: 'Air, heat, precipitation, and fire', intro: 'Additional environmental signals that can affect the plan.', body: environmentBody }));

  const gear = Array.isArray(data.gear) ? data.gear : [];
  if (gear.length) {
    sections.push(reportSectionHtml({ eyebrow: 'Equipment', title: 'Recommended gear', intro: 'Items suggested by the conditions in this report.', body: reportItemCardsHtml(gear, (item) => typeof item === 'string'
      ? `<strong style="color:#26382c;font-size:13px;">${escapeHtml(fullReportText(item))}</strong>`
      : `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(item?.title, 'Gear item'))}</strong><span style="display:block;margin-top:3px;color:#718078;font-size:10px;font-weight:800;text-transform:uppercase;">${escapeHtml(fullReportText(item?.category))}</span>${fullReportText(item?.detail) ? `<p style="margin:6px 0 0;color:#526158;font-size:12px;line-height:1.5;">${escapeHtml(fullReportText(item.detail))}</p>` : ''}`) }));
  }

  const summaries = Array.isArray(routeAnalysis.summaries) ? routeAnalysis.summaries : [];
  const suggestions = Array.isArray(route.routeSuggestions) ? route.routeSuggestions : [];
  const routeBody = [
    reportFactTable([
      ['Selected route', fullReportText(route.customRouteName || route.gpxRoute?.name, 'No route selected')],
      ['Source', fullReportText(routeAnalysis.routeSource)],
      ['Analysis type', fullReportText(routeAnalysis.analysisSource)],
      ['Partial data', routeAnalysis.partialData === true ? 'Yes — review waypoint gaps' : 'No'],
    ]),
    reportNarrativeHtml('Route analysis', routeAnalysis.analysis),
    reportItemCardsHtml(summaries, (summary) => `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(summary?.name, 'Waypoint'))}</strong><span style="display:block;margin-top:3px;color:#66736b;font-size:11px;line-height:1.5;">${escapeHtml([fullReportText(summary?.etaTime), numberWithUnit(summary?.elev_ft, 'ft'), finiteNumber(summary?.score) === null ? '' : `score ${Math.round(Number(summary.score))}`, fullReportText(summary?.weather?.description), temp(summary?.weather?.temp), wind(summary?.weather?.windGust) ? `gusts ${wind(summary.weather.windGust)}` : ''].filter(Boolean).join(' · '))}</span>`),
    suggestions.length ? reportItemCardsHtml(suggestions, (suggestion) => `<strong style="display:block;color:#26382c;font-size:13px;">${escapeHtml(fullReportText(suggestion?.name, 'Route option'))}</strong><span style="display:block;margin-top:3px;color:#66736b;font-size:11px;">${escapeHtml([numberWithUnit(suggestion?.distance_rt_miles, 'mi round trip'), numberWithUnit(suggestion?.elev_gain_ft, 'ft gain'), fullReportText(suggestion?.class)].filter(Boolean).join(' · '))}</span>${fullReportText(suggestion?.description) ? `<p style="margin:6px 0 0;color:#526158;font-size:12px;line-height:1.5;">${escapeHtml(fullReportText(suggestion.description))}</p>` : ''}`) : '',
  ].join('');
  sections.push(reportSectionHtml({ eyebrow: 'Route', title: 'Route plan and waypoint conditions', intro: 'Route-specific analysis retained with this report.', body: routeBody }));

  const chatMessages = Array.isArray(ai.reportChatMessages) ? ai.reportChatMessages : [];
  const chatHtml = reportItemCardsHtml(chatMessages, (message) => {
    const text = Array.isArray(message?.parts) ? message.parts.map((part) => part?.text).filter(Boolean).join('\n') : '';
    if (!text) return '';
    return `<span style="display:block;margin-bottom:4px;color:#718078;font-size:9px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(message?.role === 'user' ? 'You' : 'Report assistant')}</span><p style="margin:0;color:#405047;font-size:12px;line-height:1.58;">${escapeHtml(fullReportText(text))}</p>`;
  });
  const aiBody = [
    reportNarrativeHtml('AI briefing', ai.aiBriefNarrative),
    reportNarrativeHtml('Snow image analysis', ai.snowVisionAnalysis),
    chatHtml,
  ].join('');
  if (aiBody) sections.push(reportSectionHtml({ eyebrow: 'Analysis', title: 'AI briefing and report conversation', intro: 'Generated interpretation saved with this report.', body: aiBody }));

  const sourcesBody = reportFactTable([
    ['Generated', fullReportText(data.generatedAt || report?.savedAt)],
    ['Location', isRecord(data.location) ? `${data.location.lat}, ${data.location.lon}` : ''],
    ['Weather source', fullReportText(weather.forecastLink), 'Open official weather forecast'],
    ['Avalanche source', fullReportText(avalanche.link), 'Open official avalanche bulletin'],
    ['Rainfall source', fullReportText(rainfall.link), 'Open precipitation source'],
    ['Data completeness', data.partialData ? 'Some inputs were incomplete' : 'All expected inputs were included', fullReportText(data.apiWarning)],
  ]);
  sections.push(reportSectionHtml({ eyebrow: 'Sources', title: 'Sources and report details', intro: 'Generation time, location, links, and data-completeness status.', body: sourcesBody }));

  return sections.filter(Boolean).join('');
};

const ACTIVITY_LABELS = Object.freeze({
  hiking: 'Mountain hiking',
  scrambling: 'Exposed scrambling',
  'alpine-climbing': 'Alpine climbing',
  'snow-climbing': 'Snow climbing',
  'ski-touring': 'Ski touring',
  'trail-running': 'Trail running',
  backcountry: 'General backcountry',
});

const reportEmailShell = ({
  preview,
  objectiveName,
  forecastDate,
  startTime,
  activityLabel,
  travelWindowLabel,
  scoreValue,
  tier,
  accent,
  accentSoft,
  greeting,
  condition,
  weatherDetail,
  avalancheEnabled,
  avalancheRisk,
  alertHeadline,
  alertDetail,
  highlightsHtml,
  partialWarning,
  completeReportHtml,
  actionUrl,
}) => {
  const safeUrl = escapeHtml(actionUrl);
  const partialBlock = partialWarning
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-collapse:separate;background:#fff6dd;border:1px solid #ead59a;border-radius:12px;"><tr><td style="padding:14px 16px;color:#6c531d;font-size:13px;line-height:1.55;"><strong style="display:block;margin:0 0 3px;color:#5d4616;">Some source data was incomplete</strong>${escapeHtml(partialWarning)}</td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(preview)}</title>
    <style>
      @media only screen and (max-width:620px) {
        .email-card { width:100% !important; border-radius:0 !important; }
        .mobile-pad { padding-left:20px !important; padding-right:20px !important; }
        .mobile-stack { display:block !important; width:100% !important; }
        .mobile-stack + .mobile-stack { border-left:0 !important; border-top:1px solid #e5e9e3 !important; }
        .hero-score { width:76px !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#edf1ec;color:#172019;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#edf1ec" style="width:100%;background:#edf1ec;padding:34px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" class="email-card" style="width:100%;max-width:640px;overflow:hidden;background:#ffffff;border:1px solid #d9e0d8;border-radius:20px;box-shadow:0 18px 48px rgba(27,60,40,.10);">
            <tr>
              <td class="mobile-pad" bgcolor="#173d2b" style="padding:30px 34px 28px;background:#173d2b;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="top" style="padding-right:18px;">
                      <p style="margin:0 0 20px;color:#b8d5c4;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">Backcountry Conditions · Field report</p>
                      <h1 style="margin:0 0 8px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:500;line-height:1.08;letter-spacing:-.02em;">${escapeHtml(objectiveName)}</h1>
                      <p style="margin:0;color:#dbe9df;font-size:14px;line-height:1.5;">${escapeHtml(forecastDate)} · ${escapeHtml(startTime)}</p>
                    </td>
                    <td width="92" valign="top" align="right" class="hero-score" style="width:92px;">
                      <table role="presentation" width="88" cellspacing="0" cellpadding="0" style="width:88px;background:#ffffff;border-radius:15px;">
                        <tr><td align="center" style="padding:14px 6px 12px;">
                          <strong style="display:block;color:${accent};font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:600;line-height:1;">${escapeHtml(scoreValue)}</strong>
                          <span style="display:block;margin-top:5px;color:#69756c;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">out of 100</span>
                        </td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="mobile-pad" style="padding:0 34px 34px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;border-collapse:separate;background:${accentSoft};border:1px solid #dfe5de;border-radius:0 0 14px 14px;">
                  <tr>
                    <td style="padding:13px 16px;color:${accent};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(tier)} conditions signal</td>
                    <td align="right" style="padding:13px 16px;color:#506057;font-size:12px;">Point-in-time snapshot</td>
                  </tr>
                </table>

                <p style="margin:0 0 20px;color:#445249;font-size:15px;line-height:1.65;">${greeting} Here is the field report you sent to your account email. Use it to orient the plan, then recheck live sources before departure.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:separate;border:1px solid #dfe5de;border-radius:14px;">
                  <tr>
                    <td width="50%" class="mobile-stack" valign="top" style="width:50%;padding:16px 18px;border-right:1px solid #e5e9e3;">
                      <span style="display:block;margin:0 0 5px;color:#7a867e;font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;">Activity</span>
                      <strong style="display:block;color:#1c2c22;font-size:14px;line-height:1.35;">${escapeHtml(activityLabel)}</strong>
                    </td>
                    <td width="50%" class="mobile-stack" valign="top" style="width:50%;padding:16px 18px;">
                      <span style="display:block;margin:0 0 5px;color:#7a867e;font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;">Travel window</span>
                      <strong style="display:block;color:#1c2c22;font-size:14px;line-height:1.35;">${escapeHtml(travelWindowLabel)}</strong>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 10px;color:#6c786f;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Conditions at a glance</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:separate;border:1px solid #dfe5de;border-radius:14px;">
                  <tr>
                    <td width="${avalancheEnabled ? '33.33%' : '50%'}" class="mobile-stack" valign="top" style="width:${avalancheEnabled ? '33.33%' : '50%'};padding:18px 16px;border-right:1px solid #e5e9e3;">
                      <span style="display:block;margin:0 0 7px;color:#467159;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Weather</span>
                      <strong style="display:block;margin:0 0 5px;color:#1c2c22;font-size:15px;line-height:1.35;">${escapeHtml(condition)}</strong>
                      <span style="display:block;color:#69756c;font-size:12px;line-height:1.5;">${escapeHtml(weatherDetail)}</span>
                    </td>
                    ${avalancheEnabled ? `<td width="33.33%" class="mobile-stack" valign="top" style="width:33.33%;padding:18px 16px;border-right:1px solid #e5e9e3;">
                      <span style="display:block;margin:0 0 7px;color:#9a6a14;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Avalanche</span>
                      <strong style="display:block;margin:0 0 5px;color:#1c2c22;font-size:15px;line-height:1.35;">${escapeHtml(avalancheRisk)}</strong>
                      <span style="display:block;color:#69756c;font-size:12px;line-height:1.5;">Verify the latest official bulletin.</span>
                    </td>` : ''}
                    <td width="${avalancheEnabled ? '33.33%' : '50%'}" class="mobile-stack" valign="top" style="width:${avalancheEnabled ? '33.33%' : '50%'};padding:18px 16px;">
                      <span style="display:block;margin:0 0 7px;color:#a34538;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Alerts</span>
                      <strong style="display:block;margin:0 0 5px;color:#1c2c22;font-size:15px;line-height:1.35;">${escapeHtml(alertHeadline)}</strong>
                      <span style="display:block;color:#69756c;font-size:12px;line-height:1.5;">${escapeHtml(alertDetail)}</span>
                    </td>
                  </tr>
                </table>

                ${partialBlock}

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;border-collapse:separate;background:#f6f8f5;border-left:4px solid ${accent};border-radius:12px;">
                  <tr><td style="padding:18px 19px;">
                    <p style="margin:0 0 10px;color:#27382d;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;">What matters most</p>
                    <ul style="margin:0;padding-left:20px;color:#425148;font-size:14px;line-height:1.6;">${highlightsHtml}</ul>
                  </td></tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;border-collapse:separate;background:#173d2b;border-radius:14px;">
                  <tr><td style="padding:18px 20px;color:#ffffff;">
                    <p style="margin:0 0 4px;color:#b8d5c4;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Full field record</p>
                    <h2 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:500;line-height:1.2;">Complete report</h2>
                    <p style="margin:7px 0 0;color:#dbe9df;font-size:12px;line-height:1.5;">The full report is organized below in the same decision-first order as the app.</p>
                  </td></tr>
                </table>
                <div style="margin:0 0 26px;">${completeReportHtml}</div>

                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;"><tr><td bgcolor="#315f45" style="border-radius:10px;"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;">Open Backcountry Conditions&nbsp;&nbsp;→</a></td></tr></table>
                <p style="margin:0 0 6px;color:#7a867e;font-size:11px;line-height:1.5;">Button not working? Copy this link:</p>
                <p style="margin:0;word-break:break-all;font-size:11px;line-height:1.5;"><a href="${safeUrl}" style="color:#315f45;">${safeUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td class="mobile-pad" bgcolor="#f6f8f5" style="padding:22px 34px;background:#f6f8f5;border-top:1px solid #e3e8e2;color:#6b776e;font-size:11px;line-height:1.55;">
                <strong style="display:block;margin:0 0 4px;color:#34463a;">Planning support, not a safety guarantee.</strong>
                Forecasts and automated analysis can be incomplete or change quickly. Recheck official sources, access, and current field conditions before departure.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildReportEmail = ({ displayName, report, actionUrl }) => {
  const plan = report?.plan && typeof report.plan === 'object' ? report.plan : {};
  const rawSafetyData = report?.safetyData && typeof report.safetyData === 'object' ? report.safetyData : {};
  const safetyData = sanitizeReportForFeatureFlags(rawSafetyData, rawSafetyData.featureFlags || {});
  const filteredReport = { ...report, safetyData };
  const preferences = report?.preferences && typeof report.preferences === 'object' ? report.preferences : {};
  const safety = safetyData?.safety && typeof safetyData.safety === 'object' ? safetyData.safety : {};
  const weather = safetyData?.weather && typeof safetyData.weather === 'object' ? safetyData.weather : {};
  const avalanche = safetyData?.avalanche && typeof safetyData.avalanche === 'object' ? safetyData.avalanche : {};
  const avalancheEnabled = safetyData.featureFlags?.avalancheDetails !== false;
  const alerts = safetyData?.alerts && typeof safetyData.alerts === 'object' ? safetyData.alerts : {};
  const objectiveName = compactText(plan.objectiveName, 'Backcountry objective', 160);
  const forecastDate = compactText(plan.forecastDate, 'Date not available', 32);
  const startTime = compactText(plan.alpineStartTime, 'Time not available', 32);
  const score = finiteNumber(safety.score);
  const tier = compactText(safety.tier, 'Conditions review', 40);
  const condition = compactText(weather.description || weather.condition, 'Weather details are in the full report.', 180);
  const temperature = finiteNumber(weather.temp);
  const windSpeed = finiteNumber(weather.windSpeed);
  const windGust = finiteNumber(weather.windGust);
  const precipitation = finiteNumber(weather.precipChance);
  const avalancheRisk = compactText(
    avalanche.dangerUnknown ? 'Danger unknown — verify the current bulletin.' : avalanche.risk,
    avalanche.relevant === false ? 'Not applicable to this objective.' : 'Review the current official bulletin.',
    180,
  );
  const activeAlerts = finiteNumber(alerts.activeCount);
  const travelWindowHours = finiteNumber(plan.travelWindowHours);
  const temperatureUnit = preferences.temperatureUnit === 'c' ? 'c' : 'f';
  const windUnit = preferences.windSpeedUnit === 'kph' ? 'kph' : 'mph';
  const displayTemperature = temperature === null
    ? null
    : temperatureUnit === 'c' ? (temperature - 32) * (5 / 9) : temperature;
  const displayWindSpeed = windSpeed === null ? null : windUnit === 'kph' ? windSpeed * 1.609344 : windSpeed;
  const displayWindGust = windGust === null ? null : windUnit === 'kph' ? windGust * 1.609344 : windGust;
  const explanations = Array.isArray(safety.explanations)
    ? safety.explanations.map((item) => compactText(item, '', 240)).filter(Boolean).slice(0, 3)
    : [];
  const greeting = displayName ? `Hi ${escapeHtml(compactText(displayName, '', 80))},` : 'Hello,';
  const scoreLine = score === null ? tier : `${Math.round(score)}/100 · ${tier}`;
  const scoreValue = score === null ? '—' : String(Math.round(score));
  const tierKey = tier.toLowerCase();
  const accent = tierKey.includes('high') || tierKey.includes('extreme')
    ? '#a34538'
    : tierKey.includes('caution') || tierKey.includes('elevated')
      ? '#9a6a14'
      : '#315f45';
  const accentSoft = accent === '#a34538' ? '#fff0ed' : accent === '#9a6a14' ? '#fff6dd' : '#edf6f0';
  const activityLabel = Object.hasOwn(ACTIVITY_LABELS, preferences.defaultActivity)
    ? ACTIVITY_LABELS[preferences.defaultActivity]
    : 'General backcountry';
  const travelWindowLabel = travelWindowHours === null
    ? `${startTime} departure`
    : `${startTime} departure · ${Math.round(travelWindowHours)}h window`;
  const weatherParts = [
    displayTemperature === null ? null : `${Math.round(displayTemperature)}°${temperatureUnit.toUpperCase()}`,
    displayWindSpeed === null ? null : `wind ${Math.round(displayWindSpeed)} ${windUnit}`,
    displayWindGust === null ? null : `gusts ${Math.round(displayWindGust)} ${windUnit}`,
    precipitation === null ? null : `${Math.round(precipitation)}% precipitation`,
  ].filter(Boolean);
  const alertLine = activeAlerts && activeAlerts > 0
    ? `${Math.round(activeAlerts)} active weather alert${Math.round(activeAlerts) === 1 ? '' : 's'} require review.`
    : 'No active weather alerts were included in this report snapshot.';
  const alertHeadline = activeAlerts && activeAlerts > 0
    ? `${Math.round(activeAlerts)} active alert${Math.round(activeAlerts) === 1 ? '' : 's'}`
    : 'None included';
  const alertDetail = activeAlerts && activeAlerts > 0
    ? compactText(alerts.highestSeverity, 'Review alert details in the app.', 100)
    : 'No active alerts in this snapshot.';
  const partialWarning = safetyData.partialData
    ? compactText(safetyData.apiWarning, 'Some report inputs were unavailable when this snapshot was generated.', 320)
    : '';
  const textHighlights = explanations.length
    ? explanations.map((item) => `- ${item}`).join('\n')
    : '- Recheck official forecasts, access, and field observations before departure.';
  const htmlHighlights = (explanations.length
    ? explanations
    : ['Recheck official forecasts, access, and field observations before departure.'])
    .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
    .join('');
  const completeReport = buildCompleteReport(filteredReport);
  const readableReportHtml = buildReadableReportHtml(filteredReport, { temperatureUnit, windUnit });

  return {
    subject: `${objectiveName} report · ${forecastDate}`,
    text: `${displayName ? `Hi ${compactText(displayName, '', 80)},\n\n` : ''}${objectiveName}\n${forecastDate} at ${startTime}\n${scoreLine}\n\nWeather: ${condition}${weatherParts.length ? ` (${weatherParts.join(', ')})` : ''}${avalancheEnabled ? `\nAvalanche: ${avalancheRisk}` : ''}\nAlerts: ${alertLine}\n\nKey report notes:\n${textHighlights}\n\nCOMPLETE REPORT\n\n${completeReport.text}\n\nOpen Backcountry Conditions:\n${actionUrl}\n\nThis is a point-in-time planning snapshot, not a safety guarantee. Recheck official sources and current field conditions before departure.`,
    html: reportEmailShell({
      preview: `${objectiveName} report for ${forecastDate}`,
      objectiveName,
      forecastDate,
      startTime,
      activityLabel,
      travelWindowLabel,
      scoreValue,
      tier,
      accent,
      accentSoft,
      greeting,
      condition,
      weatherDetail: weatherParts.length ? weatherParts.join(' · ') : 'See the full report for weather details.',
      avalancheEnabled,
      avalancheRisk,
      alertHeadline,
      alertDetail,
      highlightsHtml: htmlHighlights,
      partialWarning,
      completeReportHtml: readableReportHtml,
      actionUrl,
    }),
  };
};

const buildObjectiveWatchChangeEmail = ({ displayName, title, reasons, actionUrl }) => {
  const safeTitle = String(title || 'Watched objective').replace(/[\r\n]+/gu, ' ').trim().slice(0, 160) || 'Watched objective';
  const safeReasons = Array.isArray(reasons) ? reasons.map((reason) => String(reason || '').trim()).filter(Boolean) : [];
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hello,';
  const textReasons = safeReasons.map((reason) => `- ${reason}`).join('\n');
  const htmlReasons = safeReasons.map((reason) => `<li style="margin:0 0 8px;">${escapeHtml(reason)}</li>`).join('');
  return {
    subject: `Conditions changed for ${safeTitle}`,
    text: `${displayName ? `Hi ${displayName},\n\n` : ''}Important conditions changed for ${safeTitle}:\n\n${textReasons}\n\nReview the latest watch before relying on the plan.\n\n${actionUrl}`,
    html: emailShell({
      preview: `Conditions changed for ${safeTitle}`,
      heading: `Conditions changed for ${safeTitle}`,
      body: `<p style="margin:0 0 14px;">${greeting}</p><p style="margin:0 0 14px;">Objective Watch detected a meaningful risk increase:</p><ul style="margin:0;padding-left:20px;">${htmlReasons}</ul><p style="margin:16px 0 0;">Review fresh source data and use your own judgment before relying on the plan.</p>`,
      actionLabel: 'Review objective watches',
      actionUrl,
      footer: 'Automated checks can miss changes or receive incomplete source data. This is planning support, not a safety guarantee.',
    }),
  };
};

const buildHealthStatusEmail = ({ status, summary, checkedAt, incidentStartedAt, actionUrl }) => {
  const recovered = status === 'recovered';
  const safeSummary = String(summary || (recovered ? 'All monitored services are healthy.' : 'The health check failed.'))
    .replace(/[\r\n]+/gu, ' ')
    .trim()
    .slice(0, 500);
  const heading = recovered ? 'Service health recovered' : 'Service health alert';
  const subject = recovered
    ? `${APP_NAME} service health recovered`
    : `${APP_NAME} service is unhealthy`;
  const incidentLine = incidentStartedAt ? `Incident started: ${incidentStartedAt}\n` : '';
  return {
    subject,
    text: `${heading}\n\n${safeSummary}\n\n${incidentLine}Checked at: ${checkedAt}\n\n${actionUrl}`,
    html: emailShell({
      preview: subject,
      heading,
      body: `<p style="margin:0 0 14px;">${escapeHtml(safeSummary)}</p><p style="margin:0;color:#6d786f;font-size:13px;">${incidentStartedAt ? `Incident started: ${escapeHtml(incidentStartedAt)}<br>` : ''}Checked at: ${escapeHtml(checkedAt)}</p>`,
      actionLabel: 'Open Backcountry Conditions',
      actionUrl,
      footer: recovered
        ? 'This recovery was detected automatically by the production health monitor.'
        : 'The monitor will keep checking automatically and send a recovery notice when service returns.',
    }),
  };
};

module.exports = {
  buildHealthStatusEmail,
  buildObjectiveWatchChangeEmail,
  buildPasswordResetEmail,
  buildReportEmail,
  buildVerificationEmail,
  escapeHtml,
};
