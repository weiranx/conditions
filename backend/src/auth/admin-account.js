'use strict';

const ADMIN_ACCOUNT_EMAIL = 'weiranxiong@gmail.com';

const isAdminAccount = (user) => (
  typeof user?.email === 'string'
  && user.email.trim().toLowerCase() === ADMIN_ACCOUNT_EMAIL
);

module.exports = {
  ADMIN_ACCOUNT_EMAIL,
  isAdminAccount,
};
