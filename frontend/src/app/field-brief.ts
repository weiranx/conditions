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
  const candidates: Array<{ label: string; url?: string | null }> = [
    { label: 'Official weather forecast', url: data.weather.forecastLink },
    { label: 'Avalanche bulletin', url: data.avalanche.link },
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
  const score = Math.round(Number(safetyData.safety?.score) || 0);
  const generatedAt = safetyData.generatedAt ? new Date(safetyData.generatedAt).toLocaleString() : 'Unknown';
  const hazards = [...decision.blockers, ...decision.cautions]
    .map(compact)
    .filter(Boolean)
    .slice(0, 3);
  const triggers = decision.checks
    .filter((check) => !check.ok)
    .map((check) => compact(check.action || check.detail || check.label))
    .filter(Boolean)
    .slice(0, 4);
  if (triggers.length === 0 && input.actionLine) triggers.push(compact(input.actionLine));

  const verificationItems = [
    safetyData.partialData ? compact(safetyData.apiWarning || 'Some report inputs are missing.') : '',
    safetyData.avalanche.relevant !== false && safetyData.avalanche.dangerUnknown
      ? 'Avalanche danger is unknown; verify the current official bulletin before entering avalanche terrain.'
      : '',
    safetyData.alerts?.activeCount ? `${safetyData.alerts.activeCount} active weather alert(s) require review.` : '',
    safetyData.localConditions?.closures?.alertCount ? `${safetyData.localConditions.closures.alertCount} access alert(s) require review.` : '',
  ].filter(Boolean);
  if (verificationItems.length === 0) verificationItems.push('Recheck official forecasts, access, and field observations immediately before departure.');

  const checkpoints = input.gpxRoute?.checkpoints.map((checkpoint) => (
    `${checkpoint.name} · ${checkpoint.distance_miles.toFixed(1)} mi · ETA ${clockAtProgress(input.startTime, input.travelWindowHours, checkpoint.progress_percent)}`
  )) || [];
  const links = officialLinks(safetyData);
  const activityLabel = ACTIVITY_PROFILES[input.activity].label;
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
    checkpoints.length ? `ROUTE CHECKPOINTS\n${checkpoints.map((item) => `- ${item}`).join('\n')}` : '',
    links.length ? `OFFICIAL LINKS\n${links.map((link) => `- ${link.label}: ${link.url}`).join('\n')}` : '',
    'EMERGENCY NOTES\n- Carry an offline route and navigation backup.\n- Leave the plan and expected return with a trusted contact.\n- Carry emergency communication appropriate to the objective.\n- This saved snapshot is not an emergency service or a safety guarantee.',
  ].filter(Boolean);
  const text = textSections.join('\n\n');
  const htmlSections = textSections.map((section, index) => {
    const [heading, ...body] = section.split('\n');
    if (index === 0) return `<h1>${escapeHtml(heading)}</h1>`;
    if (heading === 'OFFICIAL LINKS') {
      return `<section><h2>OFFICIAL LINKS</h2><ul>${links.map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`).join('')}</ul></section>`;
    }
    const items = body.filter((line) => line.startsWith('- '));
    const prose = body.filter((line) => !line.startsWith('- '));
    return `<section><h2>${escapeHtml(heading)}</h2>${prose.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${items.length ? `<ul>${items.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join('')}</ul>` : ''}</section>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.objectiveName)} field brief</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#14251d;max-width:760px;margin:0 auto;padding:28px}h1{font-size:28px;border-bottom:4px solid #315f49;padding-bottom:14px}h2{font-size:13px;letter-spacing:.08em;margin:26px 0 8px;color:#315f49}p{margin:4px 0}ul{padding-left:22px}li{margin:6px 0}@media print{body{padding:0}a{color:inherit}}</style></head><body>${htmlSections}</body></html>`;
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
