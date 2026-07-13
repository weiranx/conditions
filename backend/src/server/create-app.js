const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { logger, withRequestId } = require('../utils/logger');

const shouldSkipGeneralRateLimit = (req) => (
  req.method === 'OPTIONS'
  || req.path === '/auth'
  || req.path.startsWith('/auth/')
);

const createApp = ({
  isProduction,
  corsAllowlist,
  rateLimitWindowMs,
  rateLimitMaxRequests,
}) => {
  const app = express();

  const corsOptions = {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsAllowlist.length === 0) {
        callback(null, !isProduction);
        return;
      }
      callback(null, corsAllowlist.includes(origin));
    },
  };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(helmet());
  // Full account-owned report snapshots can include the analyzed satellite tile.
  // Generated-report validation applies a tighter 4 MB limit after parsing.
  app.use(express.json({ limit: '5mb' }));

  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    req.log = withRequestId(requestId);
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      if (!isProduction || res.statusCode >= 500) {
        const elapsed = Date.now() - startedAt;
        req.log.info({ method: req.method, url: req.originalUrl, status: res.statusCode, elapsed }, 'request');
      }
    });
    next();
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: rateLimitWindowMs,
      max: rateLimitMaxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      // Account access has independent limits in routes/account.js. Keeping it
      // out of the general API bucket prevents forecast and map activity from
      // locking a user out of creating an account or signing back in.
      skip: shouldSkipGeneralRateLimit,
      message: { error: 'Too many requests. Please retry later.' },
    }),
  );

  return app;
};

module.exports = {
  createApp,
};
