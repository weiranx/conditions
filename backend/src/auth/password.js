'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64url'),
    Buffer.from(derivedKey).toString('base64url'),
  ].join('$');
};

const verifyPassword = async (password, encodedHash) => {
  const [algorithm, rawN, rawR, rawP, encodedSalt, encodedKey] = String(encodedHash || '').split('$');
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (
    algorithm !== 'scrypt' ||
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 ||
    r < 1 ||
    p < 1 ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expectedKey = Buffer.from(encodedKey, 'base64url');
    if (salt.length < 16 || expectedKey.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }
    const actualKey = Buffer.from(await scrypt(password, salt, expectedKey.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    }));
    return crypto.timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
};

const createSessionToken = () => crypto.randomBytes(32).toString('base64url');

const hashSessionToken = (token) => (
  crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
);

module.exports = {
  SCRYPT_PARAMS,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
};
