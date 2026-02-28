export interface SnowpackData {
  source: string;
  status: string;
  summary: string;
  snotel: any | null;
  nohrsc: any | null;
  historical: any | null;
  generatedTime?: string;
}

export const createUnavailableSnowpackData = (status: string = 'unavailable'): SnowpackData => ({
  source: 'NRCS AWDB / SNOTEL, NOAA NOHRSC Snow Analysis',
  status,
  summary: 'Snowpack observations unavailable.',
  snotel: null,
  nohrsc: null,
  historical: null,
});

interface CreateSnowpackServiceOptions {
  fetchWithTimeout: Function;
  formatIsoDateUtc: (date: Date) => string | null;
  shiftIsoDateUtc: (isoDate: string, deltaDays: number) => string | null;
  haversineKm: (latA: number, lonA: number, latB: number, lonB: number) => number;
  stationCacheTtlMs?: number;
}

export const createSnowpackService = ({
  fetchWithTimeout,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  haversineKm,
  stationCacheTtlMs = 12 * 60 * 60 * 1000,
}: CreateSnowpackServiceOptions) => {
  let snotelStationCache: { fetchedAt: number; data: any[] | null } = {
    fetchedAt: 0,
    data: null,
  };

  const MAX_REASONABLE_NOHRSC_DEPTH_METERS = 20;
  const MAX_REASONABLE_NOHRSC_SWE_MM = 5000;
  const HISTORICAL_BASELINE_LOOKBACK_YEARS = 10;
  const HISTORICAL_MATCH_WINDOW_DAYS = 7;
  const HISTORICAL_FETCH_LOOKBACK_DAYS = HISTORICAL_BASELINE_LOOKBACK_YEARS * 366 + HISTORICAL_MATCH_WINDOW_DAYS;

  const isValidIsoDate = (value: any): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  const getSnotelTargetDate = (selectedDate: string | null | undefined): string | null => {
    const todayIso = formatIsoDateUtc(new Date());
    if (!todayIso) {
      return selectedDate && isValidIsoDate(selectedDate) ? selectedDate : null;
    }
    if (!selectedDate || !isValidIsoDate(selectedDate)) {
      return todayIso;
    }
    return (selectedDate as string) > todayIso ? todayIso : (selectedDate as string);
  };

  const extractLatestAwdbValue = (values: any[] | null | undefined, targetDateIso: string | null | undefined): { date: string; value: number; flag: string | null } | null => {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const candidates = values
      .filter((entry) => entry && Number.isFinite(Number(entry.value)) && isValidIsoDate(String(entry.date || '')))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!candidates.length) {
      return null;
    }
    const bounded = targetDateIso ? candidates.filter((entry) => String(entry.date) <= targetDateIso) : candidates;
    const picked = (bounded.length ? bounded : candidates).at(-1);
    if (!picked) {
      return null;
    }
    return {
      date: String(picked.date),
      value: Number(picked.value),
      flag: picked.flag || null,
    };
  };

  const parseIsoDateParts = (isoValue: string | null | undefined): { year: number; month: number; day: number } | null => {
    if (!isValidIsoDate(isoValue)) {
      return null;
    }
    const [yearText, monthText, dayText] = String(isoValue).split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    return { year, month, day };
  };

  const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  const pad2 = (value: number): string => String(value).padStart(2, '0');

  const buildIsoDate = (year: number, month: number, day: number): string => `${year}-${pad2(month)}-${pad2(day)}`;

  const toUtcDayStamp = (isoValue: string | null | undefined): number | null => {
    const parsed = parseIsoDateParts(isoValue);
    if (!parsed) {
      return null;
    }
    return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  };

  const daysBetweenIsoDates = (a: string | null | undefined, b: string | null | undefined): number | null => {
    const aStamp = toUtcDayStamp(a);
    const bStamp = toUtcDayStamp(b);
    if (!Number.isFinite(aStamp) || !Number.isFinite(bStamp)) {
      return null;
    }
    return Math.round(((aStamp as number) - (bStamp as number)) / (24 * 60 * 60 * 1000));
  };

  const buildHistoricalTargetIsoForYear = (year: number, month: number, day: number): string => {
    if (month === 2 && day === 29 && !isLeapYear(year)) {
      return buildIsoDate(year, 2, 28);
    }
    return buildIsoDate(year, month, day);
  };

  const pickClosestHistoricalSample = (values: any[] | null | undefined, targetIso: string, maxWindowDays: number): { date: string; value: number; dayOffset: number } | null => {
    if (!Array.isArray(values) || !values.length || !isValidIsoDate(targetIso)) {
      return null;
    }
    const valid = values
      .filter((entry) => entry && Number.isFinite(Number(entry.value)) && isValidIsoDate(String(entry.date || '')))
      .map((entry) => ({ date: String(entry.date), value: Number(entry.value) }))
      .filter((entry) => entry.date <= targetIso);
    if (!valid.length) {
      return null;
    }
    let best: { date: string; value: number; dayOffset: number } | null = null;
    for (const entry of valid) {
      const dayOffset = daysBetweenIsoDates(targetIso, entry.date);
      if (dayOffset === null || dayOffset < 0 || dayOffset > maxWindowDays) {
        continue;
      }
      if (!best || dayOffset < best.dayOffset || (dayOffset === best.dayOffset && entry.date > best.date)) {
        best = { ...entry, dayOffset };
      }
    }
    return best;
  };

  const extractHistoricalAverageAwdbValue = (values: any[] | null | undefined, targetDateIso: string, lookbackYears: number = HISTORICAL_BASELINE_LOOKBACK_YEARS) => {
    const targetParts = parseIsoDateParts(targetDateIso);
    if (!targetParts || !Array.isArray(values) || values.length === 0) {
      return null;
    }
    const pickedSamples: { date: string; value: number; dayOffset: number }[] = [];
    for (let year = targetParts.year - 1; year >= targetParts.year - lookbackYears; year -= 1) {
      const historicalTargetIso = buildHistoricalTargetIsoForYear(year, targetParts.month, targetParts.day);
      const sample = pickClosestHistoricalSample(values, historicalTargetIso, HISTORICAL_MATCH_WINDOW_DAYS);
      if (sample) {
        pickedSamples.push({
          date: sample.date,
          value: sample.value,
          dayOffset: sample.dayOffset,
        });
      }
    }
    if (!pickedSamples.length) {
      return null;
    }
    const mean = pickedSamples.reduce((sum, item) => sum + item.value, 0) / pickedSamples.length;
    const maxOffsetDays = pickedSamples.reduce((max, item) => Math.max(max, item.dayOffset), 0);
    return {
      average: Number(mean.toFixed(2)),
      sampleCount: pickedSamples.length,
      lookbackYears,
      maxOffsetDays,
      sampleDates: pickedSamples.map((entry) => entry.date).slice(0, 5),
    };
  };

  const compareCurrentToHistoricalAverage = (currentValue: number | null | undefined, averageValue: number | null | undefined) => {
    const currentNumeric = Number(currentValue);
    const averageNumeric = Number(averageValue);
    if (!Number.isFinite(currentNumeric) || !Number.isFinite(averageNumeric) || averageNumeric <= 0) {
      return {
        status: 'unknown',
        percentOfAverage: null,
      };
    }
    const ratio = currentNumeric / averageNumeric;
    const percentOfAverage = Math.round(ratio * 100);
    if (ratio >= 1.2) {
      return { status: 'above_average', percentOfAverage };
    }
    if (ratio <= 0.8) {
      return { status: 'below_average', percentOfAverage };
    }
    return { status: 'at_average', percentOfAverage };
  };

  const getSnotelStations = async (fetchOptions: any): Promise<any[]> => {
    const now = Date.now();
    if (snotelStationCache.data && now - snotelStationCache.fetchedAt < stationCacheTtlMs) {
      return snotelStationCache.data;
    }

    const stationRes = await fetchWithTimeout(
      'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?elements=WTEQ,SNWD,PREC&durations=DAILY&activeOnly=true',
      fetchOptions,
    );
    if (!stationRes.ok) {
      throw new Error(`AWDB station metadata request failed with status ${stationRes.status}`);
    }
    const stationJson = await stationRes.json();
    const filtered = Array.isArray(stationJson)
      ? stationJson.filter((station) =>
          ['SNTL', 'SNTLT', 'MSNT'].includes(String(station?.networkCode || '').toUpperCase()) &&
          Number.isFinite(Number(station?.latitude)) &&
          Number.isFinite(Number(station?.longitude)),
        )
      : [];

    snotelStationCache = {
      fetchedAt: now,
      data: filtered,
    };
    return filtered;
  };

  const findNearestSnotelStation = (lat: number, lon: number, stations: any[], maxDistanceKm: number = 140) => {
    if (!Array.isArray(stations) || !stations.length) {
      return null;
    }
    let nearest: any = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const station of stations) {
      const stationLat = Number(station.latitude);
      const stationLon = Number(station.longitude);
      if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) {
        continue;
      }
      const distanceKm = haversineKm(lat, lon, stationLat, stationLon);
      if (distanceKm < nearestDistance) {
        nearestDistance = distanceKm;
        nearest = station;
      }
    }
    if (!nearest || !Number.isFinite(nearestDistance) || nearestDistance > maxDistanceKm) {
      return null;
    }
    return {
      station: nearest,
      distanceKm: nearestDistance,
    };
  };

  const parseNohrscPixelValue = (resultEntry: any): number | null => {
    const raw = resultEntry?.attributes?.['Service Pixel Value'];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric;
  };

  const sampleNohrscSnowAnalysis = async (lat: number, lon: number, fetchOptions: any): Promise<any> => {
    const extentPaddingDeg = 0.6;
    const mapExtent = `${(lon - extentPaddingDeg).toFixed(4)},${(lat - extentPaddingDeg).toFixed(4)},${(
      lon + extentPaddingDeg
    ).toFixed(4)},${(lat + extentPaddingDeg).toFixed(4)}`;
    const identifyUrl =
      `https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/identify` +
      `?f=pjson&geometry=${encodeURIComponent(`${lon},${lat}`)}` +
      `&geometryType=esriGeometryPoint&sr=4326&tolerance=2` +
      `&mapExtent=${encodeURIComponent(mapExtent)}` +
      `&imageDisplay=800,600,96&returnGeometry=false&layers=all:3,7`;
    const nohrscRes = await fetchWithTimeout(identifyUrl, fetchOptions);
    if (!nohrscRes.ok) {
      throw new Error(`NOHRSC snow analysis request failed with status ${nohrscRes.status}`);
    }
    const sampledHeader = nohrscRes.headers?.get?.('date') || null;
    const sampledDate = sampledHeader ? new Date(sampledHeader) : null;
    const sampledTime =
      sampledDate && Number.isFinite(sampledDate.getTime()) ? sampledDate.toISOString() : null;
    const nohrscJson = await nohrscRes.json();
    const results = Array.isArray(nohrscJson?.results) ? nohrscJson.results : [];
    const snowDepthResult = results.find((entry: any) => Number(entry?.layerId) === 3) || null;
    const sweResult = results.find((entry: any) => Number(entry?.layerId) === 7) || null;
    const rawDepthMeters = parseNohrscPixelValue(snowDepthResult);
    const rawSweMillimeters = parseNohrscPixelValue(sweResult);
    const depthMeters =
      Number.isFinite(rawDepthMeters) &&
      (rawDepthMeters as number) >= 0 &&
      (rawDepthMeters as number) <= MAX_REASONABLE_NOHRSC_DEPTH_METERS
        ? rawDepthMeters
        : null;
    const sweMillimeters =
      Number.isFinite(rawSweMillimeters) &&
      (rawSweMillimeters as number) >= 0 &&
      (rawSweMillimeters as number) <= MAX_REASONABLE_NOHRSC_SWE_MM
        ? rawSweMillimeters
        : null;
    if (!Number.isFinite(depthMeters) && !Number.isFinite(sweMillimeters)) {
      return null;
    }
    const depthInches = Number.isFinite(depthMeters) ? Math.max(0, Number(((depthMeters as number) * 39.3701).toFixed(1))) : null;
    const sweInches = Number.isFinite(sweMillimeters) ? Math.max(0, Number(((sweMillimeters as number) * 0.0393701).toFixed(1))) : null;
    const filteredSignals = [];
    if (Number.isFinite(rawDepthMeters) && !Number.isFinite(depthMeters)) {
      filteredSignals.push('depth');
    }
    if (Number.isFinite(rawSweMillimeters) && !Number.isFinite(sweMillimeters)) {
      filteredSignals.push('SWE');
    }

    return {
      source: 'NOAA NOHRSC Snow Analysis',
      status: 'ok',
      sampledTime,
      snowDepthIn: depthInches,
      sweIn: sweInches,
      depthMeters: Number.isFinite(depthMeters) ? Number((depthMeters as number).toFixed(2)) : null,
      sweMillimeters: Number.isFinite(sweMillimeters) ? Number((sweMillimeters as number).toFixed(1)) : null,
      depthDataset: snowDepthResult?.attributes?.name || null,
      sweDataset: sweResult?.attributes?.name || null,
      link: 'https://www.nohrsc.noaa.gov/nsa/',
      note:
        filteredSignals.length > 0
          ? `Point sample from NOAA National Snow Analysis raster. Implausible ${filteredSignals.join(' + ')} value(s) were discarded.`
          : 'Point sample from NOAA National Snow Analysis raster (depth converted from meters; SWE converted from millimeters).',
    };
  };

  const fetchSnowpackData = async (lat: number, lon: number, selectedDate: string | null | undefined, fetchOptions: any): Promise<SnowpackData> => {
    const targetDate = getSnotelTargetDate(selectedDate);
    const beginDate = shiftIsoDateUtc(targetDate || formatIsoDateUtc(new Date()) || '', -HISTORICAL_FETCH_LOOKBACK_DAYS);
    const todayIso = formatIsoDateUtc(new Date());

    const snotelTask = (async () => {
      const stations = await getSnotelStations(fetchOptions);
      const nearest = findNearestSnotelStation(lat, lon, stations);
      if (!nearest) {
        return null;
      }

      const stationTriplet = String(nearest.station.stationTriplet || '');
      if (!stationTriplet) {
        return null;
      }

      const dataUrl =
        `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=${encodeURIComponent(stationTriplet)}` +
        `&elements=WTEQ,SNWD,PREC,TOBS&duration=DAILY` +
        `${beginDate ? `&beginDate=${encodeURIComponent(beginDate)}` : ''}` +
        `${targetDate ? `&endDate=${encodeURIComponent(targetDate)}` : ''}` +
        '&periodRef=END';
      const dataRes = await fetchWithTimeout(dataUrl, fetchOptions);
      if (!dataRes.ok) {
        throw new Error(`AWDB station data request failed with status ${dataRes.status}`);
      }
      const dataJson = await dataRes.json();
      const stationData = Array.isArray(dataJson) ? dataJson[0] : null;
      const elementData = Array.isArray(stationData?.data) ? stationData.data : [];
      const mapByElement: Record<string, any> = {};
      for (const entry of elementData) {
        const elementCode = String(entry?.stationElement?.elementCode || '').toUpperCase();
        if (!elementCode) {
          continue;
        }
        mapByElement[elementCode] = extractLatestAwdbValue(entry?.values, targetDate || todayIso);
      }

      const snowDepthIn = Number.isFinite(Number(mapByElement.SNWD?.value)) ? Number(mapByElement.SNWD.value) : null;
      const sweIn = Number.isFinite(Number(mapByElement.WTEQ?.value)) ? Number(mapByElement.WTEQ.value) : null;
      const precipIn = Number.isFinite(Number(mapByElement.PREC?.value)) ? Number(mapByElement.PREC.value) : null;
      const obsTempF = Number.isFinite(Number(mapByElement.TOBS?.value)) ? Number(mapByElement.TOBS.value) : null;
      const observedDate = mapByElement.SNWD?.date || mapByElement.WTEQ?.date || mapByElement.PREC?.date || mapByElement.TOBS?.date || null;
      const snwdEntry = elementData.find((entry: any) => String(entry?.stationElement?.elementCode || '').toUpperCase() === 'SNWD');
      const wteqEntry = elementData.find((entry: any) => String(entry?.stationElement?.elementCode || '').toUpperCase() === 'WTEQ');
      const snowDepthHistorical = extractHistoricalAverageAwdbValue(snwdEntry?.values || [], (targetDate || todayIso) as string);
      const sweHistorical = extractHistoricalAverageAwdbValue(wteqEntry?.values || [], (targetDate || todayIso) as string);
      const depthComparison = compareCurrentToHistoricalAverage(snowDepthIn, snowDepthHistorical?.average);
      const sweComparison = compareCurrentToHistoricalAverage(sweIn, sweHistorical?.average);
      const overallComparison: any =
        sweComparison.status !== 'unknown'
          ? { metric: 'SWE', status: sweComparison.status, percentOfAverage: sweComparison.percentOfAverage }
          : depthComparison.status !== 'unknown'
            ? { metric: 'Snow Depth', status: depthComparison.status, percentOfAverage: depthComparison.percentOfAverage }
            : { metric: null, status: 'unknown', percentOfAverage: null };
      const targetMonthDay = (() => {
        const targetParts = parseIsoDateParts(targetDate || todayIso);
        return targetParts ? `${pad2(targetParts.month)}-${pad2(targetParts.day)}` : null;
      })();
      const statusLabelByCode: Record<string, string> = {
        below_average: 'below average',
        at_average: 'at average',
        above_average: 'above average',
        unknown: 'unknown',
      };
      const overallSummary = overallComparison.metric
        ? `Current ${overallComparison.metric} is ${statusLabelByCode[overallComparison.status]} for this date${
            Number.isFinite(overallComparison.percentOfAverage) ? ` (${overallComparison.percentOfAverage}% of historical average)` : ''
          }.`
        : 'Historical average comparison unavailable for this date.';
      const historical = {
        targetDate: targetDate || todayIso,
        monthDay: targetMonthDay,
        lookbackYears: HISTORICAL_BASELINE_LOOKBACK_YEARS,
        source: 'NRCS AWDB / SNOTEL daily history',
        stationTriplet,
        stationName: nearest.station.name || stationTriplet,
        swe: {
          currentIn: sweIn,
          averageIn: Number.isFinite(Number(sweHistorical?.average)) ? Number(sweHistorical.average) : null,
          status: sweComparison.status,
          percentOfAverage: sweComparison.percentOfAverage,
          sampleCount: Number.isFinite(Number(sweHistorical?.sampleCount)) ? Number(sweHistorical.sampleCount) : 0,
          maxOffsetDays: Number.isFinite(Number(sweHistorical?.maxOffsetDays)) ? Number(sweHistorical.maxOffsetDays) : null,
        },
        depth: {
          currentIn: snowDepthIn,
          averageIn: Number.isFinite(Number(snowDepthHistorical?.average)) ? Number(snowDepthHistorical.average) : null,
          status: depthComparison.status,
          percentOfAverage: depthComparison.percentOfAverage,
          sampleCount: Number.isFinite(Number(snowDepthHistorical?.sampleCount)) ? Number(snowDepthHistorical.sampleCount) : 0,
          maxOffsetDays: Number.isFinite(Number(snowDepthHistorical?.maxOffsetDays)) ? Number(snowDepthHistorical.maxOffsetDays) : null,
        },
        overall: overallComparison,
        summary: overallSummary,
      };

      return {
        source: 'NRCS AWDB / SNOTEL',
        status: 'ok',
        stationTriplet,
        stationId: nearest.station.stationId || null,
        stationName: nearest.station.name || stationTriplet,
        networkCode: nearest.station.networkCode || null,
        stateCode: nearest.station.stateCode || null,
        distanceKm: Number(nearest.distanceKm.toFixed(1)),
        elevationFt: Number.isFinite(Number(nearest.station.elevation)) ? Math.round(Number(nearest.station.elevation)) : null,
        observedDate,
        snowDepthIn,
        sweIn,
        precipIn,
        obsTempF,
        link: nearest.station.stationId
          ? `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${encodeURIComponent(String(nearest.station.stationId))}`
          : null,
        note:
          targetDate && selectedDate && selectedDate > targetDate
            ? `Selected date is in the future; showing latest available daily SNOTEL observations through ${targetDate}.`
            : 'Nearest daily SNOTEL observation.',
        historical,
      };
    })();

    const nohrscTask = sampleNohrscSnowAnalysis(lat, lon, fetchOptions);
    const [snotelResult, nohrscResult] = await Promise.allSettled([snotelTask, nohrscTask]);

    const snotelData = snotelResult.status === 'fulfilled' ? snotelResult.value : null;
    const nohrscData = nohrscResult.status === 'fulfilled' ? nohrscResult.value : null;

    if (!snotelData && !nohrscData) {
      return createUnavailableSnowpackData('unavailable');
    }

    const summaryParts: string[] = [];
    if (snotelData) {
      summaryParts.push(
        `SNOTEL ${snotelData.stationName}: depth ${Number.isFinite(snotelData.snowDepthIn) ? `${snotelData.snowDepthIn} in` : 'N/A'}, SWE ${
          Number.isFinite(snotelData.sweIn) ? `${snotelData.sweIn} in` : 'N/A'
        } (${snotelData.distanceKm} km).`,
      );
      if (snotelData?.historical?.summary) {
        summaryParts.push(snotelData.historical.summary);
      }
    }
    if (nohrscData) {
      summaryParts.push(
        `NOHRSC grid: depth ${Number.isFinite(nohrscData.snowDepthIn) ? `${nohrscData.snowDepthIn} in` : 'N/A'}, SWE ${
          Number.isFinite(nohrscData.sweIn) ? `${nohrscData.sweIn} in` : 'N/A'
        }.`,
      );
    }

    return {
      source: 'NRCS AWDB / SNOTEL, NOAA NOHRSC Snow Analysis',
      status: snotelData && nohrscData ? 'ok' : 'partial',
      summary: summaryParts.join(' '),
      snotel: snotelData,
      nohrsc: nohrscData,
      historical: snotelData?.historical || null,
    };
  };

  return {
    createUnavailableSnowpackData,
    fetchSnowpackData,
  };
};
