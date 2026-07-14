import type { PersistedReport } from '../app/report-storage';
import type { AccountReportUsage } from '../contexts/account';
import { parseAccountReportUsage } from '../contexts/report-usage';
import { buildReportSectionHash } from '../app/report-sections';
import { fetchApi, readApiErrorMessage } from './api-client';

export interface SavedReportSummary {
  id: string;
  shareToken: string;
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
    shareToken?: string;
    title?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  reportCount?: unknown;
  reportUsage?: unknown;
}

export interface SavedReportIdentity {
  id: string;
  shareToken: string;
}

export interface ReportComparisonBaseline {
  reportId: string;
  snapshot: PersistedReport;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedSavedReport extends SavedReportIdentity {
  reportCount: number;
  reportUsage: AccountReportUsage;
}

const requireReportIdentity = (payload: unknown): SavedReportIdentity => {
  const response = payload as SavedReportMutationResponse | null;
  const id = response?.report?.id;
  const shareToken = response?.report?.shareToken;
  if (typeof id !== 'string' || !id || typeof shareToken !== 'string' || !shareToken) {
    throw new Error('Report history returned an unexpected response.');
  }
  return { id, shareToken };
};

const requireCreatedSavedReport = (payload: unknown): CreatedSavedReport => {
  const identity = requireReportIdentity(payload);
  const response = payload as SavedReportMutationResponse;
  const reportCount = response.reportCount;
  const reportUsage = parseAccountReportUsage(response.reportUsage);
  if (typeof reportCount !== 'number' || !Number.isSafeInteger(reportCount) || reportCount < 0 || !reportUsage) {
    throw new Error('Report history returned an unexpected response.');
  }
  return { ...identity, reportCount, reportUsage };
};

export function buildSavedReportShareUrl(
  shareToken: string,
  origin = window.location.origin,
  sectionId?: string | null,
): string {
  return `${origin.replace(/\/+$/u, '')}/report/${encodeURIComponent(shareToken)}${buildReportSectionHash(sectionId)}`;
}

export async function createSavedReport(report: PersistedReport): Promise<CreatedSavedReport> {
  const { response, payload } = await fetchApi('/api/account/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not add this generated report to history.'));
  return requireCreatedSavedReport(payload);
}

export async function updateSavedReport(reportId: string, report: PersistedReport): Promise<void> {
  const { response, payload } = await fetchApi(`/api/account/reports/${encodeURIComponent(reportId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not update this generated report.'));
  requireReportIdentity(payload);
}

export async function sendReportEmail(report: PersistedReport, shareToken: string): Promise<string> {
  const { response, payload } = await fetchApi('/api/account/reports/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, shareToken }),
  });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not send this report by email.'));
  const message = (payload as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : 'Report sent to your account email.';
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
      && typeof report.shareToken === 'string'
      && typeof report.title === 'string'
      && typeof report.objectiveName === 'string'
      && typeof report.hasAi === 'boolean'
      && typeof report.createdAt === 'string'
      && typeof report.updatedAt === 'string';
  });
}

export async function getSavedReport(reportId: string, signal?: AbortSignal): Promise<PersistedReport> {
  const { response, payload } = await fetchApi(`/api/account/reports/${encodeURIComponent(reportId)}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not retrieve this generated report.'));
  const snapshot = (payload as { report?: { snapshot?: unknown } } | null)?.report?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('The generated report is incomplete.');
  }
  return snapshot as PersistedReport;
}

export async function getReportComparisonBaseline(
  report: PersistedReport,
  excludeReportId: string,
  signal?: AbortSignal,
): Promise<ReportComparisonBaseline | null> {
  const params = new URLSearchParams({
    lat: String(report.plan.lat),
    lon: String(report.plan.lon),
    forecastDate: report.plan.forecastDate,
    alpineStartTime: report.plan.alpineStartTime,
    excludeReportId,
  });
  const { response, payload } = await fetchApi(`/api/account/reports/comparison-baseline?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not load the previous matching report.'));
  const baseline = (payload as { baseline?: unknown } | null)?.baseline;
  if (baseline === null) return null;
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new Error('Report history returned an unexpected comparison baseline.');
  }
  const parsed = baseline as Partial<ReportComparisonBaseline>;
  if (
    typeof parsed.reportId !== 'string'
    || !parsed.snapshot
    || typeof parsed.createdAt !== 'string'
    || typeof parsed.updatedAt !== 'string'
  ) throw new Error('Report history returned an unexpected comparison baseline.');
  return parsed as ReportComparisonBaseline;
}

export async function getSharedReport(shareToken: string, signal?: AbortSignal): Promise<PersistedReport> {
  const { response, payload } = await fetchApi(`/api/reports/shared/${encodeURIComponent(shareToken)}`, { signal });
  if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Could not retrieve this shared report.'));
  const snapshot = (payload as { report?: { snapshot?: unknown } } | null)?.report?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('The shared report is incomplete.');
  }
  return snapshot as PersistedReport;
}
