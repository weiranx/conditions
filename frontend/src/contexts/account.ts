import { createContext } from 'react';
import type { UserPreferences } from '../app/types';

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  preferences: Partial<UserPreferences>;
}

export type PreferenceSyncState = 'idle' | 'saving' | 'saved' | 'error';

export interface AccountContextValue {
  available: boolean | null;
  user: AccountUser | null;
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
  savePreferences: (preferences: UserPreferences) => Promise<AccountUser>;
}

export const AccountContext = createContext<AccountContextValue | null>(null);
