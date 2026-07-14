'use strict';

require('../src/server/runtime');

const run = async () => {
  const secret = String(process.env.OBJECTIVE_WATCH_CRON_SECRET || '').trim();
  if (!secret) throw new Error('OBJECTIVE_WATCH_CRON_SECRET is not configured.');
  const response = await fetch('http://127.0.0.1:3001/api/internal/objective-watch-checks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Objective Watch cron returned HTTP ${response.status}.`);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

run().catch((error) => {
  process.stderr.write(`${error?.message || 'Objective Watch cron failed.'}\n`);
  process.exitCode = 1;
});
