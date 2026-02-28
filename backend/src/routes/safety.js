const registerSafetyRoute = ({ app, safetyHandler }) => {
  app.get('/api/safety', safetyHandler);
};

const createSafetyInvoker = ({ safetyHandler }) => async (query) =>
  new Promise((resolve, reject) => {
    const mockReq = { query };
    const mockRes = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };

    Promise.resolve(safetyHandler(mockReq, mockRes))
      .then(() => {
        if (!mockRes.headersSent) {
          resolve({ statusCode: mockRes.statusCode, payload: null });
        }
      })
      .catch(reject);
  });

module.exports = {
  registerSafetyRoute,
  createSafetyInvoker,
};
