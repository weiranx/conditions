// Synthetic /api/safety payloads for plan-evaluation tests. Mirrors the shape
// (not the values) of frontend/dev/mock-data.mjs, trimmed to what the
// evaluation reads.

const CLIMATE = {
  clear: ['Clear', 61, 8, 15, 0, 8],
  cloudy: ['Overcast', 48, 12, 23, 15, 96],
  rain: ['Rain showers', 43, 18, 29, 80, 90],
  snow: ['Snow showers', 28, 17, 27, 75, 92],
  storm: ['Thunderstorms', 42, 30, 52, 95, 100],
  fog: ['Fog', 46, 5, 10, 10, 95],
};

// Hour by hour: three clear, two cloudy, two rain, two snow, then clear again.
const MIXED = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'rain', 'snow', 'snow', 'clear'];

const clock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const today = () => new Date().toISOString().slice(0, 10);

const makeReport = ({ date = today(), start = '07:00', hours = 10, scenario = 'clear', objectiveElevationFt = 10738 } = {}) => {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const now = new Date().toISOString();
  const trend = Array.from({ length: hours }, (_, i) => {
    const kind = scenario === 'mixed' ? MIXED[i % MIXED.length] : scenario;
    const [condition, temp, wind, gust, precipChance, cloudCover] = CLIMATE[kind] || CLIMATE.clear;
    const hour = (minutes / 60 + i) % 24;
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + Math.floor((minutes + i * 60) / 1440));
    return {
      time: clock(minutes + i * 60),
      timeIso: `${day.toISOString().slice(0, 10)}T${clock(minutes + i * 60)}:00-07:00`,
      temp: temp + Math.round(Math.sin(i * 0.7) * 3),
      wind,
      gust: gust + (i % 3),
      precipChance,
      cloudCover,
      humidity: Math.round(40 + cloudCover * 0.45),
      windDirection: 'SW',
      isDaytime: hour >= 6.5 && hour < 19.5,
      condition,
    };
  });
  const first = trend[0];
  return {
    generatedAt: now,
    featureFlags: {},
    location: { lat: 33.8147, lon: -116.6794 },
    forecast: {
      selectedDate: date,
      requestedStartTime: start,
      selectedStartTime: first.timeIso,
      selectedEndTime: trend.at(-1).timeIso,
    },
    weather: {
      temp: first.temp,
      description: first.condition,
      windSpeed: first.wind,
      windGust: first.gust,
      humidity: first.humidity,
      cloudCover: first.cloudCover,
      precipChance: first.precipChance,
      isDaytime: first.isDaytime,
      timezone: 'America/Los_Angeles',
      issuedTime: now,
      forecastStartTime: first.timeIso,
      forecastEndTime: trend.at(-1).timeIso,
      elevation: objectiveElevationFt,
      trend,
      elevationForecast: [
        { label: 'Trailhead', elevationFt: 6500, deltaFromObjectiveFt: 6500 - objectiveElevationFt },
        { label: 'Summit', elevationFt: objectiveElevationFt, deltaFromObjectiveFt: 0 },
      ],
    },
    solar: { sunrise: '6:30 AM', sunset: '7:30 PM', dayLength: '13h 00m' },
    avalanche: { relevant: false, dangerLevel: 1, coverageStatus: 'reported', publishedTime: now },
    alerts: { status: 'none', activeCount: 0, alerts: [] },
    airQuality: { status: 'ok', usAqi: 32, category: 'Good', measuredTime: now },
    rainfall: { status: 'ok', anchorTime: now },
    snowpack: { status: 'ok', snotel: { observedDate: now.slice(0, 10), snowDepthIn: 0 } },
    terrainCondition: { code: 'dry', label: 'Mostly dry', confidence: 'high', signals: { maxSnowDepthIn: 0 } },
    heatRisk: { status: 'ok', level: 0, label: 'Low' },
    fireRisk: { status: 'ok', level: 1, label: 'Low', reasons: [] },
    safety: { score: 91, factors: [] },
  };
};

module.exports = { makeReport };
