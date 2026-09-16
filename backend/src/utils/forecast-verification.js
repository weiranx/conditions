// Input pairs must be matched at the same location, time, variable and unit.
// Do not pair a summit forecast with a valley observation as ground truth.
const verifyForecastPairs = (pairs) => {
  if (!Array.isArray(pairs)) throw new Error('Expected an array of matched forecast/observation pairs');
  const groups = new Map();
  const seen = new Set();
  let rejected = 0;
  for (const pair of pairs) {
    const valid = Date.parse(pair?.validAt);
    const issued = Date.parse(pair?.issuedAt);
    const observed = Date.parse(pair?.observedAt);
    const labels = ['provider', 'forecastLocationId', 'observationLocationId', 'variable', 'unit'];
    if (!pair || labels.some(key => typeof pair[key] !== 'string' || !pair[key].trim())
      || pair.forecastLocationId !== pair.observationLocationId
      || ['issuedAt', 'validAt', 'observedAt'].some(key => typeof pair[key] !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(pair[key]))
      || !Number.isFinite(valid) || !Number.isFinite(issued) || valid !== observed || issued > valid
      || typeof pair.forecast !== 'number' || !Number.isFinite(pair.forecast)
      || typeof pair.observed !== 'number' || !Number.isFinite(pair.observed)) { rejected += 1; continue; }
    const id = JSON.stringify([pair.provider, pair.forecastLocationId, pair.variable, pair.unit, issued, valid]);
    if (seen.has(id)) { rejected += 1; continue; }
    seen.add(id);
    const leadHours = (valid - issued) / 3600000;
    const leadBucket = leadHours < 24 ? '0–24h' : leadHours < 48 ? '24–48h' : leadHours < 72 ? '48–72h' : '72h+';
    const key = JSON.stringify([pair.provider, pair.variable, pair.unit, leadBucket]);
    const group = groups.get(key) || { provider: pair.provider, variable: pair.variable, unit: pair.unit, leadBucket, count: 0, sum: 0, absolute: 0, squared: 0 };
    const error = pair.forecast - pair.observed;
    group.count += 1; group.sum += error; group.absolute += Math.abs(error); group.squared += error ** 2;
    groups.set(key, group);
  }
  return { rejected, groups: [...groups.values()].map(({ sum, absolute, squared, ...group }) => ({ ...group, bias: sum / group.count, mae: absolute / group.count, rmse: Math.sqrt(squared / group.count) })) };
};
module.exports = { verifyForecastPairs };
