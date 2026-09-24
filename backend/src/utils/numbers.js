/**
 * Reads a provider or request value as a finite number, or null when absent.
 *
 * Number(null), Number(''), Number('  ') and Number(false) are all 0, so a
 * plain Number() turns a missing reading into a real-looking zero: 0 °F, no
 * snow, clear skies, calm wind. Only numbers and non-blank strings count.
 */
const toFiniteOrNull = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

module.exports = {
  toFiniteOrNull,
};
