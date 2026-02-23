const startServer = ({ app, port }) => {
  const server = app.listen(port, () => console.log(`Backend Active on ${port}`));

  const shutdown = (signal) => {
    console.log(`Received ${signal}. Shutting down...`);
    server.close((err) => {
      if (err) {
        console.error('Graceful shutdown failed:', err);
        process.exit(1);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Shutdown timeout reached, forcing exit.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown('uncaughtException');
  });

  return server;
};

module.exports = {
  startServer,
};
