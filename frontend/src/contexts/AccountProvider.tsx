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
  type AccountUser,
} from './account';

interface AccountResponse {
  available: boolean;
  authenticated: boolean;
  user: AccountUser | null;
  aiUsage: AccountAIUsage | null;
}

interface AccountState {
  available: boolean | null;
  user: AccountUser | null;
  aiUsage: AccountAIUsage | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  preferenceSyncState: AccountContextValue['preferenceSyncState'];
  preferenceError: string | null;
}

function parseAIUsage(value: unknown): AccountAIUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numberFields = ['usedTokens', 'limitTokens', 'remainingTokens', 'percentUsed'] as const;
  const dateFields = ['periodStart', 'periodEnd', 'resetAt'] as const;
  if (
    numberFields.some((field) => typeof record[field] !== 'number' || !Number.isFinite(record[field]))
    || dateFields.some((field) => typeof record[field] !== 'string')
    || typeof record.exhausted !== 'boolean'
  ) {
    return null;
  }
  return {
    usedTokens: record.usedTokens as number,
    limitTokens: record.limitTokens as number,
    remainingTokens: record.remainingTokens as number,
    percentUsed: record.percentUsed as number,
    periodStart: record.periodStart as string,
    periodEnd: record.periodEnd as string,
    resetAt: record.resetAt as string,
    exhausted: record.exhausted,
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
  return {
    available: record.available,
    authenticated: record.authenticated,
    user,
    aiUsage: parseAIUsage(record.aiUsage),
  };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({
    available: null,
    user: null,
    aiUsage: null,
    loading: true,
    busy: false,
    error: null,
    preferenceSyncState: 'idle',
    preferenceError: null,
  });
  const preferenceSaveChainRef = useRef<Promise<void>>(Promise.resolve());

  const applyResponse = useCallback((payload: unknown) => {
    const account = parseAccountResponse(payload);
    if (!account) throw new Error('The account service returned an unexpected response.');
    setState((current) => ({
      ...current,
      available: account.available,
      user: account.authenticated ? account.user : null,
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

  useEffect(() => {
    const controller = new AbortController();
    void fetchAccount(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchAccount]);

  const runAction = useCallback(async (
    path: '/api/auth/register' | '/api/auth/login' | '/api/auth/logout',
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
              setState((current) => ({ ...current, user: null, aiUsage: null }));
            }
            throw new Error(readApiErrorMessage(payload, 'Could not save account preferences.'));
          }
          const account = parseAccountResponse(payload);
          if (!account?.user) throw new Error('The account service returned an unexpected response.');
          setState((current) => ({
            ...current,
            available: account.available,
            user: account.user,
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
    signOut,
    refreshAccount,
    savePreferences,
  }), [createAccount, refreshAccount, savePreferences, signIn, signOut, state]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
