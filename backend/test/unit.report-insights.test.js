const { buildReportInsights } = require('../src/utils/report-insights');
const { sanitizeReportForFeatureFlags } = require('../src/utils/report-feature-filter');
const { deterministicBrief } = require('../src/utils/brief-validation');
const time = '2026-09-16T12:00:00Z';
const station = () => ({ id: 'TEST', name: 'Test station', distanceKm: 4, elevationFt: 5000, readings: { windMph: { value: 22, observedTime: time } } });
const report = () => ({ generatedAt: time, forecast: { selectedDate: '2026-09-16', requestedStartTime: '12:00', selectedStartTime: time }, weather: { windSpeed: 5, windGust: 30, elevation: 5000 }, safety: { score: 90 }, localConditions: { access: { available: true }, closures: { available: true } }, supplementalEvidence: { synoptic: { available: true, stations: [station()] } } });
const find = (d, id) => buildReportInsights(d)?.items.find(i => i.id === id);
test('comparable wind produces qualified review without mutating score or inputs', () => {
 const d=report(), before=JSON.stringify(d), i=find(d,'station-wind');
 expect(i.decisionRelevant).toBe(true); expect(i.meaning).toContain('Local exposure'); expect(i.action).toContain('turnaround'); expect(JSON.stringify(d)).toBe(before);
});
test.each(['future','distance','elevation','missingElevation','missingWind','unknownDeparture','requestedClock'])('%s cannot establish disagreement', scenario => {
 const d=report();
 if(scenario==='future') d.forecast.selectedDate='2026-09-18';
 if(scenario==='distance') d.supplementalEvidence.synoptic.stations[0].distanceKm=30;
 if(scenario==='elevation') d.weather.elevation=9000;
 if(scenario==='missingElevation') d.weather.elevation=null;
 if(scenario==='missingWind') d.weather.windSpeed=null;
 if(scenario==='unknownDeparture') d.forecast={};
 if(scenario==='requestedClock') d.forecast.requestedStartTime='23:00';
 expect(find(d,'station-wind').decisionRelevant).toBe(false);
});
test.each([null,'',false,NaN,-1])('invalid reading %s is not zero',value=>{const d=report();d.supplementalEvidence.synoptic.stations[0].readings.windMph.value=value;expect(find(d,'station-wind')).toBeUndefined();});
test('valid zero is limited agreement, not all clear',()=>{const d=report();d.weather.windSpeed=0;d.supplementalEvidence.synoptic.stations[0].readings.windMph.value=0;expect(find(d,'station-wind').tone).toBe('support');expect(find(d,'station-wind').meaning).toContain('not validation of gusts');});
test.each(['2026-09-16T08:00:00Z','2026-09-16T13:00:00Z','2026-09-16T12:00:00','bad'])('exclude stale, future or ambiguous time %s',observedTime=>{const d=report();d.supplementalEvidence.synoptic.stations[0].readings.windMph.observedTime=observedTime;expect(find(d,'station-wind')).toBeUndefined();});
test('deduplicate NWS and Synoptic station identity',()=>{const d=report();d.localConditions.weatherObservation={available:true,stationId:'test',windMph:10,observedTime:'2026-09-16T11:50:00Z',distanceKm:4,elevationFt:5000};expect(find(d,'station-wind').evidence).toHaveLength(1);expect(find(d,'station-wind').evidence[0].detail).toContain('22 mph');});
test('combine nearby road and park notices without claiming route closure',()=>{const d=report();d.localConditions.access.closedRoadCount=2;d.localConditions.closures.alerts=[{title:'Trail work',url:'https://www.nps.gov/alerts'}];const i=find(d,'access');expect(i.meaning).toContain('2 nearby road closures and 1 land-manager notice');expect(i.meaning).toContain('not been matched');expect(i.evidence).toHaveLength(2);expect(i.decisionRelevant).toBe(true);});
test('empty or missing access never implies an open route',()=>{const d=report();expect(find(d,'access').meaning).toContain('not confirmation');d.localConditions={};expect(find(d,'access')).toBeUndefined();expect(find(d,'evidence-gaps').meaning).toContain('road access');});
test('NBM compares sustained speed, not gusts, and gates time and validity',()=>{const d=report();d.weather.windSpeed=10;d.weather.windGust=60;d.supplementalEvidence.nbm={available:true,issuedTime:time,station:station(),points:[{validTime:time,windMph:{p10:5,p50:12,p90:30}}]};expect(find(d,'wind-range').decisionRelevant).toBe(true);d.supplementalEvidence.nbm.points[0].validTime='2026-09-16T18:00:00Z';expect(find(d,'wind-range').decisionRelevant).toBe(false);d.supplementalEvidence.nbm.points[0].windMph.p10=40;expect(find(d,'wind-range')).toBeUndefined();});
test('only fresh near-departure lightning affects review',()=>{const d=report();d.localConditions.radar={lightning:{available:true,detectionAtObjective:true,productTime:'2026-09-16T08:00:00Z'}};expect(find(d,'lightning').decisionRelevant).toBe(false);d.localConditions.radar.lightning.productTime=time;expect(find(d,'lightning').decisionRelevant).toBe(true);});
test('rising water and forecast rain combine without inferring crossing depth',()=>{const d=report();d.localConditions.streamflow={available:true,trend:'rising',observedTime:time,dischargeCfs:100};d.rainfall={expected:{rainWindowIn:0.3}};expect(find(d,'water').meaning).toContain('Rain is also forecast');expect(find(d,'water').meaning).toContain('not been matched');d.forecast.selectedDate='2026-09-18';expect(find(d,'water').decisionRelevant).toBe(false);});
test('zero smoke does not mean clean air',()=>{const d=report();d.supplementalEvidence.hrrrSmoke={available:true,nearSurfaceUgM3:0,issuedTime:time,validTime:time};expect(find(d,'smoke').meaning).toContain('does not establish clean air');expect(find(d,'smoke').decisionRelevant).toBe(false);});
test('regional negation remains quoted context',()=>{const d=report();d.supplementalEvidence.discussion={available:true,issuedTime:time,text:'.KEY MESSAGES...\n- No thunderstorms expected today.\n&&\n.SHORT TERM...\nWind elsewhere.'};const i=find(d,'forecaster-context');expect(i.tone).toBe('context');expect(i.evidence[0].detail).toContain('No thunderstorms');expect(i.evidence[0].detail).not.toContain('Wind elsewhere');});
test('filtering rebuilds insights and removes client-injected and disabled content',()=>{const d=report();d.localConditions.wildfire={available:true,nearbyIncidentCount:1};d.reportInsights={items:[{title:'Injected'}]};const f=sanitizeReportForFeatureFlags(d,{fieldObservations:false,weatherContextDetails:false,airQualityDetails:false});expect(f.reportInsights?.items||[]).toEqual([]);const g=sanitizeReportForFeatureFlags(d,{fireRiskDetails:false});expect(g.reportInsights.items.some(i=>i.id==='fire-access')).toBe(false);expect(JSON.stringify(g.reportInsights)).not.toContain('Injected');});
test('AI fallback carries access actions while retaining NO-GO',()=>{const d=report();d.localConditions.access.closedRoadCount=1;d.reportInsights=buildReportInsights(d);expect(deterministicBrief(d,'CAUTION')).toContain('Match the road names');expect(deterministicBrief(d,'NO-GO')).toContain('Postpone or change');});
describe('fire-access proximity', () => {
  const withFire = wildfire => { const d = report(); d.localConditions.wildfire = { available: true, ...wildfire }; return d; };
  test('fire near the objective sets the decision and reports distance in miles', () => {
    const i = find(withFire({ nearbyIncidentCount: 2, incidents: [{ name: 'Near Fire', distanceKm: 12 }, { name: 'Far Fire', distanceKm: 120 }] }), 'fire-access');
    expect(i.tone).toBe('caution');
    expect(i.decisionRelevant).toBe(true);
    expect(i.meaning).toContain('1 fire incident and 0 satellite detections were returned within about 19 mi');
    expect(i.meaning).toContain('nearest about 7 mi');
    expect(i.evidence[0].detail).toContain('Near Fire (about 7 mi)');
  });
  test('distant fire and hotspots stay context without changing the decision', () => {
    const i = find(withFire({ nearbyIncidentCount: 1, incidents: [{ name: 'Far Fire', distanceKm: 90, acres: 200 }], firmsDetectionCount: 2, firmsDetections: [{ distanceKm: 60 }, { distanceKm: 140 }] }), 'fire-access');
    expect(i.tone).toBe('context');
    expect(i.decisionRelevant).toBe(false);
    expect(i.meaning).toContain('1 fire incident and 2 satellite detections');
    expect(i.meaning).toContain('none within about 19 mi');
    expect(buildReportInsights(withFire({ incidents: [{ name: 'Far Fire', distanceKm: 90 }] })).summary).not.toContain('Check fire locations');
  });
  test('a large fire counts from its likely edge, not its ignition point', () => {
    // 100,000 acres ≈ 405 km², equal-area radius ≈ 11.4 km, doubled ≈ 22.7 km.
    expect(find(withFire({ incidents: [{ name: 'Big Fire', distanceKm: 50, acres: 100000 }] }), 'fire-access').decisionRelevant).toBe(true);
    expect(find(withFire({ incidents: [{ name: 'Small Fire', distanceKm: 50, acres: 50 }] }), 'fire-access').decisionRelevant).toBe(false);
  });
  test('unknown distances are treated as near', () => {
    expect(find(withFire({ nearbyIncidentCount: 1 }), 'fire-access').decisionRelevant).toBe(true);
    expect(find(withFire({ incidents: [{ name: 'Unplaced', distanceKm: null }] }), 'fire-access').decisionRelevant).toBe(true);
    expect(find(withFire({ firmsDetectionCount: 3 }), 'fire-access').decisionRelevant).toBe(true);
  });
});
