const MAX_WAYPOINT_REPORTS_LENGTH = 30000;

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const shortText = (value) => {
  if (typeof value !== 'string') return undefined;
  let text = value.slice(0, 140);
  // Escaped control characters can use six JSON characters per input character.
  while (JSON.stringify(text).length > 140) text = text.slice(0, Math.floor(text.length / 2));
  return text;
};
const numericFields = (value, keys) => Object.fromEntries(keys
  .filter((key) => finiteNumber(value?.[key]))
  .map((key) => [key, value[key]]));

// Keep every checkpoint represented in valid JSON. A large early report must
// never crowd a later checkpoint's score or primary hazard out of the prompt.
const serializeWaypointReports = (reports) => {
  const full = JSON.stringify(reports);
  if (full.length <= MAX_WAYPOINT_REPORTS_LENGTH) return full;
  const budget = Math.floor((MAX_WAYPOINT_REPORTS_LENGTH - 2) / reports.length) - 1;
  return JSON.stringify(reports.map((entry) => {
    if (JSON.stringify(entry).length <= budget) return entry;
    const report = entry.report || {};
    const compact = {
      ...entry,
      report: {
        safety: {
          ...numericFields(report.safety, ['score', 'confidence']),
          tier: shortText(report.safety?.tier),
          primaryHazard: shortText(report.safety?.primaryHazard),
          confidenceReasons: Array.isArray(report.safety?.confidenceReasons)
            ? report.safety.confidenceReasons.slice(0, 3).map(shortText) : undefined,
        },
        weather: {
          ...numericFields(report.weather, ['temp', 'feelsLike', 'windSpeed', 'windGust', 'precipChance']),
          status: shortText(report.weather?.status),
          description: shortText(report.weather?.description),
        },
        avalanche: report.avalanche ? {
          relevant: report.avalanche.relevant,
          ...numericFields(report.avalanche, ['dangerLevel']),
          risk: shortText(report.avalanche.risk),
        } : undefined,
        alerts: report.alerts ? {
          status: shortText(report.alerts.status),
          total: Array.isArray(report.alerts.alerts) ? report.alerts.alerts.length : 0,
          events: Array.isArray(report.alerts.alerts)
            ? [...new Set(report.alerts.alerts.map((alert) => shortText(alert.event)))].filter(Boolean).slice(0, 5)
            : [],
        } : undefined,
        partialData: report.partialData === true,
        apiWarning: shortText(report.apiWarning),
      },
      reportCondensed: true,
      omittedReportFields: Object.keys(report),
    };
    // Add whole fields only when they fit, retaining compact core evidence if a
    // verbose field cannot fit. Tell synthesis exactly which fields are abridged.
    const priority = ['safety', 'alerts', 'weather', 'avalanche', ...Object.keys(report)];
    for (const key of new Set(priority)) {
      if (!(key in report)) continue;
      const candidate = {
        ...compact,
        report: { ...compact.report, [key]: report[key] },
        omittedReportFields: compact.omittedReportFields.filter((field) => field !== key),
      };
      if (JSON.stringify(candidate).length <= budget) Object.assign(compact, candidate);
    }
    return compact;
  }));
};

module.exports = { MAX_WAYPOINT_REPORTS_LENGTH, finiteNumber, serializeWaypointReports };
