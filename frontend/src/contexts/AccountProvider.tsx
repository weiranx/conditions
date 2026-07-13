import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UserPreferences } from '../app/types';
import { fetchApi, readApiErrorMessage } from '../lib/api-client';
import {
  AccountContext,
  type AccountAIUsage,
  type AccountContextValue,
  type AccountReportUsage,
  type AccountTier,
  type AccountUser,
  type GoogleAuthConfig,
} from './account';
import { parseAccountReportUsage } from './report-usage';

interface AccountResponse {
  available: boolean;
  authenticated: boolean;
  user: AccountUser | null;
  accountTier: AccountTier | null;
  reportCount: number | null;
  reportUsage: AccountReportUsage | null;
  aiUsage: AccountAIUsage | null;
}

interface AccountState {
  available: boolean | null;
  user: AccountUser | null;
  tier: AccountTier | null;
  reportCount: number | null;
  reportUsage: AccountReportUsage | null;
  aiUsage: AccountAIUsage | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  preferenceSyncState: AccountContextValue['preferenceSyncState'];
  preferenceError: string | null;
  google: GoogleAuthConfig;
}

const LEGACY_FREE_TIER: AccountTier = {
  key: 'free',
  label: 'Free',
  status: 'active',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

function parseGoogleAuthConfig(payload: unknown): Omit<GoogleAuthConfig, 'loading'> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.available !== 'boolean') return null;
  if (!record.available) return { available: false, clientId: null, nonce: null };
  if (typeof record.clientId !== 'string' || typeof record.nonce !== 'string') return null;
  return { available: true, clientId: record.clientId, nonce: record.nonce };
}

function parseAIUsage(value: unknown): AccountAIUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dateFields = ['periodStart', 'periodEnd', 'resetAt'] as const;
  const unlimited = record.unlimited === true;
  if (
    typeof record.usedRequests !== 'number'
    || !Number.isFinite(record.usedRequests)
    || typeof record.usedTokens !== 'number'
    || !Number.isFinite(record.usedTokens)
    || dateFields.some((field) => typeof record[field] !== 'string')
    || typeof record.exhausted !== 'boolean'
    || (record.tierKey !== undefined && record.tierKey !== 'free' && record.tierKey !== 'premium')
    || (record.unlimited !== undefined && typeof record.unlimited !== 'boolean')
    || (unlimited && record.tierKey !== 'premium')
    || (unlimited && (
      record.limitTokens !== null
      || record.remainingTokens !== null
      || record.percentUsed !== null
      || record.exhausted
    ))
    || (!unlimited && [record.limitTokens, record.remainingTokens, record.percentUsed]
      .some((field) => typeof field !== 'number' || !Number.isFinite(field)))
  ) {
    return null;
  }
  const tierKey: AccountAIUsage['tierKey'] = record.tierKey === 'premium' ? 'premium' : 'free';
  const baseUsage = {
    tierKey,
    usedRequests: record.usedRequests as number,
    usedTokens: record.usedTokens as number,
    periodStart: record.periodStart as string,
    periodEnd: record.periodEnd as string,
    resetAt: record.resetAt as string,
  };
  if (unlimited) {
    return {
      ...baseUsage,
      unlimited: true,
      limitTokens: null,
      remainingTokens: null,
      percentUsed: null,
      exhausted: false,
    };
  }
  return {
    ...baseUsage,
    unlimited: false,
    limitTokens: record.limitTokens as number,
    remainingTokens: record.remainingTokens as number,
    percentUsed: record.percentUsed as number,
    exhausted: record.exhausted,
  };
}

function parseAccountTier(value: unknown): AccountTier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (record.key !== 'free' && record.key !== 'premium')
    || record.label !== (record.key === 'premium' ? 'Premium' : 'Free')
    || (record.status !== 'active' && record.status !== 'trialing')
    || (record.currentPeriodEnd !== null && typeof record.currentPeriodEnd !== 'string')
    || typeof record.cancelAtPeriodEnd !== 'boolean'
  ) {
    return null;
  }
  return {
    key: record.key,
    label: record.key === 'premium' ? 'Premium' : 'Free',
    status: record.status,
    currentPeriodEnd: record.currentPeriodEnd,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
  };
}

