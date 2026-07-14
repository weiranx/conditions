'use strict';

const { Resend } = require('resend');
const { buildPasswordResetEmail, buildVerificationEmail } = require('./templates');

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
};

const createEmailService = ({
  apiKey = process.env.RESEND_API_KEY,
  fromAddress = process.env.EMAIL_FROM,
  appBaseUrl = process.env.APP_BASE_URL,
  client,
} = {}) => {
  const normalizedApiKey = String(apiKey || '').trim();
  const normalizedFromAddress = String(fromAddress || '').trim();
  const normalizedBaseUrl = normalizeBaseUrl(appBaseUrl);
  const resend = client || (normalizedApiKey ? new Resend(normalizedApiKey) : null);
  const available = Boolean(
    normalizedApiKey
    && normalizedFromAddress
    && normalizedBaseUrl
    && resend?.emails
    && typeof resend.emails.send === 'function'
  );

  const buildActionUrl = (action, token) => {
    if (!normalizedBaseUrl) {
      const error = new Error('Email links are not configured.');
      error.code = 'EMAIL_SERVICE_UNAVAILABLE';
      throw error;
    }
    const url = new URL('/account', normalizedBaseUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('token', token);
    return url.toString();
  };

  const send = async ({ to, template, idempotencyKey }) => {
    if (!available) {
      const error = new Error('Email delivery is not configured.');
      error.code = 'EMAIL_SERVICE_UNAVAILABLE';
      throw error;
    }
    const result = await resend.emails.send({
      from: normalizedFromAddress,
      to,
      subject: template.subject,
      text: template.text,
      html: template.html,
    }, { idempotencyKey });
    if (result?.error) {
      const error = new Error('Email delivery failed.');
      error.code = 'EMAIL_DELIVERY_FAILED';
      error.cause = result.error;
      throw error;
    }
    return { id: result?.data?.id || null };
  };

  const sendVerificationEmail = ({ tokenId, token, to, displayName }) => {
    const actionUrl = buildActionUrl('verify-email', token);
    return send({
      to,
      template: buildVerificationEmail({ displayName, actionUrl }),
      idempotencyKey: `verify-email/${tokenId}`,
    });
  };

  const sendPasswordResetEmail = ({ tokenId, token, to, displayName }) => {
    const actionUrl = buildActionUrl('reset-password', token);
    return send({
      to,
      template: buildPasswordResetEmail({ displayName, actionUrl }),
      idempotencyKey: `reset-password/${tokenId}`,
    });
  };

  return {
    available,
    sendPasswordResetEmail,
    sendVerificationEmail,
  };
};

module.exports = {
  createEmailService,
  normalizeBaseUrl,
};
