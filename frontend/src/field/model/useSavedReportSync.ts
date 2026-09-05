import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SafetyData } from '../../app/types';
import { persistReport, type PersistedReport, type PersistedReportChatMessage } from '../../app/report-storage';
import { createSavedReport, updateSavedReport } from '../../lib/saved-reports';
import type { useAccount } from '../../hooks/useAccount';

type AccountState = { accountLoading: boolean; accountUserId: string | undefined };

// Owns the identity and generation boundary of an account-saved report.
export function useSavedReportSession({ safetyData, accountLoading, accountUserId }: AccountState & { safetyData: SafetyData | null }) {
  const [activeSavedReportId, setActiveSavedReportId] = useState<string | null>(
    null,
  );
  const [activeSavedReportShareToken, setActiveSavedReportShareToken] =
    useState<string | null>(null);
  const [reportGenerationPending, setReportGenerationPending] = useState(false);
  const reportGenerationRef = useRef(0);
  const reportSaveIntentRef = useRef<
    "waiting-for-account" | "save" | "saving" | "browser-only"
  >("browser-only");
  const reportSaveSourceDataRef = useRef<SafetyData | null>(null);
  const reportSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reportUpdateChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedReportSnapshotRef = useRef("");
  const resetSavedReportTracking = useCallback(() => {
    reportGenerationRef.current += 1;
    reportSaveIntentRef.current = "browser-only";
    reportSaveSourceDataRef.current = null;
    lastSavedReportSnapshotRef.current = "";
    setReportGenerationPending(false);
    setActiveSavedReportId(null);
    setActiveSavedReportShareToken(null);
    if (reportSyncTimeoutRef.current) {
      clearTimeout(reportSyncTimeoutRef.current);
      reportSyncTimeoutRef.current = null;
    }
  }, []);

  const beginSavedReportGeneration = useCallback(() => {
    const priorSafetyData = safetyData;
    resetSavedReportTracking();
    reportSaveSourceDataRef.current = priorSafetyData;
    setReportGenerationPending(true);
    reportSaveIntentRef.current = accountLoading
      ? "waiting-for-account"
      : accountUserId
        ? "save"
        : "browser-only";
  }, [accountLoading, accountUserId, resetSavedReportTracking, safetyData]);

  useEffect(
    () => () => {
      if (reportSyncTimeoutRef.current)
        clearTimeout(reportSyncTimeoutRef.current);
    },
    [],
  );

  return {
    activeSavedReportId, activeSavedReportShareToken, reportGenerationPending,
    setReportGenerationPending, resetSavedReportTracking, beginSavedReportGeneration,
    setActiveSavedReportId, setActiveSavedReportShareToken,
    reportGenerationRef, reportSaveIntentRef, reportSaveSourceDataRef,
    reportSyncTimeoutRef, reportUpdateChainRef, lastSavedReportSnapshotRef,
  };
}

type SyncOptions = AccountState & {
  hasObjective: boolean;
  reportSnapshot: PersistedReport | null;
  safetyData: SafetyData | null;
  viewingHistoryReport: boolean;
  reportHistoryEnabled: boolean;
  syncGeneratedReportUsage: ReturnType<typeof useAccount>['syncGeneratedReportUsage'];
  setReportChatMessages: Dispatch<SetStateAction<PersistedReportChatMessage[]>>;
  resetRouteState: () => void;
  setReportChatSessionKey: Dispatch<SetStateAction<number>>;
};

