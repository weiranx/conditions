const parseIsoTimeToMs = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const withTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed);
  const parsed = Date.parse(withTimezone ? trimmed : `${trimmed}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseIsoTimeToMsWithReference = (value, referenceIso) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (/([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed)) {
    return parseIsoTimeToMs(trimmed);
  }

  const refSuffix = getIsoTimezoneSuffix(referenceIso);
  if (refSuffix) {
    return parseIsoTimeToMs(`${trimmed}${refSuffix === 'Z' ? 'Z' : refSuffix}`);
  }

  return parseIsoTimeToMs(trimmed);
};

const parseStartClock = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
};

const getIsoTimezoneSuffix = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/([+\-]\d{2}:\d{2}|Z)$/);
  return match ? match[1] : null;
};

const buildPlannedStartIso = ({ selectedDate, startClock, referenceIso }) => {
  if (typeof selectedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !startClock) {
    return referenceIso || null;
  }
  const tzSuffix = getIsoTimezoneSuffix(referenceIso) || 'Z';
  return `${selectedDate}T${startClock}:00${tzSuffix === 'Z' ? 'Z' : tzSuffix}`;
};

const findClosestTimeIndex = (timeArray, targetTimeMs) => {
  if (!Array.isArray(timeArray) || !timeArray.length) {
    return -1;
  }

  let bestIdx = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < timeArray.length; i += 1) {
    const currentMs = parseIsoTimeToMs(timeArray[i]);
    if (currentMs === null) {
      continue;
    }
    const distance = Math.abs(currentMs - targetTimeMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
};

module.exports = {
  parseIsoTimeToMs,
  parseIsoTimeToMsWithReference,
  parseStartClock,
  buildPlannedStartIso,
  findClosestTimeIndex,
};
