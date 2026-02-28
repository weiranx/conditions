import { Express } from 'express';
import { Server } from 'node:http';

export const startServer = (arg1: any, arg2?: any): Server => {
  let app: Express;
  let port: string | number;

  // Handle both patterns: startServer({ app, port }) AND startServer(app, port)
  if (arg1 && arg1.app && (arg1.port !== undefined)) {
    app = arg1.app;
    port = arg1.port;
  } else {
    app = arg1;
    port = arg2;
  }

  if (!app || typeof app.listen !== 'function') {
    console.error('Invalid Express app instance provided to startServer:', app);
    throw new Error('startServer: Valid "app" instance is required');
  }

  const server = app.listen(port, () => console.log(`Backend Active on ${port}`));

  const shutdown = (signal: string) => {
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