// Keeps browser persistence and serialized account updates behind one boundary.
export function useSavedReportSync(session: ReturnType<typeof useSavedReportSession>, {
  hasObjective, reportSnapshot, safetyData, viewingHistoryReport,
  accountLoading, accountUserId, reportHistoryEnabled, syncGeneratedReportUsage,
  setReportChatMessages, resetRouteState, setReportChatSessionKey,
}: SyncOptions) {
  const {
    activeSavedReportId, reportGenerationPending, setReportGenerationPending,
    setActiveSavedReportId, setActiveSavedReportShareToken,
    reportGenerationRef, reportSaveIntentRef, reportSaveSourceDataRef,
    reportSyncTimeoutRef, reportUpdateChainRef, lastSavedReportSnapshotRef,
  } = session;
  useEffect(() => {
    if (
      !reportGenerationPending ||
      !safetyData ||
      safetyData === reportSaveSourceDataRef.current
    )
      return;
    setReportChatMessages([]);
    resetRouteState();
    setReportGenerationPending(false);
    setReportChatSessionKey((value) => value + 1);
  }, [reportGenerationPending, resetRouteState, safetyData, reportSaveSourceDataRef, setReportChatMessages, setReportChatSessionKey, setReportGenerationPending]);

  useEffect(() => {
    if (!hasObjective || !reportSnapshot || reportGenerationPending) return;
    persistReport(
      reportSnapshot.plan,
      reportSnapshot.safetyData,
      reportSnapshot.ai,
      {
        preferences: reportSnapshot.preferences,
        route: reportSnapshot.route,
      },
    );
  }, [hasObjective, reportGenerationPending, reportSnapshot]);

  useEffect(() => {
    if (
      !reportSnapshot ||
      reportGenerationPending ||
      reportSnapshot.safetyData === reportSaveSourceDataRef.current ||
      viewingHistoryReport ||
      reportSaveIntentRef.current === "browser-only"
    )
      return;
    if (reportSaveIntentRef.current === "waiting-for-account") {
      if (accountLoading) return;
      reportSaveIntentRef.current = accountUserId ? "save" : "browser-only";
    }
    if (
      reportSaveIntentRef.current !== "save" ||
      !accountUserId ||
      !reportHistoryEnabled
    )
      return;

    reportSaveIntentRef.current = "saving";
    const generation = reportGenerationRef.current;
    const serialized = JSON.stringify(reportSnapshot);
    void createSavedReport(reportSnapshot)
      .then(({ id: reportId, shareToken, reportCount, reportUsage }) => {
        syncGeneratedReportUsage(accountUserId, reportCount, reportUsage);
        if (generation !== reportGenerationRef.current) return;
        lastSavedReportSnapshotRef.current = serialized;
        reportSaveSourceDataRef.current = null;
        reportSaveIntentRef.current = "browser-only";
        setActiveSavedReportId(reportId);
        setActiveSavedReportShareToken(shareToken);
      })
      .catch(() => {
        if (generation !== reportGenerationRef.current) return;
        reportSaveIntentRef.current = "browser-only";
      });
  }, [
    accountLoading,
    accountUserId,
    reportHistoryEnabled,
    reportGenerationPending,
    reportSnapshot,
    syncGeneratedReportUsage,
    viewingHistoryReport,
    lastSavedReportSnapshotRef, reportGenerationRef, reportSaveIntentRef, reportSaveSourceDataRef,
    setActiveSavedReportId, setActiveSavedReportShareToken,
  ]);

  useEffect(() => {
    if (
      !activeSavedReportId ||
      !accountUserId ||
      !reportSnapshot ||
      viewingHistoryReport
    )
      return;
    const serialized = JSON.stringify(reportSnapshot);
    if (serialized === lastSavedReportSnapshotRef.current) return;
    if (reportSyncTimeoutRef.current)
      clearTimeout(reportSyncTimeoutRef.current);
    const generation = reportGenerationRef.current;
    reportSyncTimeoutRef.current = setTimeout(() => {
      reportSyncTimeoutRef.current = null;
      const update = reportUpdateChainRef.current.then(async () => {
        if (generation !== reportGenerationRef.current) return;
        await updateSavedReport(activeSavedReportId, reportSnapshot);
        if (generation === reportGenerationRef.current) {
          lastSavedReportSnapshotRef.current = serialized;
        }
      });
      reportUpdateChainRef.current = update.catch(() => {
        // The in-memory and browser snapshots remain available if account sync is offline.
      });
    }, 400);
    return () => {
      if (reportSyncTimeoutRef.current) {
        clearTimeout(reportSyncTimeoutRef.current);
        reportSyncTimeoutRef.current = null;
      }
    };
  }, [
    accountUserId,
    activeSavedReportId,
    reportSnapshot,
    viewingHistoryReport,
    lastSavedReportSnapshotRef, reportGenerationRef, reportSyncTimeoutRef, reportUpdateChainRef,
  ]);

}
