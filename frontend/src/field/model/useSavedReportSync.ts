import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SafetyData } from '../../app/types';
import { persistReport, type PersistedReport, type PersistedReportChatMessage } from '../../app/report-storage';
import { createSavedReport, recordReportGeneration, updateSavedReport } from '../../lib/saved-reports';
import type { useAccount } from '../../hooks/useAccount';

type AccountState = { accountLoading: boolean; accountUserId: string | undefined };

// Owns the identity and generation boundary of an account-saved report.
export function useSavedReportSession({ safetyData, accountLoading, accountUserId }: AccountState & { safetyData: SafetyData | null }) {
  const [sessionOwnerId, setSessionOwnerId] = useState(accountUserId);
  const accountResolvedRef = useRef(!accountLoading);
  const [activeSavedReportId, setActiveSavedReportId] = useState<string | null>(
    null,
  );
  const [activeSavedReportShareToken, setActiveSavedReportShareToken] =
    useState<string | null>(null);
  const [reportGenerationPending, setReportGenerationPending] = useState(false);
  const reportGenerationRef = useRef(0);
  const reportSaveIntentRef = useRef<"saving" | "browser-only">("browser-only");
  // Generated reports are metered against the monthly allowance, never stored.
  const reportMeterIntentRef = useRef<"waiting-for-account" | "meter" | "idle">("idle");
  const reportMeterKeyRef = useRef("");
  const reportSaveSourceDataRef = useRef<SafetyData | null>(null);
  const reportSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reportUpdateChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedReportSnapshotRef = useRef("");
  const resetSavedReportTracking = useCallback(() => {
    reportGenerationRef.current += 1;
    reportSaveIntentRef.current = "browser-only";
    reportMeterIntentRef.current = "idle";
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

  // Invalidate pending saves/updates before passive sync effects can run for
  // another user. Initial account hydration may finish a waiting generation.
  useLayoutEffect(() => {
    if (accountLoading) return;
    if (sessionOwnerId !== accountUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Cancel external writes synchronously at an account boundary.
      if (accountResolvedRef.current) resetSavedReportTracking();
      setSessionOwnerId(accountUserId);
    }
    accountResolvedRef.current = true;
  }, [accountLoading, accountUserId, sessionOwnerId, resetSavedReportTracking]);

  // Reports are saved to the account only when the user asks; a new
  // generation invalidates any save still in flight for the previous one.
  const saveReportSnapshot = useCallback(async (
    report: PersistedReport,
    onSaved: (saved: Awaited<ReturnType<typeof createSavedReport>>) => void,
  ) => {
    if (reportSaveIntentRef.current === "saving") return null;
    const generation = reportGenerationRef.current;
    reportSaveIntentRef.current = "saving";
    try {
      const saved = await createSavedReport(report);
      onSaved(saved);
      if (generation !== reportGenerationRef.current) return null;
      lastSavedReportSnapshotRef.current = JSON.stringify(report);
      reportSaveSourceDataRef.current = null;
      reportSaveIntentRef.current = "browser-only";
      setActiveSavedReportId(saved.id);
      setActiveSavedReportShareToken(saved.shareToken);
      return saved;
    } catch (error) {
      if (generation !== reportGenerationRef.current) return null;
      reportSaveIntentRef.current = "browser-only";
      throw error;
    }
  }, []);

  const beginSavedReportGeneration = useCallback(() => {
    const priorSafetyData = safetyData;
    resetSavedReportTracking();
    reportSaveSourceDataRef.current = priorSafetyData;
    setReportGenerationPending(true);
    reportMeterKeyRef.current = crypto.randomUUID();
    reportMeterIntentRef.current = accountLoading
      ? "waiting-for-account"
      : accountUserId
        ? "meter"
        : "idle";
  }, [accountLoading, accountUserId, resetSavedReportTracking, safetyData]);

  useEffect(
    () => () => {
      if (reportSyncTimeoutRef.current)
        clearTimeout(reportSyncTimeoutRef.current);
    },
    [],
  );

  return {
    activeSavedReportId: sessionOwnerId === accountUserId ? activeSavedReportId : null,
    activeSavedReportShareToken: sessionOwnerId === accountUserId ? activeSavedReportShareToken : null,
    reportGenerationPending,
    setReportGenerationPending, resetSavedReportTracking, beginSavedReportGeneration,
    setActiveSavedReportId, setActiveSavedReportShareToken, saveReportSnapshot,
    reportGenerationRef, reportSaveIntentRef, reportSaveSourceDataRef,
    reportMeterIntentRef, reportMeterKeyRef,
    reportSyncTimeoutRef, reportUpdateChainRef, lastSavedReportSnapshotRef,
  };
}

type SyncOptions = AccountState & {
  syncGeneratedReportUsage: ReturnType<typeof useAccount>['syncGeneratedReportUsage'];
  hasObjective: boolean;
  reportSnapshot: PersistedReport | null;
  safetyData: SafetyData | null;
  viewingHistoryReport: boolean;
  setReportChatMessages: Dispatch<SetStateAction<PersistedReportChatMessage[]>>;
  resetRouteState: () => void;
  setReportChatSessionKey: Dispatch<SetStateAction<number>>;
};

// Keeps browser persistence and serialized account updates behind one boundary.
export function useSavedReportSync(session: ReturnType<typeof useSavedReportSession>, {
  hasObjective, reportSnapshot, safetyData, viewingHistoryReport,
  accountLoading, accountUserId, syncGeneratedReportUsage,
  setReportChatMessages, resetRouteState, setReportChatSessionKey,
}: SyncOptions) {
  const {
    activeSavedReportId, reportGenerationPending, setReportGenerationPending,
    reportGenerationRef, reportSaveSourceDataRef, reportMeterIntentRef, reportMeterKeyRef,
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
      reportMeterIntentRef.current === "idle"
    )
      return;
    if (reportMeterIntentRef.current === "waiting-for-account") {
      if (accountLoading) return;
      reportMeterIntentRef.current = accountUserId ? "meter" : "idle";
    }
    if (reportMeterIntentRef.current !== "meter" || !accountUserId) return;

    reportMeterIntentRef.current = "idle";
    void recordReportGeneration(reportMeterKeyRef.current)
      .then(({ reportCount, reportUsage }) => {
        syncGeneratedReportUsage(accountUserId, reportCount, reportUsage);
      })
      .catch(() => {
        // The report stays usable; the allowance is re-checked before the next generation.
      });
  }, [
    accountLoading,
    accountUserId,
    reportGenerationPending,
    reportSnapshot,
    syncGeneratedReportUsage,
    viewingHistoryReport,
    reportMeterIntentRef, reportMeterKeyRef, reportSaveSourceDataRef,
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
