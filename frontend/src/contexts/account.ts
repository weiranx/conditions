import { createContext } from 'react';
import type { UserPreferences } from '../app/types';

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  preferences: Partial<UserPreferences>;
}

export interface AccountAIUsage {
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  percentUsed: number;
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  exhausted: boolean;
}

export type PreferenceSyncState = 'idle' | 'saving' | 'saved' | 'error';

export interface AccountContextValue {
  available: boolean | null;
  user: AccountUser | null;
  aiUsage: AccountAIUsage | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  preferenceSyncState: PreferenceSyncState;
  preferenceError: string | null;
  createAccount: (input: {
    displayName: string;
    email: string;
    password: string;
    preferences: UserPreferences;
  }) => Promise<AccountUser | null>;
  signIn: (input: { email: string; password: string }) => Promise<AccountUser | null>;
  signOut: () => Promise<AccountUser | null>;
  refreshAccount: () => Promise<AccountUser | null>;
  savePreferences: (preferences: UserPreferences) => Promise<AccountUser>;
}

export const AccountContext = createContext<AccountContextValue | null>(null);
