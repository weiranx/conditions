const createUnavailableSnowpackData = (status = 'unavailable') => ({
  source: 'NRCS AWDB / SNOTEL, NOAA NOHRSC Snow Analysis',
  status,
  summary: 'Snowpack observations unavailable.',
  snotel: null,
  nohrsc: null,
});

const createSnowpackService = ({
  fetchWithTimeout,
  formatIsoDateUtc,
  shiftIsoDateUtc,
  haversineKm,
  stationCacheTtlMs = 12 * 60 * 60 * 1000,
}) => {
  let snotelStationCache = {
    fetchedAt: 0,
    data: null,
  };

  const MAX_REASONABLE_NOHRSC_DEPTH_METERS = 20;
  const MAX_REASONABLE_NOHRSC_SWE_MM = 5000;

  const isValidIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  const getSnotelTargetDate = (selectedDate) => {
    const todayIso = formatIsoDateUtc(new Date());
    if (!todayIso) {
      return selectedDate && isValidIsoDate(selectedDate) ? selectedDate : null;
    }
    if (!selectedDate || !isValidIsoDate(selectedDate)) {
      return todayIso;
    }
    return selectedDate > todayIso ? todayIso : selectedDate;
  };

  const extractLatestAwdbValue = (values, targetDateIso) => {
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

  const getSnotelStations = async (fetchOptions) => {
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

  const findNearestSnotelStation = (lat, lon, stations, maxDistanceKm = 140) => {
    if (!Array.isArray(stations) || !stations.length) {
      return null;
    }
    let nearest = null;
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

  const parseNohrscPixelValue = (resultEntry) => {
    const raw = resultEntry?.attributes?.['Service Pixel Value'];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric;
  };

  const sampleNohrscSnowAnalysis = async (lat, lon, fetchOptions) => {
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
    const snowDepthResult = results.find((entry) => Number(entry?.layerId) === 3) || null;
    const sweResult = results.find((entry) => Number(entry?.layerId) === 7) || null;
    const rawDepthMeters = parseNohrscPixelValue(snowDepthResult);
    const rawSweMillimeters = parseNohrscPixelValue(sweResult);
    const depthMeters =
      Number.isFinite(rawDepthMeters) &&
      rawDepthMeters >= 0 &&
      rawDepthMeters <= MAX_REASONABLE_NOHRSC_DEPTH_METERS
        ? rawDepthMeters
        : null;
    const sweMillimeters =
      Number.isFinite(rawSweMillimeters) &&
      rawSweMillimeters >= 0 &&
      rawSweMillimeters <= MAX_REASONABLE_NOHRSC_SWE_MM
        ? rawSweMillimeters
        : null;
    if (!Number.isFinite(depthMeters) && !Number.isFinite(sweMillimeters)) {
      return null;
    }
    const depthInches = Number.isFinite(depthMeters) ? Math.max(0, Number((depthMeters * 39.3701).toFixed(1))) : null;
    const sweInches = Number.isFinite(sweMillimeters) ? Math.max(0, Number((sweMillimeters * 0.0393701).toFixed(1))) : null;
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
      depthMeters: Number.isFinite(depthMeters) ? Number(depthMeters.toFixed(2)) : null,
      sweMillimeters: Number.isFinite(sweMillimeters) ? Number(sweMillimeters.toFixed(1)) : null,
      depthDataset: snowDepthResult?.attributes?.name || null,
      sweDataset: sweResult?.attributes?.name || null,
      link: 'https://www.nohrsc.noaa.gov/nsa/',
      note:
        filteredSignals.length > 0
          ? `Point sample from NOAA National Snow Analysis raster. Implausible ${filteredSignals.join(' + ')} value(s) were discarded.`
          : 'Point sample from NOAA National Snow Analysis raster (depth converted from meters; SWE converted from millimeters).',
    };
  };

  const fetchSnowpackData = async (lat, lon, selectedDate, fetchOptions) => {
    const targetDate = getSnotelTargetDate(selectedDate);
    const beginDate = shiftIsoDateUtc(targetDate || formatIsoDateUtc(new Date()), -45);
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
      const mapByElement = {};
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
      };
    })();

    const nohrscTask = sampleNohrscSnowAnalysis(lat, lon, fetchOptions);
    const [snotelResult, nohrscResult] = await Promise.allSettled([snotelTask, nohrscTask]);

    const snotelData = snotelResult.status === 'fulfilled' ? snotelResult.value : null;
    const nohrscData = nohrscResult.status === 'fulfilled' ? nohrscResult.value : null;

    if (!snotelData && !nohrscData) {
      return createUnavailableSnowpackData('unavailable');
    }

    const summaryParts = [];
    if (snotelData) {
      summaryParts.push(
        `SNOTEL ${snotelData.stationName}: depth ${Number.isFinite(snotelData.snowDepthIn) ? `${snotelData.snowDepthIn} in` : 'N/A'}, SWE ${
          Number.isFinite(snotelData.sweIn) ? `${snotelData.sweIn} in` : 'N/A'
        } (${snotelData.distanceKm} km).`,
      );
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
    };
  };

  return {
    createUnavailableSnowpackData,
    fetchSnowpackData,
  };
};

module.exports = {
  createUnavailableSnowpackData,
  createSnowpackService,
};
