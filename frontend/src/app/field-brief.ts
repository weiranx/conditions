import type { ActivityType, SafetyData, SummitDecision } from './types';
import type { ParsedGpxRoute } from '../lib/gpx';
import { ACTIVITY_PROFILES } from './activity-profiles';

export interface FieldBriefInput {
  objectiveName: string;
  forecastDate: string;
  startTime: string;
  returnTime: string | null;
  travelWindowHours: number;
  activity: ActivityType;
  safetyData: SafetyData;
  decision: SummitDecision;
  actionLine: string;
  gpxRoute?: ParsedGpxRoute | null;
}

export interface FieldBriefDocument {
  filename: string;
  text: string;
  html: string;
}

function compact(value: string | null | undefined): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clockAtProgress(startTime: string, hours: number, progress: number): string {
  const match = /^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i.exec(startTime.trim());
  if (!match) return 'time unavailable';
  let startHour = Number(match[1]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'AM' && startHour === 12) startHour = 0;
  if (meridiem === 'PM' && startHour < 12) startHour += 12;
  const startMinutes = startHour * 60 + Number(match[2]);
  const etaMinutes = startMinutes + Math.round(hours * 60 * Math.max(0, Math.min(100, progress)) / 100);
  const dayOffset = Math.floor(etaMinutes / (24 * 60));
  const normalized = ((etaMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minute = String(normalized % 60).padStart(2, '0');
  return `${hour}:${minute}${dayOffset > 0 ? ` +${dayOffset}d` : ''}`;
}

function officialLinks(data: SafetyData): Array<{ label: string; url: string }> {
  const avalancheEnabled = data.featureFlags?.avalancheDetails !== false && Boolean(data.avalanche);
  const candidates: Array<{ label: string; url?: string | null }> = [
    { label: 'Official weather forecast', url: data.weather.forecastLink },
    ...(avalancheEnabled ? [{ label: 'Avalanche bulletin', url: data.avalanche?.link }] : []),
    { label: 'Precipitation source', url: data.rainfall?.link },
    ...(data.alerts?.alerts || []).map((alert) => ({ label: alert.event || alert.headline || 'Weather alert', url: alert.link })),
    ...(data.localConditions?.closures?.alerts || []).map((alert) => ({ label: alert.title || 'Access alert', url: alert.url })),
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ label, url }) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ label, url }];
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildFieldBrief(input: FieldBriefInput): FieldBriefDocument {
  const { safetyData, decision } = input;
  const avalancheEnabled = safetyData.featureFlags?.avalancheDetails !== false && Boolean(safetyData.avalanche);
  const score = Math.round(Number(safetyData.safety?.score) || 0);
  const generatedAt = safetyData.generatedAt ? new Date(safetyData.generatedAt).toLocaleString() : 'Unknown';
  const hazards = [...decision.blockers, ...decision.cautions]
    .map(compact)
    .filter(Boolean);
  const triggers = decision.checks
    .filter((check) => !check.ok)
    .map((check) => compact(check.action || check.detail || check.label))
    .filter(Boolean);
  if (triggers.length === 0 && input.actionLine) triggers.push(compact(input.actionLine));

  const verificationItems = [
    safetyData.partialData ? compact(safetyData.apiWarning || 'Some report inputs are missing.') : '',
    avalancheEnabled && safetyData.avalanche?.relevant !== false && safetyData.avalanche?.dangerUnknown
      ? 'Avalanche danger is unknown; verify the current official bulletin before entering avalanche terrain.'
      : '',
    safetyData.alerts?.activeCount
      ? `${safetyData.alerts.activeCount} active weather alert${safetyData.alerts.activeCount === 1 ? '' : 's'} require review.`
      : '',
    safetyData.localConditions?.closures?.alertCount
      ? `${safetyData.localConditions.closures.alertCount} access alert${safetyData.localConditions.closures.alertCount === 1 ? '' : 's'} require review.`
      : '',
  ].filter(Boolean);
  if (verificationItems.length === 0) verificationItems.push('Recheck official forecasts, access, and field observations immediately before departure.');

  const checkpoints = input.gpxRoute?.checkpoints.map((checkpoint) => (
    `${checkpoint.name} · ${checkpoint.distance_miles.toFixed(1)} mi · ETA ${clockAtProgress(input.startTime, input.travelWindowHours, checkpoint.progress_percent)}`
  )) || [];
  const links = officialLinks(safetyData);
  const activityLabel = ACTIVITY_PROFILES[input.activity].label;
  const weatherFacts = [
    ['Conditions', compact(safetyData.weather.description) || 'Not available'],
    ['Temperature', Number.isFinite(safetyData.weather.temp) ? `${Math.round(safetyData.weather.temp)}°F` : 'Not available'],
    ['Feels like', Number.isFinite(safetyData.weather.feelsLike) ? `${Math.round(Number(safetyData.weather.feelsLike))}°F` : 'Not available'],
    ['Wind', `${Math.round(Number(safetyData.weather.windSpeed) || 0)} mph · gusts ${Math.round(Number(safetyData.weather.windGust) || 0)} mph`],
    ['Precipitation', `${Math.round(Number(safetyData.weather.precipChance) || 0)}%`],
    ['Daylight', `${safetyData.solar.sunrise || '—'} sunrise · ${safetyData.solar.sunset || '—'} sunset`],
  ];
  const mountainFacts = [
    ...(avalancheEnabled
      ? [['Avalanche', safetyData.avalanche?.relevant === false ? 'Not applicable to this objective' : compact(safetyData.avalanche?.risk) || 'Unknown — verify bulletin']]
      : []),
    ['Terrain', compact(safetyData.terrainCondition?.label || safetyData.trail) || 'Not available'],
    ['Snowpack', compact(safetyData.snowpack?.summary) || 'No snowpack summary included'],
    ['Weather alerts', safetyData.alerts?.activeCount ? `${safetyData.alerts.activeCount} active` : 'None included'],
    ['Access alerts', safetyData.localConditions?.closures?.alertCount ? `${safetyData.localConditions.closures.alertCount} active` : 'None included'],
  ];
  const planLines = [
    `Objective: ${input.objectiveName || 'Pinned objective'}`,
    `Date: ${input.forecastDate}`,
    `Activity: ${activityLabel}`,
    `Departure: ${input.startTime}`,
    `Turnaround / expected return: ${input.returnTime || 'Set before departure'}`,
    `Travel window: ${input.travelWindowHours}h`,
    `Generated: ${generatedAt}`,
  ];
  const textSections = [
    `${input.objectiveName || 'Backcountry objective'} — FIELD BRIEF`,
    planLines.join('\n'),
    `DECISION\n${decision.level} · ${score}/100\n${compact(decision.headline)}`,
    `DECISIVE HAZARDS\n${(hazards.length ? hazards : ['No modeled blocker; normal mountain hazards still apply.']).map((item) => `- ${item}`).join('\n')}`,
    `TURNAROUND TRIGGERS\n${triggers.map((item) => `- ${item}`).join('\n') || '- Set objective-specific turnaround triggers before departure.'}`,
    `VERIFY BEFORE LEAVING\n${verificationItems.map((item) => `- ${item}`).join('\n')}`,
    `WEATHER SNAPSHOT\n${weatherFacts.map(([label, value]) => `- ${label}: ${value}`).join('\n')}`,
    `MOUNTAIN CONDITIONS\n${mountainFacts.map(([label, value]) => `- ${label}: ${value}`).join('\n')}`,
    checkpoints.length ? `ROUTE CHECKPOINTS\n${checkpoints.map((item) => `- ${item}`).join('\n')}` : '',
    links.length ? `OFFICIAL LINKS\n${links.map((link) => `- ${link.label}: ${link.url}`).join('\n')}` : '',
    'EMERGENCY NOTES\n- Carry an offline route and navigation backup.\n- Leave the plan and expected return with a trusted contact.\n- Carry emergency communication appropriate to the objective.\n- This saved snapshot is not an emergency service or a safety guarantee.',
  ].filter(Boolean);
  const text = textSections.join('\n\n');
  const planFacts = [
    ['Date', input.forecastDate],
    ['Activity', activityLabel],
    ['Departure', input.startTime],
    ['Expected return', input.returnTime || 'Set before departure'],
    ['Travel window', `${input.travelWindowHours} hours`],
    ['Generated', generatedAt],
  ];
  const renderFactGrid = (facts: string[][]) => facts.map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const renderList = (items: string[], fallback: string) => `<ul>${(items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  const decisionTone = decision.level === 'NO-GO' ? 'danger' : decision.level === 'CAUTION' ? 'caution' : 'go';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.objectiveName)} field brief</title>
  <style>
    :root{color-scheme:light;--ink:#172019;--muted:#617067;--line:#d9e1da;--paper:#fff;--wash:#f2f6f2;--brand:#173d2b;--brand2:#315f45;--go:#236641;--caution:#94620f;--danger:#9d3f32}
    *{box-sizing:border-box}html{background:#e9eeea}body{margin:0;color:var(--ink);font:14px/1.52 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    .page{width:min(900px,calc(100% - 32px));margin:32px auto;background:var(--paper);box-shadow:0 24px 70px rgba(25,55,37,.14)}
    .hero{padding:30px 36px 28px;background:var(--brand);color:#fff}.brand{margin:0 0 24px;color:#b9d6c5;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}
    .hero-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:end}.eyebrow{margin:0 0 5px;color:#b9d6c5;font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
    h1{max-width:680px;margin:0;font:500 clamp(30px,6vw,48px)/1.04 Georgia,"Times New Roman",serif;letter-spacing:-.025em}.hero-meta{margin:10px 0 0;color:#dce9df;font-size:13px}
    .score{display:grid;justify-items:center;min-width:96px;padding:14px 16px 12px;border-radius:14px;background:#fff;color:var(--brand)}.score strong{font:600 40px/1 Georgia,"Times New Roman",serif}.score span{margin-top:4px;color:#69776e;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    main{padding:28px 36px 36px}.plan-grid,.fact-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-radius:12px;overflow:hidden}.fact{min-width:0;padding:13px 15px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.fact:nth-child(3n){border-right:0}.fact:nth-last-child(-n+3){border-bottom:0}.fact span{display:block;margin-bottom:3px;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.fact strong{display:block;font-size:13px;line-height:1.35;overflow-wrap:anywhere}
    .decision{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;margin:22px 0;padding:20px;border:1px solid var(--line);border-left:5px solid var(--brand2);border-radius:12px;background:var(--wash)}.decision.go{border-left-color:var(--go)}.decision.caution{border-left-color:var(--caution);background:#fff9eb}.decision.danger{border-left-color:var(--danger);background:#fff3f0}.decision-badge{align-self:start;padding:5px 9px;border-radius:999px;background:var(--brand);color:#fff;font-size:10px;font-weight:850;letter-spacing:.07em;white-space:nowrap}.decision.caution .decision-badge{background:var(--caution)}.decision.danger .decision-badge{background:var(--danger)}.decision h2{margin:0 0 5px;font:600 22px/1.2 Georgia,"Times New Roman",serif}.decision p{margin:0;color:#435249}
    .columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}.card{padding:19px 20px;border:1px solid var(--line);border-radius:12px;background:#fff}.card.tint{background:var(--wash)}.card.verify{border-color:#dfc779;background:#fff9e8}.section-label{margin:0 0 10px;color:var(--brand2);font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.card h2{margin:0 0 12px;font:600 19px/1.2 Georgia,"Times New Roman",serif}.card ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.card li{position:relative;padding-left:16px;color:#3f4d44}.card li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:#73907c}.verify li::before{background:var(--caution)}
    .fact-grid{grid-template-columns:repeat(2,minmax(0,1fr));border-radius:8px}.fact-grid .fact:nth-child(n){border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.fact-grid .fact:nth-child(2n){border-right:0}.fact-grid .fact:nth-last-child(-n+2){border-bottom:0}
    .links a{color:var(--brand2);font-weight:700;text-decoration:none;border-bottom:1px solid #aac0b1}.links a::after{content:" ↗"}.footer{display:flex;justify-content:space-between;gap:20px;padding:18px 36px;border-top:1px solid var(--line);background:var(--wash);color:var(--muted);font-size:11px}.footer strong{color:#33453a}
    @media(max-width:650px){.page{width:100%;margin:0;box-shadow:none}.hero,main,.footer{padding-left:20px;padding-right:20px}.hero-grid{align-items:start}.score{min-width:76px}.score strong{font-size:32px}.plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fact:nth-child(n){border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.fact:nth-child(2n){border-right:0}.fact:nth-last-child(-n+2){border-bottom:0}.columns{grid-template-columns:1fr}.footer{flex-direction:column}}
    @media print{@page{size:auto;margin:12mm}html{background:#fff}body{font-size:10.5pt;print-color-adjust:exact;-webkit-print-color-adjust:exact}.page{width:100%;margin:0;box-shadow:none}.hero{padding:20px 24px}.brand{margin-bottom:14px}h1{font-size:29pt}.score strong{font-size:30pt}main{padding:20px 24px}.card,.decision,.plan-grid{break-inside:avoid}.columns{gap:10px;margin:10px 0}.card{padding:14px 16px}.footer{padding:14px 24px}a{color:inherit}.links a::after{content:""}}
  </style>
</head>
<body>
  <article class="page">
    <header class="hero">
      <p class="brand">Backcountry Conditions · Offline field brief</p>
      <div class="hero-grid">
        <div><p class="eyebrow">${escapeHtml(activityLabel)} · ${escapeHtml(input.forecastDate)}</p><h1>${escapeHtml(input.objectiveName || 'Backcountry objective')}</h1><p class="hero-meta">Departure ${escapeHtml(input.startTime)} · Expected return ${escapeHtml(input.returnTime || 'not set')}</p></div>
        <div class="score"><strong>${score}</strong><span>out of 100</span></div>
      </div>
    </header>
    <main>
      <section class="plan-grid" aria-label="Plan details">${renderFactGrid(planFacts)}</section>
      <section class="decision ${decisionTone}"><span class="decision-badge">${escapeHtml(decision.level.replace('-', ' '))}</span><div><p class="section-label">Decision</p><h2>${escapeHtml(compact(decision.headline))}</h2><p>${escapeHtml(compact(input.actionLine) || 'Reassess the plan against current field conditions before departure.')}</p></div></section>
      <div class="columns">
        <section class="card"><p class="section-label">What can change the decision</p><h2>Decisive hazards</h2>${renderList(hazards, 'No modeled blocker; normal mountain hazards still apply.')}</section>
        <section class="card"><p class="section-label">Pre-committed limits</p><h2>Turnaround triggers</h2>${renderList(triggers, 'Set objective-specific turnaround triggers before departure.')}</section>
      </div>
      <section class="card verify"><p class="section-label">Trailhead check</p><h2>Verify before leaving</h2>${renderList(verificationItems, 'Recheck official sources immediately before departure.')}</section>
      <div class="columns">
        <section class="card tint"><p class="section-label">Selected start time</p><h2>Weather snapshot</h2><div class="fact-grid">${renderFactGrid(weatherFacts)}</div></section>
        <section class="card tint"><p class="section-label">Terrain context</p><h2>Mountain conditions</h2><div class="fact-grid">${renderFactGrid(mountainFacts)}</div></section>
      </div>
      ${checkpoints.length ? `<section class="card"><p class="section-label">Offline route reference</p><h2>Route checkpoints</h2>${renderList(checkpoints, '')}</section>` : ''}
      <div class="columns">
        ${links.length ? `<section class="card links"><p class="section-label">Refresh before departure</p><h2>Official sources</h2><ul>${links.map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`).join('')}</ul></section>` : ''}
        <section class="card"><p class="section-label">If the plan changes</p><h2>Emergency notes</h2>${renderList(['Carry an offline route and navigation backup.', 'Leave the plan and expected return with a trusted contact.', 'Carry emergency communication appropriate to the objective.'], '')}</section>
      </div>
    </main>
    <footer class="footer"><strong>Planning support, not a safety guarantee.</strong><span>Recheck official forecasts, access, ${avalancheEnabled ? 'avalanche information, ' : ''}and current field conditions.</span></footer>
  </article>
</body>
</html>`;
  const filenameBase = (input.objectiveName || 'backcountry-objective').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field-brief';
  return { filename: `${filenameBase}-${input.forecastDate}-field-brief.html`, text, html };
}

export function downloadFieldBrief(document: FieldBriefDocument): void {
  const blob = new Blob([document.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = document.filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
