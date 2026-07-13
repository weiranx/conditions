const { logger } = require('../utils/logger');

const startServer = ({ app, port, onShutdown = null }) => {
  const server = app.listen(port, () => logger.info({ port }, 'Backend active'));
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'Graceful shutdown failed');
        process.exit(1);
      }
      try {
        if (typeof onShutdown === 'function') await onShutdown();
        process.exit(0);
      } catch (shutdownError) {
        logger.error({ err: shutdownError }, 'Shutdown cleanup failed');
        process.exit(1);
      }
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
