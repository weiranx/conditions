const { activityProfile, normalizeActivity } = require('./activity-profiles');

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const round = (value, digits = 0) => Number(value.toFixed(digits));

// Checks that only matter for some activities: wet rock for a scramble, the
// overnight refreeze for a snow climb. Like the other report insights they
// interpret existing evidence and add no score penalty. `add` has the
// buildReportInsights signature, so feature gating stays in one place.
function addActivityInsights(report, add, evidence) {
  const activity = normalizeActivity(report.forecast?.activity);
  const label = activityProfile(activity).label;
  const is = (...keys) => keys.includes(activity);
  const weather = report.weather || {};
  const elevation = number(weather.elevation);
  const atElevation = elevation !== null ? ` at the forecast point (${Math.round(elevation)} ft)` : ' at the forecast point';

  if (is('scrambling', 'alpine-climbing')) {
    const rainfall = report.rainfall || {};
    const past24 = number(rainfall.totals?.rainPast24hIn);
    const past48 = number(rainfall.totals?.rainPast48hIn);
    const during = number(rainfall.expected?.rainWindowIn);
    // Projected totals end at the planned start; observed totals end now.
    const beforeStart = rainfall.mode === 'projected_for_selected_start';
    const recentWet = (past24 !== null && past24 >= 0.1) || (past48 !== null && past48 >= 0.25);
    const wetDuring = during !== null && during >= 0.05;
    if (recentWet || wetDuring) {
      const parts = [];
      if (past24 !== null && past24 > 0) parts.push(`${round(past24, 2)} in in the 24 h ${beforeStart ? 'before the start' : 'up to now'}`);
      if (past48 !== null && past48 > 0 && !(past24 !== null && past48 <= past24)) parts.push(`${round(past48, 2)} in over 48 h`);
      if (wetDuring) parts.push(`${round(during, 2)} in forecast during the travel window`);
      add('wet-rock', 'caution', 'Rock may be wet on the hands-on sections',
        `Rain totals of ${parts.join(', ')} mean slabs, lichen and shaded rock can stay slick well after the rain stops. ${beforeStart || wetDuring ? '' : 'These are recent observations, not a forecast for your start; recheck closer to the day. '}The report cannot see how fast your route dries.`,
        'Plan extra time on the scrambling or climbing, favor sunny, fast-drying aspects, and set a turnaround if holds are wet.',
        [evidence(rainfall.source || 'Precipitation history', parts.join('; '), rainfall.anchorTime || null, rainfall.link)], [], wetDuring || beforeStart);
    }
  }

  if (is('scrambling', 'alpine-climbing', 'mountaineering')) {
    const thunderProbability = number(report.atmosphere?.thunderProbability);
    const thunderText = /thunder|t-storm|tstorm/i.test(String(weather.description || ''));
    if (thunderText || (thunderProbability !== null && thunderProbability >= 15)) {
      const detail = [thunderProbability !== null ? `Thunder probability ${Math.round(thunderProbability)}%` : null, thunderText ? `Forecast: "${weather.description}"` : null].filter(Boolean).join('; ');
      add('exposed-lightning', 'caution', 'Be off exposed terrain before storms build',
        `${label} keeps you on ridges and summits where you cannot quickly get low. The forecast carries a thunderstorm signal for the planned window.`,
        'Set a summit or high-point turnaround well before the storm window, identify where you can descend quickly, and turn back at the first thunder.',
        [evidence(thunderProbability !== null ? 'NOAA gridpoint' : 'Forecast text', detail, weather.issuedTime || null, weather.forecastLink)],
        thunderText ? [] : ['weatherContextDetails'], true);
    }
  }

  if (is('snow-climbing', 'mountaineering', 'ski-touring')) {
    const overnightLow = number(weather.temperatureContext24h?.overnightLowF);
    const freezingLevel = number(report.atmosphere?.freezingLevelFt);
    if (overnightLow !== null && overnightLow > 28) {
      const noRefreeze = overnightLow > 32;
      const freezingNote = freezingLevel !== null && elevation !== null && freezingLevel > elevation
        ? ` The freezing level (${Math.round(freezingLevel)} ft) also sits above the objective.`
        : '';
      add('refreeze', noRefreeze ? 'caution' : 'context', noRefreeze ? 'The snow may not refreeze overnight' : 'The overnight refreeze looks marginal',
        `The overnight low is ${Math.round(overnightLow)}°F${atElevation}.${freezingNote} ${noRefreeze ? 'Without a hard freeze, snow softens early, wet slides and cornice falls become more likely, and step-kicking or skinning gets harder.' : 'A shallow freeze gives a shorter window of firm snow after sunrise.'} Shaded and higher slopes can freeze harder than this point forecast.`,
        noRefreeze
          ? 'Start earlier, favor shaded or higher aspects, and set a firm turnaround for when the surface turns to slush.'
          : 'Plan to be on sun-exposed slopes early, and turn back if the crust breaks or the snow gets wet.',
        [evidence(weather.sourceDetails?.primary || 'Point forecast', `Overnight low ${Math.round(overnightLow)}°F${freezingLevel !== null ? `; freezing level ${Math.round(freezingLevel)} ft` : ''}`, weather.issuedTime || null, weather.forecastLink)],
        [], noRefreeze);
    }
  }

  if (is('ski-touring')) {
    const snow24 = number(report.rainfall?.totals?.snowPast24hIn);
    const snowDuring = number(report.rainfall?.expected?.snowWindowIn);
    const loaded = (snow24 !== null && snow24 >= 6) || (snowDuring !== null && snowDuring >= 6);
    if (loaded) {
      const detail = [snow24 !== null && snow24 > 0 ? `${round(snow24, 1)} in in the last 24 h` : null, snowDuring !== null && snowDuring > 0 ? `${round(snowDuring, 1)} in forecast during the tour` : null].filter(Boolean).join('; ');
      add('fresh-load', 'caution', 'New snow is loading the slopes you plan to ski',
        `The report shows ${detail}. Fresh load, especially with wind, is when new slabs are most sensitive. Match this against the avalanche forecast's storm and wind slab problems.`,
        'Keep to lower-angle terrain away from steeper slopes above you until the new snow has settled, and watch for cracking and recent slides.',
        [evidence(report.rainfall?.source || 'Precipitation', detail, report.rainfall?.anchorTime || null, report.rainfall?.link)], ['avalancheDetails'], true);
    }
  }

  if (is('trail-running')) {
    const heat = report.heatRisk;
    const heatLevel = number(heat?.level);
    if (heatLevel !== null && heatLevel >= 2) {
      add('runner-heat', 'caution', 'Heat will limit a running pace',
        `Heat risk is ${heat.label || `level ${heatLevel}`} for the window. Running makes several times more heat than hiking, so heat illness can set in well below the temperatures a hiker tolerates.`,
        'Start earlier, carry more water or plan refills, slow down in the warmest hours, and know where you can shorten the route.',
        [evidence(heat.source || 'Heat risk', `${heat.label || `Level ${heatLevel}`}`, heat.generatedTime || null)], ['heatRiskDetails'], true);
    }
    const aqi = number(report.airQuality?.usAqi);
    if (aqi !== null && aqi >= 51) {
      const unhealthy = aqi >= 101;
      add('runner-air', unhealthy ? 'caution' : 'context', unhealthy ? 'Air quality is poor for hard breathing' : 'Air quality is moderate for a long run',
        `AQI is ${Math.round(aqi)} (${report.airQuality.category || 'category unavailable'}). Running for hours moves far more air through your lungs than walking, so exposure adds up faster.`,
        unhealthy
          ? 'Consider an easier effort, a shorter run, or a day with cleaner air; recheck current monitoring before you start.'
          : 'If you are sensitive to air quality, keep the effort easy and recheck current monitoring before you start.',
        [evidence(report.airQuality.source || 'Air quality', `AQI ${Math.round(aqi)}; ${report.airQuality.dataType || 'type unspecified'}`, report.airQuality.validTime || report.airQuality.measuredTime || null)],
        ['airQualityDetails'], unhealthy);
    }
  }
}

module.exports = { addActivityInsights };
