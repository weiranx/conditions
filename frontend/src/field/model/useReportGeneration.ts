import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SafetyData } from '../../app/types';
import { getPastPlannedStart, type PastPlannedStart } from '../../app/planned-start';
import type { UseSafetyDataReturn } from '../../hooks/useSafetyData';

// All explicit generation and shared-plan startup requests pass through these checks.
export function useReportGeneration({
  autoGenerateInitially, hasObjective, forecastDate, alpineStartTime, objectiveTimezone,
  accountLoading, view, position, safetyData, requestNewReportAccess, beginReportGeneration,
  collapseMobilePlanControls, fetchSafetyData, setPreviousSafetyData, setPastStartPrompt,
}: {
  autoGenerateInitially: boolean;
  hasObjective: boolean;
  forecastDate: string;
  alpineStartTime: string;
  objectiveTimezone: string | null;
  accountLoading: boolean;
  view: string;
  position: { lat: number; lng: number };
  safetyData: SafetyData | null;
  requestNewReportAccess: () => boolean;
  beginReportGeneration: () => void;
  collapseMobilePlanControls: () => void;
  fetchSafetyData: UseSafetyDataReturn['fetchSafetyData'];
  setPreviousSafetyData: Dispatch<SetStateAction<SafetyData | null>>;
  setPastStartPrompt: Dispatch<SetStateAction<PastPlannedStart | null>>;
}) {
  const handleRetryFetch = () => {
    if (!hasObjective) {
      return;
    }
    const pastStart = getPastPlannedStart(
      forecastDate,
      alpineStartTime,
      objectiveTimezone,
    );
    if (pastStart) {
      setPastStartPrompt(pastStart);
      return;
    }
    if (!requestNewReportAccess()) {
      return;
    }
    beginReportGeneration();
    setPreviousSafetyData(safetyData);
    fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime, {
      force: true,
      countAsNewReport: true,
    });
  };

  // Fetching a report is an explicit, user-confirmed action rather than an automatic
  // side effect of editing fields — this is the only place (besides Refresh) that
  // triggers a fetch, so a report never regenerates out from under someone mid-edit.
  const handleGenerateReport = () => {
    if (!hasObjective) {
      return;
    }
    const pastStart = getPastPlannedStart(
      forecastDate,
      alpineStartTime,
      objectiveTimezone,
    );
    if (pastStart) {
      setPastStartPrompt(pastStart);
      return;
    }
    if (!requestNewReportAccess()) {
      return;
    }
    beginReportGeneration();
    collapseMobilePlanControls();
    setPreviousSafetyData(null);
    fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime, {
      force: true,
      countAsNewReport: true,
    });
  };

  // Arms a one-shot report fetch when the page loads from a shared link (URL already carries
  // lat/lon), then clears itself so later field edits still require an explicit Generate/Refresh.
  // Home-page selections intentionally do not arm this: users review their plan in the planner
  // and confirm it with Generate Report before any report request is made.
  const [pendingAutoGenerate, setPendingAutoGenerate] = useState(
    autoGenerateInitially,
  );
  useEffect(() => {
    if (
      !pendingAutoGenerate ||
      !hasObjective ||
      view !== "planner" ||
      accountLoading
    ) {
      return;
    }
    // Defer startup until the subscription is committed; cleanup cancels replayed mounts.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPendingAutoGenerate(false);
      const pastStart = getPastPlannedStart(
        forecastDate,
        alpineStartTime,
        objectiveTimezone,
      );
      if (pastStart) {
        setPastStartPrompt(pastStart);
        return;
      }
      if (!requestNewReportAccess()) {
        return;
      }
      beginReportGeneration();
      collapseMobilePlanControls();
      fetchSafetyData(position.lat, position.lng, forecastDate, alpineStartTime, {
        force: true,
        countAsNewReport: true,
      });
    });
    return () => { cancelled = true; };
  }, [
    pendingAutoGenerate,
    hasObjective,
    view,
    accountLoading,
    position,
    forecastDate,
    alpineStartTime,
    objectiveTimezone,
    beginReportGeneration,
    fetchSafetyData,
    collapseMobilePlanControls,
    requestNewReportAccess,
    setPastStartPrompt,
  ]);

  return { handleRetryFetch, handleGenerateReport, pendingAutoGenerate, setPendingAutoGenerate };
}
