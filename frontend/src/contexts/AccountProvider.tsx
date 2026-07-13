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
  type AccountContextValue,
  type AccountUser,
} from './account';

interface AccountResponse {
  available: boolean;
  authenticated: boolean;
  user: AccountUser | null;
}

interface AccountState {
  available: boolean | null;
  user: AccountUser | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  preferenceSyncState: AccountContextValue['preferenceSyncState'];
  preferenceError: string | null;
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
  return { available: record.available, authenticated: record.authenticated, user };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({
    available: null,
    user: null,
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
      loading: false,
      busy: false,
      error: null,
      preferenceSyncState: 'idle',
      preferenceError: null,
    }));
    return account.user;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { response, payload } = await fetchApi('/api/auth/session', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(readApiErrorMessage(payload, 'Account status is unavailable.'));
        }
        if (!controller.signal.aborted) applyResponse(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Account status is unavailable.',
        }));
      }
    })();
    return () => controller.abort();
  }, [applyResponse]);

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
              setState((current) => ({ ...current, user: null }));
            }
            throw new Error(readApiErrorMessage(payload, 'Could not save account preferences.'));
          }
          const account = parseAccountResponse(payload);
          if (!account?.user) throw new Error('The account service returned an unexpected response.');
          setState((current) => ({
            ...current,
            available: account.available,
            user: account.user,
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
    savePreferences,
  }), [createAccount, savePreferences, signIn, signOut, state]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
