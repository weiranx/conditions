import type { PersistedReport, PersistedReportPlan } from '../app/report-storage';
import { fetchApi, readApiErrorMessage } from './api-client';

export interface ObjectiveWatch {
  id: string;
  title: string;
  plan: PersistedReportPlan;
  baselineReport?: PersistedReport;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastChange: {
    checkedAt?: string;
    reasons?: Array<{ key?: string; label?: string }>;
  } | null;
  consecutiveFailures: number;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectiveWatchPolicy {
  tierKey: 'free' | 'premium';
  activeWatchLimit: number;
  automaticChecks: boolean;
  emailAlerts: boolean;
  historyDays: number;
  manualRefreshCooldownMinutes: number;
}

export interface ObjectiveWatchEvent {
  id: string;
  change: {
    checkedAt?: string;
    reasons?: Array<{ key?: string; label?: string }>;
  } | null;
  checkedAt: string | null;
}

export interface ObjectiveWatchResult {
  watch: ObjectiveWatch;
  policy: ObjectiveWatchPolicy;
}

const parseObjectiveWatch = (value: unknown): ObjectiveWatch | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const watch = value as Partial<ObjectiveWatch>;
  if (
    typeof watch.id !== 'string'
    || typeof watch.title !== 'string'
    || !watch.plan
    || typeof watch.plan !== 'object'
    || typeof watch.createdAt !== 'string'
    || typeof watch.updatedAt !== 'string'
  ) return null;
  return watch as ObjectiveWatch;
};

const parseObjectiveWatchPolicy = (value: unknown): ObjectiveWatchPolicy | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Partial<ObjectiveWatchPolicy>;
  if (
    (policy.tierKey !== 'free' && policy.tierKey !== 'premium')
    || !Number.isInteger(policy.activeWatchLimit)
    || Number(policy.activeWatchLimit) < 1
    || typeof policy.automaticChecks !== 'boolean'
    || typeof policy.emailAlerts !== 'boolean'
    || !Number.isInteger(policy.historyDays)
    || Number(policy.historyDays) < 1
    || !Number.isInteger(policy.manualRefreshCooldownMinutes)
    || Number(policy.manualRefreshCooldownMinutes) < 1
  ) return null;
  return policy as ObjectiveWatchPolicy;
};

const requirePolicy = (payload: unknown): ObjectiveWatchPolicy => {
  const policy = parseObjectiveWatchPolicy((payload as { policy?: unknown } | null)?.policy);
  if (!policy) throw new Error('Objective Watch returned an unexpected entitlement policy.');
  return policy;
};

export async function listObjectiveWatches(signal?: AbortSignal): Promise<{ watches: ObjectiveWatch[]; policy: ObjectiveWatchPolicy }> {
  const { response, payload } = await fetchApi('/api/account/objective-watches', { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load objective watches.'));
  const values = (payload as { watches?: unknown } | null)?.watches;
  if (!Array.isArray(values)) throw new Error('Objective watches returned an unexpected response.');
  const watches = values.map(parseObjectiveWatch);
  if (watches.some((watch) => watch === null)) {
    throw new Error('Objective watches returned an unexpected response.');
  }
  return { watches: watches as ObjectiveWatch[], policy: requirePolicy(payload) };
}

export async function getObjectiveWatch(
  plan: PersistedReportPlan,
  signal?: AbortSignal,
): Promise<{ watch: ObjectiveWatch | null; policy: ObjectiveWatchPolicy }> {
  const params = new URLSearchParams({
    lat: String(plan.lat),
    lon: String(plan.lon),
    forecastDate: plan.forecastDate,
    alpineStartTime: plan.alpineStartTime,
    travelWindowHours: String(plan.travelWindowHours),
  });
  const { response, payload } = await fetchApi(`/api/account/objective-watches?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load this objective watch.'));
  const value = (payload as { watch?: unknown } | null)?.watch;
  const policy = requirePolicy(payload);
  if (value === null) return { watch: null, policy };
  const watch = parseObjectiveWatch(value);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return { watch, policy };
}

export async function saveObjectiveWatch(report: PersistedReport): Promise<ObjectiveWatchResult> {
  const { response, payload } = await fetchApi('/api/account/objective-watches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not save this objective watch.'));
  const watch = parseObjectiveWatch((payload as { watch?: unknown } | null)?.watch);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return { watch, policy: requirePolicy(payload) };
}

export async function setObjectiveWatchNotifications(
  watchId: string,
  notificationsEnabled: boolean,
): Promise<ObjectiveWatchResult> {
  const { response, payload } = await fetchApi(`/api/account/objective-watches/${encodeURIComponent(watchId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationsEnabled }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not update Objective Watch alerts.'));
  const watch = parseObjectiveWatch((payload as { watch?: unknown } | null)?.watch);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return { watch, policy: requirePolicy(payload) };
}

export async function refreshObjectiveWatch(watchId: string): Promise<ObjectiveWatchResult> {
  const { response, payload } = await fetchApi(`/api/account/objective-watches/${encodeURIComponent(watchId)}/refresh`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not refresh this objective watch.'));
  const watch = parseObjectiveWatch((payload as { watch?: unknown } | null)?.watch);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return { watch, policy: requirePolicy(payload) };
}

export async function getObjectiveWatchEvents(
  watchId: string,
  signal?: AbortSignal,
): Promise<{ events: ObjectiveWatchEvent[]; policy: ObjectiveWatchPolicy }> {
  const { response, payload } = await fetchApi(`/api/account/objective-watches/${encodeURIComponent(watchId)}/events`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load Objective Watch history.'));
  const values = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(values)) throw new Error('Objective Watch history returned an unexpected response.');
  const events = values.map((value): ObjectiveWatchEvent | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const event = value as Partial<ObjectiveWatchEvent>;
    if (typeof event.id !== 'string' || (event.checkedAt !== null && typeof event.checkedAt !== 'string')) return null;
    return event as ObjectiveWatchEvent;
  });
  if (events.some((event) => event === null)) throw new Error('Objective Watch history returned an unexpected response.');
  return { events: events as ObjectiveWatchEvent[], policy: requirePolicy(payload) };
}

export async function deleteObjectiveWatch(watchId: string): Promise<void> {
  const { response, payload } = await fetchApi(`/api/account/objective-watches/${encodeURIComponent(watchId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not stop watching this objective.'));
}
