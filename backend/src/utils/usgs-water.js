const { toFiniteOrNull } = require('./numbers');
const { classifyFlowTrend } = require('./local-conditions');
const BASE = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections';

// Modern OGC API. Never interpret a missing value or a stale gauge as zero flow.
const createUsgsWaterService = ({ fetchWithTimeout, haversineKm, apiKey, now = Date.now }) => {
  const get = async (collection, params, fetchOptions, itemId = null) => {
    const response = await fetchWithTimeout(`${BASE}/${collection}/items${itemId ? `/${encodeURIComponent(itemId)}` : ''}?${new URLSearchParams({ f: 'json', ...(itemId ? {} : { limit: '1000' }), ...params })}`, {
      ...fetchOptions,
      headers: { ...fetchOptions?.headers, ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
    }, 12000);
    if (!response.ok) throw new Error(`USGS Water Data HTTP ${response.status}`);
    return response.json();
  };
  return async ({ lat, lon, fetchOptions }) => {
    const pad = 50 / 111;
    const lonPad = pad / Math.max(0.1, Math.cos(lat * Math.PI / 180));
    const bbox = [Math.max(-180, lon - lonPad), Math.max(-90, lat - pad), Math.min(180, lon + lonPad), Math.min(90, lat + pad)].join(',');
    const payloads = await Promise.all(['00060', '00065'].map((parameter_code) => get('latest-continuous', { bbox, parameter_code }, fetchOptions)));
    const sites = new Map();
    for (const payload of payloads) {
      // Truncation could hide the nearest station; fail explicitly instead of guessing.
      if (payload.links?.some((link) => link.rel === 'next')) return { available: false, status: 'incomplete', source: 'USGS Water Data', note: 'Gauge search exceeded the result limit.' };
      for (const feature of payload.features || []) {
        const p = feature.properties || {};
        const coords = feature.geometry?.coordinates;
        const value = toFiniteOrNull(p.value);
        const time = Date.parse(p.time);
        if (!Array.isArray(coords) || coords.some((v) => typeof v !== 'number') || value === null || !Number.isFinite(time) || now() - time > 3 * 3600000 || time > now() + 300000) continue;
        const flow = p.parameter_code === '00060' && ['ft3/s', 'ft^3/s', 'ft³/s'].includes(p.unit_of_measure) && value >= 0;
        const stage = p.parameter_code === '00065' && p.unit_of_measure === 'ft' && value > -999;
        if (!flow && !stage) continue;
        const id = p.monitoring_location_id;
        if (!/^USGS-[\w-]+$/.test(id || '')) continue;
        const entry = sites.get(id) || { id, distanceKm: haversineKm(lat, lon, coords[1], coords[0]) };
        const key = flow ? 'discharge' : 'gage';
        if (!entry[key] || time > Date.parse(entry[key].time)) entry[key] = { value, time: p.time };
        sites.set(id, entry);
      }
    }
    const nearest = [...sites.values()].filter((s) => s.distanceKm <= 50).sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (!nearest) return { available: false, status: 'no_data', source: 'USGS Water Data', note: 'No gauge observation within 50 km and the last 3 hours.' };
    const result = {
      available: true, status: 'ok', source: 'USGS Water Data', siteId: nearest.id.replace(/^USGS-/, ''), siteName: nearest.id,
      distanceKm: Math.round(nearest.distanceKm * 10) / 10,
      dischargeCfs: nearest.discharge?.value ?? null, gageHeightFt: nearest.gage?.value ?? null,
      observedTime: (nearest.discharge || nearest.gage).time,
      dischargeObservedTime: nearest.discharge?.time ?? null, gageHeightObservedTime: nearest.gage?.time ?? null,
      trend: 'unknown', note: 'Provisional gauge observations; verify that the gauge represents the route-crossed drainage.',
    };
    const details = await Promise.allSettled([
      get('monitoring-locations', {}, fetchOptions, nearest.id),
      get('continuous', { monitoring_location_id: nearest.id, parameter_code: nearest.discharge ? '00060' : '00065', datetime: `${new Date(now() - 86400000).toISOString()}/${new Date(now()).toISOString()}` }, fetchOptions),
    ]);
    if (details[0].status === 'fulfilled') result.siteName = details[0].value.properties?.monitoring_location_name || nearest.id;
    if (details[1].status === 'fulfilled' && !details[1].value.links?.some((link) => link.rel === 'next')) {
      const values = (details[1].value.features || []).map((f) => f.properties).filter((p) => p && p.monitoring_location_id === nearest.id && p.parameter_code === (nearest.discharge ? '00060' : '00065') && p.unit_of_measure === (nearest.discharge ? 'ft3/s' : 'ft') && toFiniteOrNull(p.value) !== null && Number(p.value) > -999 && (!nearest.discharge || Number(p.value) >= 0) && Number.isFinite(Date.parse(p.time)) && Date.parse(p.time) <= now() && Date.parse(p.time) >= now() - 86400000).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      result.trend = classifyFlowTrend(values.map((p) => p.value));
    }
    return result;
  };
};
module.exports = { createUsgsWaterService };
