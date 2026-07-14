import { createContext } from 'react';
import type { UserPreferences } from '../app/types';

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerified: boolean;
  preferences: Partial<UserPreferences>;
}

export type AccountTierKey = 'free' | 'premium';

export interface AccountTier {
  key: AccountTierKey;
  label: 'Free' | 'Premium';
  status: 'active' | 'trialing';
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface AccountAIUsageBase {
  tierKey: AccountTierKey;
  usedRequests: number;
  usedTokens: number;
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  exhausted: boolean;
}

export type AccountAIUsage = AccountAIUsageBase & (
  | {
    unlimited: true;
    limitTokens: null;
    remainingTokens: null;
    percentUsed: null;
    exhausted: false;
  }
  | {
    unlimited: false;
    limitTokens: number;
    remainingTokens: number;
    percentUsed: number;
  }
);

interface AccountReportUsageBase {
  tierKey: AccountTierKey;
  usedReports: number;
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  exhausted: boolean;
}

export type AccountReportUsage = AccountReportUsageBase & (
  | {
    unlimited: true;
    limitReports: null;
    remainingReports: null;
    percentUsed: null;
    exhausted: false;
  }
  | {
    unlimited: false;
    limitReports: number;
    remainingReports: number;
    percentUsed: number;
  }
);

export type PreferenceSyncState = 'idle' | 'saving' | 'saved' | 'error';

export interface GoogleAuthConfig {
  available: boolean | null;
  clientId: string | null;
  nonce: string | null;
  loading: boolean;
}

export interface AccountContextValue {
  available: boolean | null;
  user: AccountUser | null;
  tier: AccountTier | null;
  reportCount: number | null;
  reportUsage: AccountReportUsage | null;
  aiUsage: AccountAIUsage | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  preferenceSyncState: PreferenceSyncState;
  preferenceError: string | null;
  google: GoogleAuthConfig;
  createAccount: (input: {
    displayName: string;
    email: string;
    password: string;
    preferences: UserPreferences;
  }) => Promise<AccountUser | null>;
  signIn: (input: { email: string; password: string }) => Promise<AccountUser | null>;
  signInWithGoogle: (input: {
    credential: string;
    preferences: UserPreferences;
  }) => Promise<AccountUser | null>;
  signOut: () => Promise<AccountUser | null>;
  refreshAccount: () => Promise<AccountUser | null>;
  resendVerification: () => Promise<string>;
  verifyEmail: (token: string) => Promise<string>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (input: { token: string; password: string }) => Promise<string>;
  syncGeneratedReportUsage: (
    userId: string,
    reportCount: number,
    reportUsage: AccountReportUsage,
  ) => void;
  savePreferences: (preferences: UserPreferences) => Promise<AccountUser>;
}

export const AccountContext = createContext<AccountContextValue | null>(null);
