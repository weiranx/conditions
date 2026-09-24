const {
  assessItinerary,
  buildItineraryChatContext,
  nearestExit,
  nightState,
} = require('../src/utils/itinerary-assessment');
const { buildPlanContext } = require('../src/utils/plan-context');
const { makeReport } = require('./fixtures/plan-report');

// Future dates keep the fixture forecast fresh for the decision's freshness check.
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = date(0);
const TRAILHEAD = { name: 'Snow Lakes TH', lat: 47.53, lon: -120.71, elevationFt: 1350 };
const CAMP_1 = { name: 'Nada Lake', lat: 47.49, lon: -120.76, elevationFt: 4950 };
const CAMP_2 = { name: 'Upper Enchantments', lat: 47.48, lon: -120.82, elevationFt: 7600 };
const PLAN = { max_gust_mph: '25', max_precip_chance: '60', min_feels_like_f: '5', max_feels_like_f: '95' };

const settledNight = (overrides = {}) => ({
  status: 'ok',
  complete: true,
  missing: [],
  minFeelsLikeF: 38,
  lowTempF: 40,
  peakGustMph: 12,
  peakPrecipChance: 5,
  severity: 'low',
  reasonCodes: [],
  summary: 'The night at camp looks settled: feels like 38°F at the coldest.',
  ...overrides,
});

const stagesFor = ({ startOffset = 1, layoverSecond = false } = {}) => {
  const points = [TRAILHEAD, CAMP_1, layoverSecond ? CAMP_1 : CAMP_2, TRAILHEAD];
  return [0, 1, 2].map((index) => ({
    index,
    date: date(startOffset + index),
    start: '07:00',
    travelHours: 7,
    from: points[index],
    to: points[index + 1],
    layover: layoverSecond && index === 1,
    checkpoints: [],
  }));
};

/** `scenarios[i]` sets day i's weather; null fails that day. `edit` adjusts reports. */
const check = (scenarios, { stages = stagesFor(), edit = () => {}, bailPoints = [] } = {}) => {
  const results = stages.map((stage, index) => {
    const scenario = scenarios[index];
    const report = scenario === null ? null : makeReport({ date: stage.date, start: stage.start, hours: stage.travelHours, scenario });
    if (report && index < stages.length - 1) report.campNight = settledNight();
    if (report) edit(report, index);
    return { index, date: stage.date, report, checkpoints: [] };
  });
  return assessItinerary({ stages, results, planSettings: PLAN, activity: 'backpacking', todayDate: today, bailPoints });
};

test('clear days and settled nights clear the whole trip', () => {
  const assessment = check(['clear', 'clear', 'clear']);
  expect(assessment.level).toBe('GO');
  expect(assessment.weakLink).toBeNull();
  expect(assessment.nights.map((night) => night.state)).toEqual(['settled', 'settled']);
  expect(assessment.headline.title).toBe('Every day is within your limits');
});

test('the worst day sets the verdict and is named, not averaged away', () => {
  const assessment = check(['clear', 'storm', 'clear']);
  expect(assessment.days[1].level).toBe('NO-GO');
  expect(assessment.level).toBe('NO-GO');
  expect([assessment.weakLink.kind, assessment.weakLink.index]).toEqual(['day', 1]);
  expect(assessment.headline.title).toBe('Day 2 limits the trip');
});

test('among days over a limit, the one with more wrong leads and the others are named too', () => {
  const assessment = check(['clear', 'cloudy', 'rain']);
  expect(assessment.level).toBe('CAUTION');
  expect(assessment.weakLink.index).toBe(2);
  expect(assessment.alsoLimiting.map((link) => link.index)).toEqual([1]);
});

test('a day that could not be checked leaves the trip not cleared, and its night unchecked', () => {
  const assessment = check(['clear', null, 'clear']);
  expect(assessment.level).toBe('INCOMPLETE');
  expect(assessment.days[1].level).toBeNull();
  expect(assessment.nights[1].state).toBe('unavailable');
  expect(assessment.headline.title).toBe("Day 2 can't be cleared yet");
});

test('a night past the forecast is not yet forecast, never settled', () => {
  const assessment = check(['clear', 'clear', 'clear'], {
    edit: (report, index) => {
      if (index === 1) report.campNight = { status: 'unavailable', arrivalIso: null, elevationFt: 7600, summary: 'No forecast covers the night at camp yet.' };
    },
  });
  expect(assessment.nights[1].state).toBe('not-forecast');
  expect(assessment.level).toBe('INCOMPLETE');
  expect(assessment.headline.title).toBe("Night 2 can't be cleared yet");
});

test('a serious night calls for caution even when every day is clear; a hard night is named but clears', () => {
  const serious = check(['clear', 'clear', 'clear'], {
    edit: (report, index) => {
      if (index === 0) Object.assign(report.campNight, { severity: 'high', reasonCodes: ['severeWind'], summary: 'A serious night at camp: gusts to 50 mph.' });
    },
  });
  expect(serious.level).toBe('CAUTION');
  expect([serious.weakLink.kind, serious.weakLink.index]).toEqual(['night', 0]);
  expect(serious.headline.reason).toBe('A serious night at camp: gusts to 50 mph.');

  const hard = check(['clear', 'clear', 'clear'], {
    edit: (report, index) => {
      if (index === 1) Object.assign(report.campNight, { severity: 'moderate', reasonCodes: ['coldNight'], minFeelsLikeF: 18, summary: 'A hard night at camp: feels like 18°F at the coldest.' });
    },
  });
  expect(hard.level).toBe('GO');
  expect(hard.headline.reason).toMatch(/^Night 2 is the hardest: A hard night at camp/);
  expect(hard.coldestNightIndex).toBe(1);
});

