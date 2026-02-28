import { Express, Request, Response, RequestHandler } from 'express';

interface RegisterSafetyRouteOptions {
  app: Express;
  safetyHandler: RequestHandler;
}

export const registerSafetyRoute = ({ app, safetyHandler }: RegisterSafetyRouteOptions) => {
  app.get('/api/safety', safetyHandler);
};

interface CreateSafetyInvokerOptions {
  safetyHandler: any;
}

export const createSafetyInvoker = ({ safetyHandler }: CreateSafetyInvokerOptions) => async (query: any): Promise<{ statusCode: number; payload: any }> =>
  new Promise((resolve, reject) => {
    const mockReq = { query } as any;
    const mockRes = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.headersSent = true;
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    } as any;

    Promise.resolve(safetyHandler(mockReq, mockRes))
      .then(() => {
        if (!mockRes.headersSent) {
          resolve({ statusCode: mockRes.statusCode, payload: null });
        }
      })
      .catch(reject);
  });
