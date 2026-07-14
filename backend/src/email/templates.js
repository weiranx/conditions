'use strict';

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

const buildReportEmail = ({ displayName, report, actionUrl }) => {
  const plan = report?.plan && typeof report.plan === 'object' ? report.plan : {};
  const safetyData = report?.safetyData && typeof report.safetyData === 'object' ? report.safetyData : {};
  const preferences = report?.preferences && typeof report.preferences === 'object' ? report.preferences : {};
  const safety = safetyData?.safety && typeof safetyData.safety === 'object' ? safetyData.safety : {};
  const weather = safetyData?.weather && typeof safetyData.weather === 'object' ? safetyData.weather : {};
  const avalanche = safetyData?.avalanche && typeof safetyData.avalanche === 'object' ? safetyData.avalanche : {};
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
  const weatherParts = [
    displayTemperature === null ? null : `${Math.round(displayTemperature)}°${temperatureUnit.toUpperCase()}`,
    displayWindSpeed === null ? null : `wind ${Math.round(displayWindSpeed)} ${windUnit}`,
    displayWindGust === null ? null : `gusts ${Math.round(displayWindGust)} ${windUnit}`,
    precipitation === null ? null : `${Math.round(precipitation)}% precipitation`,
  ].filter(Boolean);
  const alertLine = activeAlerts && activeAlerts > 0
    ? `${Math.round(activeAlerts)} active weather alert${Math.round(activeAlerts) === 1 ? '' : 's'} require review.`
    : 'No active weather alerts were included in this report snapshot.';
  const textHighlights = explanations.length
    ? explanations.map((item) => `- ${item}`).join('\n')
    : '- Recheck official forecasts, access, and field observations before departure.';
  const htmlHighlights = (explanations.length
    ? explanations
    : ['Recheck official forecasts, access, and field observations before departure.'])
    .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
    .join('');

  return {
    subject: `${objectiveName} report · ${forecastDate}`,
    text: `${displayName ? `Hi ${compactText(displayName, '', 80)},\n\n` : ''}${objectiveName}\n${forecastDate} at ${startTime}\n${scoreLine}\n\nWeather: ${condition}${weatherParts.length ? ` (${weatherParts.join(', ')})` : ''}\nAvalanche: ${avalancheRisk}\nAlerts: ${alertLine}\n\nKey report notes:\n${textHighlights}\n\nOpen Backcountry Conditions:\n${actionUrl}\n\nThis is a point-in-time planning snapshot, not a safety guarantee. Recheck official sources and current field conditions before departure.`,
    html: emailShell({
      preview: `${objectiveName} report for ${forecastDate}`,
      heading: `${objectiveName} report`,
      body: `<p style="margin:0 0 14px;">${greeting}</p><p style="margin:0 0 18px;">Here is the report you asked to send to your account email.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;background:#f6f8f4;border-radius:10px;"><tr><td style="padding:14px 16px;"><strong style="color:#172019;">${escapeHtml(forecastDate)} at ${escapeHtml(startTime)}</strong><br><span style="color:#48705a;">${escapeHtml(scoreLine)}</span></td></tr></table><p style="margin:0 0 8px;"><strong style="color:#172019;">Weather:</strong> ${escapeHtml(condition)}${weatherParts.length ? ` (${escapeHtml(weatherParts.join(', '))})` : ''}</p><p style="margin:0 0 8px;"><strong style="color:#172019;">Avalanche:</strong> ${escapeHtml(avalancheRisk)}</p><p style="margin:0 0 18px;"><strong style="color:#172019;">Alerts:</strong> ${escapeHtml(alertLine)}</p><p style="margin:0 0 8px;"><strong style="color:#172019;">Key report notes</strong></p><ul style="margin:0;padding-left:20px;">${htmlHighlights}</ul>`,
      actionLabel: 'Open Backcountry Conditions',
      actionUrl,
      footer: 'This is a point-in-time planning snapshot, not a safety guarantee. Recheck official sources and current field conditions before departure.',
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
