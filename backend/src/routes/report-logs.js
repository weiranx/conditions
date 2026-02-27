const MAX_LOG_ENTRIES = 500;
const reportLogs = [];

const logReportRequest = (entry) => {
  const record = { ...entry, timestamp: new Date().toISOString() };
  if (reportLogs.length >= MAX_LOG_ENTRIES) {
    reportLogs.shift();
  }
  reportLogs.push(record);
};

const registerReportLogsRoute = (app) => {
  app.get('/api/report-logs', (req, res) => {
    res.json([...reportLogs].reverse());
  });
};

module.exports = { logReportRequest, registerReportLogsRoute };