test('a partly forecast night and a not-yet-issued avalanche forecast are flagged', () => {
  const assessment = check(['clear', 'clear', 'clear'], {
    edit: (report, index) => {
      if (index === 0) report.campNight.complete = false;
      if (index === 2) report.avalanche = { ...report.avalanche, relevant: true, coverageStatus: 'expired_for_selected_start' };
    },
  });
  expect(nightState(assessment.nights[0].data, true)).toBe('incomplete');
  expect(assessment.unresolved).toBe(1);
  expect(assessment.days[2].avalancheNotIssued).toBe(true);
});

test('missing readings in the travel window are counted, never read as clear', () => {
  const assessment = check(['clear', 'clear', 'clear'], {
    edit: (report, index) => {
      if (index === 1) report.weather.trend.slice(0, 2).forEach((hour) => { hour.gust = null; });
    },
  });
  expect(assessment.days[1].incompleteHours).toBe(2);
  expect(assessment.level).toBe('INCOMPLETE');
  expect(assessment.links[0]).toMatchObject({ kind: 'day', index: 1, rank: 5 });
});

test('a high point over a limit sets the day, named as the place', () => {
  const stages = stagesFor();
  stages[1].checkpoints = [{ name: 'Aasgard Pass', lat: 47.48, lon: -120.84, elevationFt: null }];
  const results = stages.map((stage, index) => ({
    index,
    date: stage.date,
    report: makeReport({ date: stage.date, start: stage.start, hours: stage.travelHours, scenario: 'clear' }),
    checkpoints: index === 1 ? [{ name: 'Aasgard Pass', report: makeReport({ date: stage.date, start: stage.start, hours: stage.travelHours, scenario: 'storm' }) }] : [],
  }));
  results.slice(0, 2).forEach((result) => { result.report.campNight = settledNight(); });
  const assessment = assessItinerary({ stages, results, planSettings: PLAN, activity: 'backpacking', todayDate: today });
  expect(assessment.days[1].level).toBe('NO-GO');
  expect(assessment.days[1].limitingPlace).toBe('Aasgard Pass');
  expect(assessment.days[1].checkpoints[0].day.decisionLevel).toBe('NO-GO');
});

test('days five or more out are marked low confidence', () => {
  const assessment = check(['clear', 'clear', 'clear'], { stages: stagesFor({ startOffset: 4 }) });
  expect(assessment.days.map((day) => day.lowConfidence)).toEqual([false, true, true]);
});

test('each night names its nearest way out', () => {
  const assessment = check(['clear', 'clear', 'clear'], { bailPoints: [{ name: 'Stuart Lake TH', lat: 47.52, lon: -120.83, elevationFt: null }] });
  expect(assessment.nights[0].nearestExit.name).toBe('Snow Lakes TH');
  expect(assessment.nights[1].nearestExit.name).toBe('Stuart Lake TH');
  expect(nearestExit(CAMP_1, [TRAILHEAD]).miles).toBeGreaterThan(2);
});

test('the chat context fits the chat limit for the longest trip, and keeps unknowns unknown', () => {
  const points = [TRAILHEAD, CAMP_1, CAMP_2, CAMP_1, CAMP_2, CAMP_1, CAMP_2, TRAILHEAD];
  const stages = Array.from({ length: 7 }, (_, index) => ({
    index,
    date: date(1 + index),
    start: '05:00',
    travelHours: 14,
    from: points[index],
    to: points[index + 1],
    layover: false,
    checkpoints: [{ name: 'Pass', lat: 47.4, lon: -120.8 }, { name: 'Col', lat: 47.41, lon: -120.81 }],
  }));
  const scenarios = ['clear', 'rain', 'snow', 'clear', 'storm', null, 'fog'];
  const results = stages.map((stage, index) => {
    const report = scenarios[index] ? makeReport({ date: stage.date, start: stage.start, hours: 15, scenario: scenarios[index] }) : null;
    if (report && index < 6) report.campNight = settledNight();
    return { index, date: stage.date, report, checkpoints: report ? [{ name: 'Pass', report }, { name: 'Col', report }] : [] };
  });
  const assessment = assessItinerary({ stages, results, planSettings: PLAN, activity: 'backpacking', todayDate: today });
  const context = buildItineraryChatContext({
    name: 'Long loop', checkedAt: new Date().toISOString(), startDate: stages[0].date, stages, assessment,
    context: buildPlanContext({ ...PLAN, activity: 'backpacking' }),
  });
  expect(JSON.stringify(context).length).toBeLessThan(120000);
  expect(context.days[5].decision).toBe('NOT CHECKED');
  expect(context.nights[5].state).toBe('NOT CHECKED');
  expect(context.verdict.level).toBe('NO-GO');
  expect(context.limits.maxWindGustMph).toBe(25);
  expect(context.days[0].hourlyTravelWindow.length).toBeGreaterThanOrEqual(14);
});
