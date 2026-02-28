import { Express, Request, Response } from 'express';
import pkg from '../../package.json' with { type: 'json' };

const { version } = pkg;

const healthPayload = () => {
  const mem = process.memoryUsage();
  return {
    ok: true,
    service: 'summitsafe-backend',
    version,
    env: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  };
};

export const registerHealthRoutes = (app: Express) => {
  const respond = (_req: Request, res: Response) => {
    res.json(healthPayload());
  };

  app.get('/healthz', respond);
  app.get('/health', respond);
  app.get('/api/healthz', respond);
  app.get('/api/health', respond);
};
