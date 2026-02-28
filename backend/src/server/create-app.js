const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');

const createApp = ({
  isProduction,
  corsAllowlist,
  rateLimitWindowMs,
  rateLimitMaxRequests,
}) => {
  const app = express();

  const corsOptions = {
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
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      if (!isProduction || res.statusCode >= 500) {
        const elapsed = Date.now() - startedAt;
        console.log(`[${requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsed}ms)`);
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
      skip: (req) => req.method === 'OPTIONS',
      message: { error: 'Too many requests. Please retry later.' },
    }),
  );

  return app;
};

module.exports = {
  createApp,
};
