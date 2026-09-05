// Synthetic fixtures, never observations. No external requests or credentials.
export const scenarios = [
  "mixed",
  "clear",
  "cloudy",
  "rain",
  "snow",
  "storm",
  "fog",
  "field-alerts",
  "missing",
  "error",
];
export const peaks = [
  ["San Jacinto Peak", 33.8147, -116.6794, 10738],
  ["Mount Rainier", 46.8523, -121.7603, 14411],
  ["Mount Whitney", 36.5786, -118.2923, 14505],
  ["Grand Teton", 43.7417, -110.8024, 13775],
].map(([name, lat, lon, elevation]) => ({
  name,
  lat,
  lon,
  elevation,
  type: "peak",
  class: "natural",
  display_name: `${name} · Demo objective`,
}));
const climate = {
  clear: ["Clear", 61, 8, 15, 0, 8],
  cloudy: ["Overcast", 48, 12, 23, 15, 96],
  rain: ["Rain showers", 43, 18, 29, 80, 90],
  snow: ["Snow showers", 28, 17, 27, 75, 92],
  storm: ["Thunderstorms", 42, 30, 52, 95, 100],
  fog: ["Fog", 46, 5, 10, 10, 95],
};
const clock = (n) =>
  `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function makeReport(params = {}, scenario = "mixed") {
  const date = params.date || new Date().toISOString().slice(0, 10);
  const start = params.start || "07:00";
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const count = Math.max(
    1,
    Math.min(
      24,
      Number(params.travel_window_hours || params.travelWindowHours) || 10,
    ),
  );
  const now = new Date().toISOString();
  const lat = Number(params.lat ?? peaks[0].lat),
    lon = Number(params.lon ?? peaks[0].lon);
  const objective = peaks.find((p) => Math.abs(p.lat - lat) < 0.1) || peaks[0];
  const trend = Array.from({ length: count }, (_, i) => {
    const kind =
      scenario === "mixed"
        ? [
            "clear",
            "clear",
            "clear",
            "cloudy",
            "cloudy",
            "rain",
            "rain",
            "snow",
            "snow",
            "clear",
          ][i % 10]
        : scenario;
    const [condition, temp, wind, gust, precipChance, cloudCover] =
      climate[kind] || climate.clear;
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
      pressure: 1016 - i * 0.7,
      dewPoint: temp - 12,
      windDirection: "SW",
      isDaytime: hour >= 6.5 && hour < 19.5,
      condition,
    };
  });
  if (scenario === "missing") {
    trend[0].temp = null;
    trend[0].gust = null;
    trend[0].cloudCover = null;
  }
  const first = trend[0];
  const snowy = scenario === "snow",
    stormy = scenario === "storm";
  const rain = trend.reduce(
    (n, h) =>
      n + (h.precipChance > 60 && !/snow/i.test(h.condition) ? 0.035 : 0),
    0,
  );
  const snow = trend.reduce(
    (n, h) => n + (/snow/i.test(h.condition) ? 0.4 : 0),
    0,
  );
  return {
    generatedAt: now,
    partialData: scenario === "missing",
    apiWarning: "Simulated conditions · local development only.",
    capabilities: {
      ai: true,
      aiBrief: true,
      reportChat: true,
      routeAnalysis: true,
      snowVision: true,
    },
    location: { lat, lon },
    forecast: {
      selectedDate: date,
      selectedStartTime: start,
      selectedEndTime: clock(minutes + count * 60),
      isFuture: date > now.slice(0, 10),
      availableRange: { start: date, end: date },
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
      dewPoint: first.dewPoint,
      pressure: first.pressure,
      windDirection: "SW",
      timezone: "America/Los_Angeles",
      issuedTime: now,
      generatedTime: now,
      forecastDate: date,
      forecastStartTime: first.timeIso,
      forecastEndTime: trend.at(-1).timeIso,
      elevation: objective.elevation,
      elevationUnit: "ft",
      elevationSource: "Synthetic fixture",
      trend,
      temperatureContext24h: {
        windowHours: 24,
        minTempF: 28,
        maxTempF: 64,
        overnightLowF: 28,
        daytimeHighF: 64,
      },
      visibilityRisk: {
        level: scenario === "fog" ? "High" : "Low",
        summary:
          scenario === "fog"
            ? "Navigation becomes difficult in fog."
            : "Good visibility early; clouds may build later.",
        activeHours: scenario === "fog" ? count : 2,
        windowHours: count,
        source: "Mock",
      },
      elevationForecast: [
        ["Trailhead", 6500],
        ["Mid mountain", 8500],
        ["Summit", objective.elevation],
      ].map(([label, elevationFt]) => ({
        label,
        elevationFt,
        deltaFromObjectiveFt: elevationFt - objective.elevation,
        temp: Math.round(
          (first.temp ?? 50) + (objective.elevation - elevationFt) * 0.0035,
        ),
        feelsLike: Math.round(
          (first.temp ?? 50) + (objective.elevation - elevationFt) * 0.0035 - 4,
        ),
        windSpeed: first.wind,
        windGust: first.gust ?? 20,
      })),
      sourceDetails: {
        primary: "Synthetic local fixture",
        blended: false,
        supplementalSources: [],
      },
    },
    solar: { sunrise: "6:30 AM", sunset: "7:30 PM", dayLength: "13h 00m" },
    avalanche: {
      risk: snowy ? "Moderate" : "Low",
      dangerLevel: snowy ? 2 : 1,
      relevant: snowy,
      dangerUnknown: false,
      coverageStatus: "reported",
      center: "Demo avalanche center",
      publishedTime: now,
      expiresTime: `${date}T23:59:00-07:00`,
      bottomLine: snowy
        ? "Wind-drifted snow on exposed slopes."
        : "No avalanche terrain in this dry-trail fixture.",
      relevanceReason: "Synthetic regional assessment.",
      problems: [],
      elevations: {
        below: { level: 1 },
        at: { level: snowy ? 2 : 1 },
        above: { level: snowy ? 2 : 1 },
      },
    },
    alerts: {
      source: "Mock",
      status: "ok",
      activeCount: stormy ? 1 : 0,
      totalActiveCount: stormy ? 1 : 0,
      generatedTime: now,
      alerts: stormy
        ? [
            {
              event: "Severe Thunderstorm Warning",
              severity: "Severe",
              headline:
                "Demo warning: exposed terrain affected by thunderstorms.",
              instruction: "Avoid exposed terrain in this scenario.",
            },
          ]
        : [],
    },
    airQuality: {
      source: "Mock",
      status: "ok",
      usAqi: 32,
      category: "Good",
      pm25: 5.2,
      pm10: 9,
      ozone: 28,
      measuredTime: now,
      validTime: `${date}T${start}:00-07:00`,
      generatedTime: now,
      dataType: "modeled_forecast",
      note: "Synthetic air-quality forecast.",
    },
    rainfall: {
      source: "Mock",
      status: "ok",
      mode: "projected_for_selected_start",
      issuedTime: now,
      generatedTime: now,
      anchorTime: first.timeIso,
      timezone: "America/Los_Angeles",
      totals: {
        rainPast12hIn: 0.04,
        rainPast24hIn: 0.12,
        rainPast48hIn: 0.3,
        snowPast12hIn: snowy ? 1 : 0,
        snowPast24hIn: snowy ? 2.5 : 0,
        snowPast48hIn: snowy ? 4 : 0,
      },
      expected: {
        status: "ok",
        travelWindowHours: count,
        startTime: first.timeIso,
        endTime: trend.at(-1).timeIso,
        rainWindowIn: rain,
        rainWindowMm: rain * 25.4,
        snowWindowIn: snow,
        snowWindowCm: snow * 2.54,
      },
    },
    snowpack: {
      source: "Mock",
      status: "ok",
      summary: snowy
        ? "A shallow snowpack covers upper terrain."
        : "Bare ground at the demonstration station.",
      generatedTime: now,
      snotel: {
        status: "ok",
        stationName: "Demo summit station",
        distanceKm: 4,
        elevationFt: 9500,
        observedDate: date,
        snowDepthIn: snowy ? 16 : 0,
        sweIn: snowy ? 5 : 0,
        obsTempF: first.temp,
      },
    },
    terrainCondition: {
      code: snowy ? "snow" : "dry",
      label: snowy ? "Snow covered" : "Mostly dry",
      impact: snowy ? "moderate" : "low",
      confidence: "high",
      summary: snowy
        ? "Snow becomes deeper above treeline."
        : "Firm trail with a few damp sections.",
      recommendedTravel: snowy ? "Carry traction." : "Normal trail travel.",
      signals: {
        maxSnowDepthIn: snowy ? 16 : 0,
        rain24hIn: 0.12,
        tempF: first.temp,
      },
    },
    heatRisk: {
      source: "Mock",
      status: "ok",
      level: 0,
      label: "Low",
      guidance: "Comfortable temperatures at this elevation.",
      reasons: [],
      metrics: {
        tempF: first.temp,
        peakTemp12hF: 64,
        humidity: first.humidity,
      },
      generatedTime: now,
    },
    fireRisk: {
      source: "Mock",
      status: "ok",
      level: 1,
      label: "Low",
      guidance: "No elevated fire-weather signal.",
      reasons: [],
      alertsConsidered: [],
    },
    atmosphere: {
      uvIndex: first.isDaytime ? 6 : 0,
      uvIndexMax: 7,
      uvCategory: first.isDaytime ? "High" : "Low",
      freezingLevelFt: snowy ? 7500 : 12500,
      snowLevelFt: snowy ? 6500 : 11500,
      thunderProbability: stormy ? 85 : 0,
      moon: { name: "Waning crescent", illumination: 24, phase: 0.8 },
      generatedTime: now,
    },
    localConditions: {
      hasAnySignal: true,
      generatedTime: now,
      weatherObservation: {
        available: true,
        stationName: "Demo station",
        tempF: first.temp,
        windMph: first.wind,
        observedTime: now,
      },
      access: {
        available: true,
        closedRoadCount: scenario === "field-alerts" ? 1 : 0,
        roads: [],
        note: "Synthetic approach-road status.",
      },
      closures: {
        available: true,
        alertCount: scenario === "field-alerts" ? 1 : 0,
        alerts:
          scenario === "field-alerts"
            ? [
                {
                  title: "Demo bridge closure",
                  category: "Park Closure",
                  description: "Synthetic notice for testing access flags.",
                },
              ]
            : [],
      },
      radar: {
        available: true,
        echoDetected: scenario === "field-alerts",
        lightning: {
          available: true,
          detectionAtObjective: scenario === "field-alerts",
        },
      },
      streamflow: {
        available: true,
        siteName: "Demo creek",
        trend: scenario === "field-alerts" ? "rising" : "steady",
      },
      smoke: {
        available: true,
        currentCategory: "Good",
        peakCategory:
          scenario === "field-alerts"
            ? "Unhealthy for sensitive groups"
            : "Good",
      },
      wildfire: {
        available: true,
        nearbyIncidentCount: scenario === "field-alerts" ? 1 : 0,
        incidents: [],
      },
    },
    pleasantness: {
      score: stormy ? 22 : snowy ? 48 : 82,
      confidence: 90,
      label: stormy ? "Harsh" : snowy ? "Mixed" : "Pleasant",
      summary: "Synthetic comfort outlook.",
      disclaimer: "Weather comfort, separate from safety.",
    },
    safety: {
      scoreVersion: "mock-v1",
      score: stormy ? 28 : snowy ? 66 : scenario === "mixed" ? 74 : 91,
      confidence: scenario === "missing" ? 42 : 92,
      tier: stormy ? "High risk" : snowy ? "Moderate risk" : "Low risk",
      primaryHazard: stormy ? "Thunderstorms" : "Wind",
      explanations: ["Synthetic score for visual testing."],
      sourcesUsed: ["Mock weather", "Mock snowpack", "Mock alerts"],
      factors: [
        {
          hazard: "Wind",
          impact: stormy ? 35 : 6,
          source: "Mock",
          message: "Wind increases on exposed terrain.",
          group: "weather",
        },
      ],
      groupImpacts: {
        weather: { raw: stormy ? 50 : 12, effective: stormy ? 45 : 10 },
        terrain: { raw: snowy ? 15 : 4, effective: snowy ? 15 : 4 },
      },
      confidenceReasons: ["All values are synthetic."],
    },
    gear: [
      {
        title: "Shell layer",
        detail: "Wind protection on exposed terrain.",
        category: "Clothing",
        tone: "neutral",
      },
      {
        title: "Headlamp",
        detail: "For an early start or delayed return.",
        category: "Essentials",
        tone: "neutral",
      },
    ],
  };
}
