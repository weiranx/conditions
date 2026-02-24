import L from 'leaflet';

export type DecisionLevel = 'GO' | 'CAUTION' | 'NO-GO';
export type ActivityType = 'backcountry';
export type ThemeMode = 'system' | 'light' | 'dark';
export type MapStyle = 'topo' | 'street';
export type TemperatureUnit = 'f' | 'c';
export type ElevationUnit = 'ft' | 'm';
export type WindSpeedUnit = 'mph' | 'kph';
export type TimeStyle = 'ampm' | '24h';

export interface AvalancheElevationBand {
  level?: number;
  label?: string;
}

export interface AvalancheProblem {
  id?: number;
  name?: string;
  likelihood?: string;
  size?: Array<string | number> | string | number;
  location?: string[] | string | Record<string, unknown>;
  discussion?: string;
  problem_description?: string;
  icon?: string;
}

export interface WeatherTrendPoint {
  time: string;
  temp: number;
  wind: number;
  gust: number;
  windDirection?: string | null;
  precipChance?: number;
  humidity?: number | null;
  dewPoint?: number | null;
  cloudCover?: number | null;
  timeIso?: string | null;
  isDaytime?: boolean | null;
  condition: string;
}

export interface ElevationForecastBand {
  label: string;
  elevationFt: number;
  deltaFromObjectiveFt: number;
  temp: number;
  feelsLike: number;
  windSpeed: number;
  windGust: number;
}

