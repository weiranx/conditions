const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_ENTRIES = 500;
const LOG_FILE = path.resolve(__dirname, '../../../data/report-logs.ndjson');

const reportLogs = [];

// Ensure data directory exists
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch {
  // non-fatal
}

// Load existing logs from file on startup (last MAX_LOG_ENTRIES lines)
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const recent = lines.slice(-MAX_LOG_ENTRIES);
    for (const line of recent) {
      try {
        reportLogs.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }
} catch {
  // non-fatal: start with empty log
}

const logReportRequest = (entry) => {
  const record = { ...entry, timestamp: new Date().toISOString() };
  if (reportLogs.length >= MAX_LOG_ENTRIES) {
    reportLogs.shift();
  }
  reportLogs.push(record);
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // non-fatal: entry still available in memory
  }
};

const registerReportLogsRoute = (app) => {
  app.get('/api/report-logs', (req, res) => {
    res.json([...reportLogs].reverse());
  });
};

module.exports = { logReportRequest, registerReportLogsRoute };
