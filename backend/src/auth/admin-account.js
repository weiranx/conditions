'use strict';

const ADMIN_ACCOUNT_EMAIL = 'weiranxiong@gmail.com';
const DEV_ADMIN_ACCOUNT = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  email: ADMIN_ACCOUNT_EMAIL,
  displayName: 'Development admin',
  emailVerified: true,
});

const isAdminAccount = (user) => (
  typeof user?.email === 'string'
  && user.email.trim().toLowerCase() === ADMIN_ACCOUNT_EMAIL
);

const resolveAdminAccount = (
  user,
  {
    developmentBypassEnabled = process.env.DEV_ADMIN_BYPASS === 'true',
    nodeEnv = process.env.NODE_ENV || 'development',
  } = {},
) => {
  if (isAdminAccount(user)) return user;
  if (nodeEnv !== 'production' && developmentBypassEnabled) {
    return user ?? DEV_ADMIN_ACCOUNT;
  }
  return null;
};

module.exports = {
  ADMIN_ACCOUNT_EMAIL,
  DEV_ADMIN_ACCOUNT,
  isAdminAccount,
  resolveAdminAccount,
};
