import type { PersistedReport } from '../app/report-storage';
import { fetchApi, readApiErrorMessage } from './api-client';

export interface SavedReportSummary {
  id: string;
  title: string;
  objectiveName: string;
  forecastDate: string | null;
  alpineStartTime: string | null;
  score: number | null;
  hasAi: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SavedReportMutationResponse {
  report?: {
    id?: string;
    title?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

const requireReportId = (payload: unknown) => {
  const response = payload as SavedReportMutationResponse | null;
  const id = response?.report?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('Report history returned an unexpected response.');
  }
  return id;
};

export async function createSavedReport(report: PersistedReport): Promise<string> {
  const { response, payload } = await fetchApi('/api/account/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not save this report.'));
  return requireReportId(payload);
}

export async function updateSavedReport(reportId: string, report: PersistedReport): Promise<void> {
  const { response, payload } = await fetchApi(`/api/account/reports/${encodeURIComponent(reportId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not update this saved report.'));
  requireReportId(payload);
}

export async function listSavedReports(signal?: AbortSignal): Promise<SavedReportSummary[]> {
  const { response, payload } = await fetchApi('/api/account/reports', { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load report history.'));
  const reports = (payload as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(reports)) throw new Error('Report history returned an unexpected response.');
  return reports.filter((value): value is SavedReportSummary => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const report = value as Partial<SavedReportSummary>;
    return typeof report.id === 'string'
      && typeof report.title === 'string'
      && typeof report.objectiveName === 'string'
      && typeof report.hasAi === 'boolean'
      && typeof report.createdAt === 'string'
      && typeof report.updatedAt === 'string';
  });
}

export async function getSavedReport(reportId: string, signal?: AbortSignal): Promise<PersistedReport> {
  const { response, payload } = await fetchApi(`/api/account/reports/${encodeURIComponent(reportId)}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not retrieve this saved report.'));
  const snapshot = (payload as { report?: { snapshot?: unknown } } | null)?.report?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('The saved report is incomplete.');
  }
  return snapshot as PersistedReport;
}