export interface SafetyData {
  generatedAt?: string;
  location: { lat: number; lon: number };
  forecast?: {
    selectedDate?: string;
    selectedStartTime?: string;
    selectedEndTime?: string;
    isFuture?: boolean;
    availableRange?: { start?: string; end?: string };
  };
  weather: {
    temp: number;
    feelsLike?: number;
    dewPoint?: number | null;
    description: string;
    windSpeed: number;
    windGust: number;
    windDirection?: string | null;
    humidity: number;
    cloudCover: number | null;
    precipChance: number;
    isDaytime?: boolean | null;
    forecastLink?: string;
    issuedTime?: string;
    generatedTime?: string | null;
    timezone?: string | null;
    forecastStartTime?: string;
    forecastEndTime?: string;
    forecastDate?: string;
    temperatureContext24h?: {
      windowHours?: number | null;
      timezone?: string | null;
      minTempF?: number | null;
      maxTempF?: number | null;
      overnightLowF?: number | null;
      daytimeHighF?: number | null;
    } | null;
    trend?: WeatherTrendPoint[];
    elevation?: number | null;
    elevationUnit?: string;
    elevationSource?: string;
    elevationForecast?: ElevationForecastBand[];
    elevationForecastNote?: string;
    sourceDetails?: {
      primary?: string;
      blended?: boolean;
      supplementalSources?: string[];
      fieldSources?: Record<string, string>;
    };
  };
  solar: { sunrise: string; sunset: string; dayLength: string };
  avalanche: {
    risk: string;
    dangerLevel: number;
    dangerUnknown?: boolean;
    relevant?: boolean;
    relevanceReason?: string;
    coverageStatus?: 'reported' | 'no_center_coverage' | 'temporarily_unavailable' | 'no_active_forecast' | 'expired_for_selected_start';
    center?: string;
    zone?: string;
    problems?: AvalancheProblem[];
    bottomLine?: string;
    advice?: string;
    link?: string;
    elevations?: {
      below?: AvalancheElevationBand;
      at?: AvalancheElevationBand;
      above?: AvalancheElevationBand;
    };
    publishedTime?: string;
    expiresTime?: string;
    generatedTime?: string | null;
  };
  alerts?: {
    source?: string;
    status?: string;
    activeCount?: number;
    totalActiveCount?: number;
    targetTime?: string | null;
    highestSeverity?: string;
    alerts?: Array<{
      event?: string;
      severity?: string;
      urgency?: string;
      certainty?: string;
      headline?: string;
      description?: string | null;
      instruction?: string | null;
      areaDesc?: string | null;
      affectedAreas?: string[];
      senderName?: string | null;
      response?: string | null;
      messageType?: string | null;
      category?: string | null;
      sent?: string | null;
      onset?: string | null;
      ends?: string | null;
      effective?: string | null;
      expires?: string | null;
      link?: string | null;
    }>;
    note?: string | null;
    generatedTime?: string | null;
  };
  airQuality?: {
    source?: string;
    status?: string;
    usAqi?: number | null;
    category?: string;
    pm25?: number | null;
    pm10?: number | null;
    ozone?: number | null;
    measuredTime?: string | null;
    generatedTime?: string | null;
  };
  rainfall?: {
    source?: string;
    status?: string;
    mode?: 'observed_recent' | 'projected_for_selected_start';
    issuedTime?: string | null;
    anchorTime?: string | null;
    timezone?: string | null;
    expected?: {
      status?: string;
      travelWindowHours?: number | null;
      startTime?: string | null;
      endTime?: string | null;
      rainWindowMm?: number | null;
      rainWindowIn?: number | null;
      snowWindowCm?: number | null;
      snowWindowIn?: number | null;
      note?: string | null;
    };
    totals?: {
      rainPast12hMm?: number | null;
      rainPast24hMm?: number | null;
      rainPast48hMm?: number | null;
      rainPast12hIn?: number | null;
      rainPast24hIn?: number | null;
      rainPast48hIn?: number | null;
      snowPast12hCm?: number | null;
      snowPast24hCm?: number | null;
      snowPast48hCm?: number | null;
      snowPast12hIn?: number | null;
      snowPast24hIn?: number | null;
      snowPast48hIn?: number | null;
      past12hMm?: number | null;
      past24hMm?: number | null;
      past48hMm?: number | null;
      past12hIn?: number | null;
      past24hIn?: number | null;
      past48hIn?: number | null;
    };
    note?: string | null;
    link?: string | null;
    generatedTime?: string | null;
  };
  snowpack?: {
    source?: string;
    status?: string;
    summary?: string;
    snotel?: {
      source?: string;
      status?: string;
      stationTriplet?: string;
      stationId?: string | null;
      stationName?: string;
      networkCode?: string | null;
      stateCode?: string | null;
      distanceKm?: number | null;
      elevationFt?: number | null;
      observedDate?: string | null;
      snowDepthIn?: number | null;
      sweIn?: number | null;
      precipIn?: number | null;
      obsTempF?: number | null;
      link?: string | null;
      note?: string | null;
    } | null;
    nohrsc?: {
      source?: string;
      status?: string;
      sampledTime?: string | null;
      snowDepthIn?: number | null;
      sweIn?: number | null;
      depthMeters?: number | null;
      sweMillimeters?: number | null;
      depthDataset?: string | null;
      sweDataset?: string | null;
      link?: string | null;
      note?: string | null;
    } | null;
    generatedTime?: string | null;
  };
  fireRisk?: {
    source?: string;
    status?: string;
    level?: number;
    label?: string;
    guidance?: string;
    reasons?: string[];
    alertsUsed?: number;
    alertsConsidered?: Array<{
      event?: string;
      severity?: string;
      expires?: string | null;
      link?: string | null;
    }>;
  };
  heatRisk?: {
    source?: string;
    status?: string;
    level?: number;
    label?: string;
    guidance?: string;
    reasons?: string[];
    metrics?: {
      tempF?: number | null;
      feelsLikeF?: number | null;
      humidity?: number | null;
      peakTemp12hF?: number | null;
      peakFeelsLike12hF?: number | null;
      lowerTerrainTempF?: number | null;
      lowerTerrainFeelsLikeF?: number | null;
      lowerTerrainLabel?: string | null;
      lowerTerrainElevationFt?: number | null;
      isDaytime?: boolean | null;
    };
    generatedTime?: string | null;
  };
  gear?: string[];
  trail?: string;
  terrainCondition?: {
    code?: string;
    label?: string;
    impact?: 'low' | 'moderate' | 'high' | string;
    recommendedTravel?: string;
    snowProfile?: {
      code?: string;
      label?: string;
      summary?: string;
      confidence?: 'high' | 'medium' | 'low';
      reasons?: string[];
    };
    confidence?: 'high' | 'medium' | 'low';
    summary?: string;
    reasons?: string[];
    signals?: {
      tempF?: number | null;
      precipChance?: number | null;
      humidity?: number | null;
      windMph?: number | null;
      gustMph?: number | null;
      wetTrendHours?: number | null;
      snowTrendHours?: number | null;
      rain12hIn?: number | null;
      rain24hIn?: number | null;
      rain48hIn?: number | null;
      snow12hIn?: number | null;
      snow24hIn?: number | null;
      snow48hIn?: number | null;
      expectedRainWindowIn?: number | null;
      expectedSnowWindowIn?: number | null;
      maxSnowDepthIn?: number | null;
      maxSweIn?: number | null;
      snotelDistanceKm?: number | null;
    };
  };
  safety: {
    score: number;
    confidence?: number;
    primaryHazard: string;
    explanations: string[];
    sourcesUsed?: string[];
    factors?: Array<{ hazard?: string; impact?: number; source?: string; message?: string }>;
    groupImpacts?: Record<string, { raw?: number; capped?: number; cap?: number }>;
    confidenceReasons?: string[];
    airQualityCategory?: string;
  };
  aiAnalysis: string;
}

