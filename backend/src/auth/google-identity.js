'use strict';

const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

class GoogleAuthenticationError extends Error {
  constructor(message = 'Google sign-in could not be verified.', code = 'INVALID_GOOGLE_CREDENTIAL') {
    super(message);
    this.name = 'GoogleAuthenticationError';
    this.code = code;
  }
}

const normalizeClientId = (value) => String(value || '').trim();

const matchesNonce = (actual, expected) => {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) {
    return false;
  }
  const actualHash = crypto.createHash('sha256').update(actual, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
};

const isAuthoritativeGoogleEmail = (email, hostedDomain) => (
  email.endsWith('@gmail.com') || (typeof hostedDomain === 'string' && hostedDomain.trim().length > 0)
);

const createGoogleIdentityVerifier = ({
  clientId: rawClientId = process.env.GOOGLE_CLIENT_ID,
  client,
} = {}) => {
  const clientId = normalizeClientId(rawClientId);
  const oauthClient = client || (clientId ? new OAuth2Client() : null);
  const available = Boolean(clientId && typeof oauthClient?.verifyIdToken === 'function');

  const verify = async (credential, { nonce } = {}) => {
    if (!available) {
      throw new GoogleAuthenticationError('Google sign-in is not configured.', 'GOOGLE_AUTH_UNAVAILABLE');
    }
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 20_000) {
      throw new GoogleAuthenticationError();
    }
    if (typeof nonce !== 'string' || nonce.length < 20 || nonce.length > 200) {
      throw new GoogleAuthenticationError('Google sign-in expired. Please try again.');
    }

    let payload;
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new GoogleAuthenticationError();
    }

    const email = String(payload?.email || '').trim().toLowerCase();
    const subject = String(payload?.sub || '').trim();
    if (
      !payload
      || !subject
      || subject.length > 255
      || !email
      || payload.email_verified !== true
      || !matchesNonce(payload.nonce, nonce)
    ) {
      throw new GoogleAuthenticationError();
    }

    const rawDisplayName = String(payload.name || payload.given_name || email.split('@')[0] || '').trim();
    const displayName = Array.from(rawDisplayName).slice(0, 80).join('');
    return {
      subject,
      email,
      displayName,
      emailAuthoritative: isAuthoritativeGoogleEmail(email, payload.hd),
    };
  };

  return {
    available,
    clientId,
    verify,
  };
};

module.exports = {
  GoogleAuthenticationError,
  createGoogleIdentityVerifier,
  isAuthoritativeGoogleEmail,
  matchesNonce,
};
