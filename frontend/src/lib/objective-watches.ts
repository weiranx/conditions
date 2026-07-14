import type { PersistedReport, PersistedReportPlan } from '../app/report-storage';
import { fetchApi, readApiErrorMessage } from './api-client';

export interface ObjectiveWatch {
  id: string;
  title: string;
  plan: PersistedReportPlan;
  baselineReport?: PersistedReport;
  createdAt: string;
  updatedAt: string;
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

export async function getObjectiveWatch(lat: number, lon: number, signal?: AbortSignal): Promise<ObjectiveWatch | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const { response, payload } = await fetchApi(`/api/account/objective-watches?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load this objective watch.'));
  const value = (payload as { watch?: unknown } | null)?.watch;
  if (value === null) return null;
  const watch = parseObjectiveWatch(value);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return watch;
}

export async function saveObjectiveWatch(report: PersistedReport): Promise<ObjectiveWatch> {
  const { response, payload } = await fetchApi('/api/account/objective-watches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not save this objective watch.'));
  const watch = parseObjectiveWatch((payload as { watch?: unknown } | null)?.watch);
  if (!watch) throw new Error('Objective watches returned an unexpected response.');
  return watch;
}

export async function deleteObjectiveWatch(watchId: string): Promise<void> {
  const { response, payload } = await fetchApi(`/api/account/objective-watches/${encodeURIComponent(watchId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not stop watching this objective.'));
}