function parseAccountUser(value: unknown): AccountUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string'
    || typeof record.email !== 'string'
    || typeof record.displayName !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null;
  }
  const preferences = record.preferences && typeof record.preferences === 'object' && !Array.isArray(record.preferences)
    ? record.preferences as Partial<UserPreferences>
    : {};
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    createdAt: record.createdAt,
    preferences,
  };
}

function parseAccountResponse(payload: unknown): AccountResponse | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.available !== 'boolean' || typeof record.authenticated !== 'boolean') return null;
  const user = parseAccountUser(record.user);
  if (record.authenticated && !user) return null;
  const accountTier = parseAccountTier(record.accountTier);
  if (record.authenticated && !accountTier && record.accountTier !== undefined) return null;
  const reportCount = typeof record.reportCount === 'number'
    && Number.isSafeInteger(record.reportCount)
    && record.reportCount >= 0
    ? record.reportCount
    : null;
  if (record.reportCount !== undefined && record.reportCount !== null && reportCount === null) return null;
  return {
    available: record.available,
    authenticated: record.authenticated,
    user,
    accountTier: record.authenticated ? accountTier || LEGACY_FREE_TIER : null,
    reportCount: record.authenticated ? reportCount : null,
    reportUsage: record.authenticated ? parseAccountReportUsage(record.reportUsage) : null,
    aiUsage: parseAIUsage(record.aiUsage),
  };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({
    available: null,
    user: null,
    tier: null,
    reportCount: null,
    reportUsage: null,
    aiUsage: null,
    loading: true,
    busy: false,
    error: null,
    preferenceSyncState: 'idle',
    preferenceError: null,
    google: {
      available: null,
      clientId: null,
      nonce: null,
      loading: true,
    },
  });
  const preferenceSaveChainRef = useRef<Promise<void>>(Promise.resolve());

  const loadGoogleConfig = useCallback(async (signal?: AbortSignal) => {
    setState((current) => ({
      ...current,
      google: { ...current.google, loading: true },
    }));
    try {
      const { response, payload } = await fetchApi('/api/auth/google/config', { signal });
      if (!response.ok) throw new Error('Google sign-in configuration is unavailable.');
      const config = parseGoogleAuthConfig(payload);
      if (!config) throw new Error('Google sign-in configuration is invalid.');
      if (!signal?.aborted) {
        setState((current) => ({ ...current, google: { ...config, loading: false } }));
      }
    } catch {
      if (!signal?.aborted) {
        setState((current) => ({
          ...current,
          google: { available: false, clientId: null, nonce: null, loading: false },
        }));
      }
    }
  }, []);

  const applyResponse = useCallback((payload: unknown) => {
    const account = parseAccountResponse(payload);
    if (!account) throw new Error('The account service returned an unexpected response.');
    setState((current) => ({
      ...current,
      available: account.available,
      user: account.authenticated ? account.user : null,
      tier: account.authenticated ? account.accountTier : null,
      reportCount: account.authenticated ? account.reportCount : null,
      reportUsage: account.authenticated ? account.reportUsage : null,
      aiUsage: account.authenticated ? account.aiUsage : null,
      loading: false,
      busy: false,
      error: null,
      preferenceSyncState: 'idle',
      preferenceError: null,
    }));
    return account.user;
  }, []);

  const fetchAccount = useCallback(async (signal?: AbortSignal) => {
    try {
      const { response, payload } = await fetchApi('/api/auth/session', { signal });
      if (!response.ok) {
        throw new Error(readApiErrorMessage(payload, 'Account status is unavailable.'));
      }
      if (signal?.aborted) return null;
      return applyResponse(payload);
    } catch (error) {
      if (signal?.aborted) return null;
      const message = error instanceof Error ? error.message : 'Account status is unavailable.';
      setState((current) => ({ ...current, loading: false, error: message }));
      throw new Error(message);
    }
  }, [applyResponse]);

  const refreshAccount = useCallback(() => fetchAccount(), [fetchAccount]);

  const syncGeneratedReportUsage = useCallback((
    userId: string,
    reportCount: number,
    reportUsage: AccountReportUsage,
  ) => {
    setState((current) => {
      if (current.user?.id !== userId) return current;
      const currentPeriodStart = current.reportUsage?.periodStart || '';
      const shouldApplyUsage = !current.reportUsage
        || reportUsage.periodStart > currentPeriodStart
        || (
          reportUsage.periodStart === currentPeriodStart
          && reportUsage.usedReports >= current.reportUsage.usedReports
        );
      return {
        ...current,
        reportCount: current.reportCount === null
          ? reportCount
          : Math.max(current.reportCount, reportCount),
        reportUsage: shouldApplyUsage ? reportUsage : current.reportUsage,
      };
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAccount(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchAccount]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGoogleConfig(controller.signal);
    return () => controller.abort();
  }, [loadGoogleConfig]);

  const runAction = useCallback(async (
    path: '/api/auth/register' | '/api/auth/login' | '/api/auth/google' | '/api/auth/logout',
    body?: object,
  ) => {
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const { response, payload } = await fetchApi(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (!response.ok) {
        throw new Error(readApiErrorMessage(payload, 'Account request failed.'));
      }
      return applyResponse(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Account request failed.';
      setState((current) => ({ ...current, busy: false, error: message }));
      throw new Error(message);
    }
  }, [applyResponse]);

  const createAccount = useCallback((input: {
    displayName: string;
    email: string;
    password: string;
    preferences: UserPreferences;
  }) => runAction('/api/auth/register', input), [runAction]);

  const signIn = useCallback((input: { email: string; password: string }) => (
    runAction('/api/auth/login', input)
  ), [runAction]);

  const signInWithGoogle = useCallback(async (input: {
    credential: string;
    preferences: UserPreferences;
  }) => {
    try {
      return await runAction('/api/auth/google', input);
    } catch (error) {
      await loadGoogleConfig();
      throw error;
    }
  }, [loadGoogleConfig, runAction]);

  const signOut = useCallback(() => runAction('/api/auth/logout'), [runAction]);

  const savePreferences = useCallback((preferences: UserPreferences) => {
    const operation = preferenceSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        setState((current) => ({
          ...current,
          preferenceSyncState: 'saving',
          preferenceError: null,
        }));
        try {
          const { response, payload } = await fetchApi('/api/account/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences }),
          });
          if (!response.ok) {
            if (response.status === 401) {
              setState((current) => ({
                ...current,
                user: null,
                tier: null,
                reportCount: null,
                reportUsage: null,
                aiUsage: null,
              }));
            }
            throw new Error(readApiErrorMessage(payload, 'Could not save account preferences.'));
          }
          const account = parseAccountResponse(payload);
          if (!account?.user) throw new Error('The account service returned an unexpected response.');
          setState((current) => ({
            ...current,
            available: account.available,
            user: account.user,
            tier: account.accountTier,
            reportCount: account.reportCount,
            reportUsage: account.reportUsage,
            aiUsage: account.aiUsage,
            preferenceSyncState: 'saved',
            preferenceError: null,
          }));
          return account.user;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not save account preferences.';
          setState((current) => ({
            ...current,
            preferenceSyncState: 'error',
            preferenceError: message,
          }));
          throw new Error(message);
        }
      });
    preferenceSaveChainRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    ...state,
    createAccount,
    signIn,
    signInWithGoogle,
    signOut,
    refreshAccount,
    syncGeneratedReportUsage,
    savePreferences,
  }), [createAccount, refreshAccount, savePreferences, signIn, signInWithGoogle, signOut, state, syncGeneratedReportUsage]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