export interface SummitDecision {
  level: DecisionLevel;
  headline: string;
  blockers: string[];
  cautions: string[];
  checks: { key?: string; label: string; ok: boolean; detail?: string; action?: string }[];
}

export type NwsAlertItem = NonNullable<NonNullable<SafetyData['alerts']>['alerts']>[number];

export interface SnowpackInterpretation {
  headline: string;
  confidence: 'solid' | 'watch' | 'low';
  bullets: string[];
}

export interface SnowpackInsightBadge {
  label: string;
  detail: string;
  tone: 'good' | 'watch' | 'warn';
}

export interface SnowpackSnapshotInsights {
  signal: SnowpackInsightBadge;
  freshness: SnowpackInsightBadge;
  representativeness: SnowpackInsightBadge;
  agreement: SnowpackInsightBadge;
}

export interface LinkState {
  view: 'home' | 'planner' | 'settings' | 'status' | 'trip';
  activity: ActivityType;
  position: L.LatLng;
  hasObjective: boolean;
  objectiveName: string;
  searchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  turnaroundTime: string;
  targetElevationInput: string;
}

export interface UserPreferences {
  defaultActivity: ActivityType;
  defaultStartTime: string;
  defaultBackByTime: string;
  themeMode: ThemeMode;
  temperatureUnit: TemperatureUnit;
  elevationUnit: ElevationUnit;
  windSpeedUnit: WindSpeedUnit;
  timeStyle: TimeStyle;
  maxWindGustMph: number;
  maxPrecipChance: number;
  minFeelsLikeF: number;
  travelWindowHours: number;
}

export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'missing';

export interface HealthCheckResult {
  label: string;
  status: 'ok' | 'warn' | 'down';
  detail: string;
}

export type CriticalRiskLevel = 'stable' | 'watch' | 'high';

export interface DayOverDayComparison {
  previousDate: string;
  previousScore: number;
  delta: number;
  changes: string[];
}

export interface TravelWindowRow {
  time: string;
  pass: boolean;
  reasonSummary: string;
  failedRules: string[];
  failedRuleLabels: string[];
  temp: number;
  feelsLike: number;
  wind: number;
  gust: number;
  precipChance: number;
}

export interface TravelWindowSpan {
  start: string;
  end: string;
  length: number;
}

export interface TravelWindowInsights {
  passHours: number;
  failHours: number;
  bestWindow: TravelWindowSpan | null;
  nextCleanWindow: TravelWindowSpan | null;
  topFailureLabels: string[];
  summary: string;
}
