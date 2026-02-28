import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Express, Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ReportLogEntry {
  timestamp: string;
  name?: string | null;
  statusCode: number;
  lat?: number | string | null;
  lon?: number | string | null;
  date?: string | null;
  durationMs?: number;
  [key: string]: any;
}

const MAX_LOG_ENTRIES = 500;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_FILE = path.resolve(__dirname, '../../data/report-logs.ndjson');

const reportLogs: ReportLogEntry[] = [];

const isWithinOneWeek = (entry: ReportLogEntry) =>
  Date.now() - new Date(entry.timestamp).getTime() <= ONE_WEEK_MS;

const rewriteFile = () => {
  try {
    const content = reportLogs.length
      ? reportLogs.map((r) => JSON.stringify(r)).join('\n') + '\n'
      : '';
    fs.writeFileSync(LOG_FILE, content, 'utf8');
  } catch (err: any) {
    console.error('[report-logs] rewrite failed:', err.message);
  }
};

const trimOldEntries = () => {
  const before = reportLogs.length;
  const firstRecent = reportLogs.findIndex(isWithinOneWeek);
  if (firstRecent > 0) reportLogs.splice(0, firstRecent);
  if (reportLogs.length !== before) rewriteFile();
};

// Ensure data directory exists
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch (err: any) {
  console.error('[report-logs] mkdir failed:', err.message);
}
console.log('[report-logs] log file:', LOG_FILE);

// Load existing logs on startup — filter to last week, rewrite file if any were pruned
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const parsed = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const recent = parsed.filter(isWithinOneWeek).slice(-MAX_LOG_ENTRIES);
    reportLogs.push(...recent);
    if (recent.length !== parsed.length) rewriteFile();
  }
} catch (err: any) {
  console.error('[report-logs] load failed:', err.message);
}

// Daily trim to evict entries that aged out during a long-running process
setInterval(trimOldEntries, 24 * 60 * 60 * 1000).unref();

export const logReportRequest = (entry: Omit<ReportLogEntry, 'timestamp'>) => {
  if (!entry.name) return;
  const record: ReportLogEntry = { ...entry, timestamp: new Date().toISOString() };
  if (reportLogs.length >= MAX_LOG_ENTRIES) reportLogs.shift();
  reportLogs.push(record);
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err: any) {
    console.error('[report-logs] append failed:', err.message);
  }
};

const LOGS_SECRET = process.env.LOGS_SECRET || '';

export const registerReportLogsRoute = (app: Express) => {
  app.get('/api/report-logs', (req: Request, res: Response) => {
    if (LOGS_SECRET) {
      const auth = req.headers['authorization'] ?? '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (provided !== LOGS_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    res.json([...reportLogs].reverse());
  });
};
