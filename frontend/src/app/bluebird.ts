import type { WeatherTrendPoint } from './types';

const validPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/** Share of supplied daylight forecast hours, not a probability of a bluebird day. */
export function bluebirdPercentage(points: WeatherTrendPoint[]) {
  const daylight = points.filter(point => point.isDaytime === true);
  const complete = daylight.filter(point => validPercent(point.cloudCover) && validPercent(point.precipChance));
  const bluebird = complete.filter(point => point.cloudCover! <= 20 && point.precipChance! <= 10
    && !/rain|shower|drizzle|snow|sleet|freezing|fog|mist|haze|smoke|thunder|storm|lightning/i.test(point.condition || ''));
  const unknownDaylight = points.some(point => typeof point.isDaytime !== 'boolean');
  return {
    percent: !unknownDaylight && daylight.length > 0 && complete.length === daylight.length
      ? Math.round(100 * bluebird.length / daylight.length) : null,
    daylightHours: daylight.length,
    completeHours: complete.length,
    bluebirdHours: bluebird.length,
    reason: unknownDaylight ? 'Daylight classification is incomplete.'
      : daylight.length === 0 ? 'No daylight forecast hours are available in this window.'
      : complete.length < daylight.length ? 'Cloud cover or precipitation readings are missing.' : null,
  };
}
