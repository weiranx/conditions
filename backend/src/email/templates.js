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

module.exports = {
  buildPasswordResetEmail,
  buildVerificationEmail,
  escapeHtml,
};
