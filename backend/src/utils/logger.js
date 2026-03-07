const pino = require('pino');

const IS_PRODUCTION = (process.env.NODE_ENV || 'development') === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug'),
  ...(IS_PRODUCTION
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

/** Create a child logger bound to a request ID. */
const withRequestId = (requestId) => logger.child({ requestId });

module.exports = { logger, withRequestId };
