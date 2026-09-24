const DAY = 86400000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SECTION_TEXT_LIMIT = 6000;

// Sections are classified by their standard AFD headings, never by keywords in
// the prose: negation, dates and geography make prose matching unreliable.
const classify = (title) => {
  if (/KEY MESSAGES/.test(title)) return 'key_messages';
  if (/NEAR TERM|SHORT TERM|MID TERM|MEDIUM TERM|LONG TERM|EXTENDED/.test(title)) return 'period';
  if (/FIRE WEATHER/.test(title)) return 'fire_weather';
  if (/WATCHES|WARNINGS|ADVISORIES/.test(title)) return 'warnings';
  if (/HYDROLOGY/.test(title)) return 'hydrology';
  if (/AVIATION|MARINE|BEACH|TIDES|COASTAL|CLIMATE|POINT TEMPS|PRELIMINARY|EQUIPMENT|RIP CURRENT|AIR QUALITY/.test(title)) return 'not_relevant';
  return 'overview';
};

// "301 PM PDT Tue Sep 16 2026": the office's local issuance date anchors
// weekday names in period headings such as "/Tonight through Thursday/".
const localIssuanceDate = (text) => {
  const match = /^\s*\d{3,4} [AP]M [A-Z]{3,4} (Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{1,2}) (\d{4})\s*$/im.exec(text);
  if (!match) return null;
  const time = Date.UTC(+match[4], MONTHS.indexOf(match[2].toLowerCase()), +match[3]);
  return new Date(time).getUTCDay() === WEEKDAYS.indexOf(match[1].toLowerCase()) ? time : null;
};

// Returns [firstDayOffset, lastDayOffset] from the issuance date, or null when
// the heading cannot be read without guessing.
const periodDayRange = (period, issuedDay) => {
  const text = String(period || '').toLowerCase().trim();
  if (!text || /issued|updated/.test(text)) return null;
  const days = /days?\s*(\d)\s*(?:-|through|thru|to)\s*(\d)/.exec(text);
  if (days) return +days[1] <= +days[2] ? [+days[1] - 1, +days[2] - 1] : null;
  if (issuedDay === null) return null;
  const weekday = new Date(issuedDay).getUTCDay();
  const offset = (raw, minimum) => {
    const next = /^next\s+/.test(raw);
    const token = raw.replace(/^(?:next|late|early)\s+/, '');
    if (/^(now|today|tonight|this (?:morning|afternoon|evening)|rest of (?:today|tonight|the day))/.test(token)) return 0;
    if (/^tomorrow/.test(token)) return 1;
    const index = WEEKDAYS.findIndex((day) => token.startsWith(day));
    if (index < 0) return null;
    let value = (index - weekday + 7) % 7;
    // "Wednesday through next Wednesday" ends a week after it starts.
    while (value < minimum || (next && value <= minimum)) value += 7;
    return value;
  };
  const parts = text.replace(/^through\s+/, '').split(/\s+(?:through|thru|to|and|into)\s+|\s*-\s*/);
  const tokens = /^through\s+/.test(text) ? ['now', ...parts] : parts;
  const first = offset(tokens[0], 0);
  let last = tokens.length > 1 ? offset(tokens[tokens.length - 1], first ?? 0) : first;
  if (first === null || last === null) return null;
  // "Today through Wednesday" written on a Wednesday means next Wednesday.
  const isWeekday = (token) => WEEKDAYS.some((day) => token.replace(/^(?:next|late|early)\s+/, '').startsWith(day));
  if (tokens.length > 1 && last === first && isWeekday(tokens[tokens.length - 1]) && !isWeekday(tokens[0])) last += 7;
  return [first, last];
};

const parseDiscussionSections = (text, { selectedDate } = {}) => {
  const issuedDay = localIssuanceDate(text);
  const tripDay = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate || '') ? Date.parse(`${selectedDate}T00:00:00Z`) : NaN;
  const tripDayOffset = issuedDay !== null && Number.isFinite(tripDay) ? Math.round((tripDay - issuedDay) / DAY) : null;
  const sections = [];
  let current = null;
  const close = () => {
    if (current) {
      const body = current.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (body) sections.push({ ...current.meta, text: body.slice(0, SECTION_TEXT_LIMIT) });
    }
    current = null;
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const header = /^\.([A-Z][A-Z0-9 /&,'-]*?)(?:\s*[/(]([^/)\n]*)[/)])?\s*\.{3}(.*)$/.exec(line);
    if (header) {
      close();
      const title = header[1].trim();
      // Periods appear as "/Tonight through Friday/", "(Tonight through Friday)"
      // or "...Now through Friday Night..." depending on the office.
      const bracketed = /^\s*[/(]([^/)\n]*)[/)]\s*(.*)$/.exec(header[3]);
      const dotted = !header[2] && !bracketed ? /^\s*([A-Za-z][A-Za-z ]{2,40}?)\.{3}(.*)$/.exec(header[3]) : null;
      const trailing = bracketed || (dotted && periodDayRange(dotted[1], issuedDay) ? dotted : null);
      const period = (header[2] || trailing?.[1] || '').trim();
      const kind = classify(title);
      const range = kind === 'not_relevant' ? null : periodDayRange(period, issuedDay);
      current = { meta: { title, ...(period && !/issued|updated/i.test(period) ? { period } : {}), kind,
        matchesTrip: range && tripDayOffset !== null ? tripDayOffset >= range[0] && tripDayOffset <= range[1] : null }, lines: [] };
      const rest = (trailing ? trailing[2] : header[3]).trim();
      if (rest) current.lines.push(rest);
    } else if (/^\s*(&&|\$\$)\s*$/.test(line)) close();
    else if (current) current.lines.push(line);
  }
  close();
  return { tripDayOffset, sections };
};

module.exports = { parseDiscussionSections, periodDayRange, localIssuanceDate };
