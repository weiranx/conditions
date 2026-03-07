const { logger } = require('../utils/logger');

const startServer = ({ app, port }) => {
  const server = app.listen(port, () => logger.info({ port }, 'Backend active'));

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Graceful shutdown failed');
        process.exit(1);
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  return server;
};

module.exports = {
  startServer,
};
