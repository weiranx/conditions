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
  buildVerificationEmail,
  escapeHtml,
};
