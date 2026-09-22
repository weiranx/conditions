const { selectForecastIntervals } = require('../src/utils/report-evidence');
const { calculateSafetyScore } = require('../src/utils/safety-score');
const { buildReportInsights } = require('../src/utils/report-insights');

const start = '2026-09-16T12:00:00Z';
const weatherRow = (timeIso, extra = {}) => ({
  timeIso, temp: 55, feelsLike: 55, wind: 5, gust: 8, precipChance: 0, ...extra,
});

describe('invalid explicit forecast interval ends', () => {
  test.each(['not-a-time', '', false, 0])('does not invent coverage for endTimeIso=%p', endTimeIso => {
    const trend = [
      weatherRow(start),
      weatherRow('2026-09-16T13:00:00Z', { endTimeIso }),
    ];
    expect(selectForecastIntervals(trend, start, 2).reduce((sum, row) => sum + row.hours, 0)).toBe(1);
    expect(calculateSafetyScore({
      selectedStartTime: start, selectedTravelWindowHours: 2,
      selectedDate: '2026-09-16', selectedStartClock: '12:00',
      avalancheData: { relevant: false }, alertsData: { status: 'none', alerts: [] },
      weatherData: {
        temp: 55, feelsLike: 55, windSpeed: 5, windGust: 8, precipChance: 0,
        issuedTime: new Date().toISOString(), forecastStartTime: start, trend,
      },
    })).toMatchObject({ assessmentStatus: 'insufficient_evidence', coverage: { completeHours: 1 } });
  });

  test('retains hourly defaults for providers with no explicit interval end', () => {
    const trend = [weatherRow(start), weatherRow('2026-09-16T13:00:00Z', { endTimeIso: null })];
    expect(selectForecastIntervals(trend, start, 2).reduce((sum, row) => sum + row.hours, 0)).toBe(2);
  });

  test('retains the supplied duration for valid partial intervals', () => {
    const trend = [weatherRow(start, { endTimeIso: '2026-09-16T12:30:00Z' })];
    expect(selectForecastIntervals(trend, start, 2).reduce((sum, row) => sum + row.hours, 0)).toBe(0.5);
  });
});

const report = referenceIso => ({
  generatedAt: start,
  forecast: { selectedDate: '2026-09-16', requestedStartTime: '12:00', selectedStartTime: referenceIso },
  weather: { windSpeed: 5, elevation: 5000 },
  localConditions: { radar: { lightning: { available: true, detectionAtObjective: true, productTime: start } } },
  supplementalEvidence: {
    synoptic: {
      available: true,
      stations: [{ id: 'TEST', distanceKm: 4, elevationFt: 5000, readings: { windMph: { value: 25, observedTime: start } } }],
    },
    nbm: {
      available: true, issuedTime: start, station: { distanceKm: 4, elevationFt: 5000 },
      points: [{ validTime: start, windMph: { p10: 5, p50: 15, p90: 25 } }],
    },
  },
});

describe('departure comparisons require a known timezone', () => {
  test.each([undefined, '2026-09-16T12:00:00'])('does not interpret local departure as UTC from reference %p', referenceIso => {
    const insights = buildReportInsights(report(referenceIso));
    expect(insights.items.find(item => item.id === 'station-wind')).toMatchObject({ tone: 'context', decisionRelevant: false });
    expect(insights.items.find(item => item.id === 'lightning').decisionRelevant).toBe(false);
    expect(insights.items.find(item => item.id === 'wind-range')).toBeUndefined();
  });

  test.each(['forecast', 'weather'])('uses an explicit %s reference to retain comparable evidence', source => {
    const input = report(source === 'forecast' ? start : undefined);
    if (source === 'weather') input.weather.forecastStartTime = start;
    const insights = buildReportInsights(input);
    expect(insights.items.find(item => item.id === 'station-wind').decisionRelevant).toBe(true);
    expect(insights.items.find(item => item.id === 'lightning').decisionRelevant).toBe(true);
    expect(insights.items.find(item => item.id === 'wind-range').decisionRelevant).toBe(true);
  });

  test('uses a valid weather reference when the stored forecast reference is ambiguous', () => {
    const input = report('2026-09-16T12:00:00');
    input.weather.forecastStartTime = start;
    expect(buildReportInsights(input).items.find(item => item.id === 'station-wind').decisionRelevant).toBe(true);
  });
});
