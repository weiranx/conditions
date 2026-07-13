import React from 'react';
import {
  Check,
  CircleUserRound,
  Crown,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  Sparkles,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { useAccount } from '../../hooks/useAccount';
import { GoogleSignInButton } from '../account/GoogleSignInButton';
import { ProductNav } from './ProductNav';
import { LegalLinks } from '../../app/legal-links';
import { persistUserPreferences } from '../../app/preferences';
import type { UserPreferences } from '../../app/types';
import '../../styles/account.css';

interface AccountViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  preferences: UserPreferences;
  embedded?: boolean;
}

type AuthMode = 'create' | 'signin';

const formatMemberSince = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Member'
    : `Member since ${parsed.toLocaleDateString([], { month: 'long', year: 'numeric' })}`;
};

const formatTokens = (value: number) => Math.max(0, Math.round(value)).toLocaleString();

const formatUsageReset = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'next month'
    : parsed.toLocaleDateString([], { month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const formatPlanPeriod = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString([], {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
};

export function AccountView({
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
  preferences,
  embedded = false,
}: AccountViewProps) {
  const account = useAccount();
  const [mode, setMode] = React.useState<AuthMode>('create');
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setFormError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (mode === 'create' && password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    try {
      if (mode === 'create') {
        await account.createAccount({ displayName, email, password, preferences });
      } else {
        await account.signIn({ email, password });
      }
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Account request failed.');
    }
  };

  const handleSignOut = async () => {
    setFormError(null);
    try {
      persistUserPreferences(preferences);
      try {
        await account.savePreferences(preferences);
      } catch {
        // Signing out should still work if the final preference sync is offline.
      }
      await account.signOut();
      setMode('signin');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not sign out.');
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setFormError(null);
    try {
      await account.signInWithGoogle({ credential, preferences });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  const errorMessage = formError || account.error;
  const isPremium = account.tier?.key === 'premium';
  const planPeriodEnd = account.tier?.currentPeriodEnd
    ? formatPlanPeriod(account.tier.currentPeriodEnd)
    : null;

  return (
    <div
      key={embedded ? 'settings-account' : 'view-account'}
      id={embedded ? 'ssr-set-account' : undefined}
      className={embedded ? 'ssr-set-card account-settings-card-shell' : `${appShellClassName} account-page-shell`}
      aria-busy={isViewPending || account.loading}
    >
      {!embedded && (
        <ProductNav
          active="account"
          navigateToView={navigateToView}
          openPlannerView={openPlannerView}
          openTripToolView={openTripToolView}
        />
      )}

      <main className={embedded ? 'account-settings-card' : 'account-page'}>
        <section className="account-intro" aria-labelledby="account-title">
          <div className="account-intro-icon" aria-hidden><CircleUserRound /></div>
          <p className="account-eyebrow">Your account</p>
          <h1 id="account-title">A secure home for your profile.</h1>
          <p className="account-lede">
            Every account starts on Free, with saved preferences, report history, and AI tools. Premium adds a larger monthly AI allowance.
          </p>
          <div className="account-benefits" aria-label="Account details">
            <span><ShieldCheck aria-hidden /> Verified Google or password sign-in</span>
            <span><KeyRound aria-hidden /> Secure, HTTP-only device session</span>
            <span><Check aria-hidden /> Preferences follow your account</span>
          </div>
        </section>

        <section className="account-panel" aria-live="polite">
          {account.loading ? (
            <div className="account-loading" role="status">
              <LoaderCircle className="account-spinner" aria-hidden />
              <span>Checking your account…</span>
            </div>
          ) : account.available === false ? (
            <div className="account-unavailable" role="status">
              <ShieldCheck aria-hidden />
              <h2>Accounts are not available yet</h2>
              <p>The database connection must be enabled before accounts can be created on this deployment.</p>
              <button type="button" onClick={openPlannerView}>Continue without an account</button>
            </div>
          ) : account.user ? (
            <div className="account-profile">
              <div className="account-avatar" aria-hidden>
                {account.user.displayName.slice(0, 1).toUpperCase() || <UserRound />}
              </div>
              <p className="account-profile-kicker">Signed in</p>
              <h2>{account.user.displayName}</h2>
              <p className="account-profile-email"><Mail aria-hidden /> {account.user.email}</p>
              <p className="account-member-since">{formatMemberSince(account.user.createdAt)}</p>
              <div className="account-profile-note">
                <ShieldCheck aria-hidden />
                <div>
                  <strong>Your session is protected.</strong>
                  <span>Planning preferences and generated report history sync to your account.</span>
                </div>
              </div>
              <section
                className={`account-plan-card${isPremium ? ' is-premium' : ''}`}
                aria-label="Current account plan"
              >
                <div className="account-plan-heading">
                  <span>{isPremium ? <Crown aria-hidden /> : <ShieldCheck aria-hidden />} Current plan</span>
                  <strong>{account.tier?.label || 'Free'}</strong>
                </div>
                <p>
                  {isPremium
                    ? 'All Free features, with a larger monthly allowance for AI-powered planning.'
                    : 'Account sync, report history, and a monthly allowance for AI-powered planning.'}
                </p>
                <ul aria-label={`${account.tier?.label || 'Free'} plan features`}>
                  <li><Check aria-hidden /> Preferences and reports saved to your account</li>
                  <li>
                    <Check aria-hidden />
                    {account.aiUsage
                      ? `${formatTokens(account.aiUsage.limitTokens)} AI tokens each month`
                      : `${isPremium ? 'Expanded' : 'Standard'} monthly AI allowance`}
                  </li>
                </ul>
                {isPremium && planPeriodEnd && (
                  <small>
                    {account.tier?.cancelAtPeriodEnd ? 'Premium access ends' : 'Current period through'} {planPeriodEnd}
                  </small>
                )}
              </section>
              <div className="account-usage-card">
                <div className="account-usage-heading">
                  <span><Sparkles aria-hidden /> AI usage</span>
                  <small>Monthly</small>
                </div>
                {account.aiUsage ? (
                  <>
                    <p className="account-usage-total">
                      <strong>{formatTokens(account.aiUsage.usedTokens)}</strong>
                      <span> / {formatTokens(account.aiUsage.limitTokens)} tokens</span>
                    </p>
                    <div
                      className="account-usage-progress"
                      role="progressbar"
                      aria-label="Monthly AI token usage"
                      aria-valuemin={0}
                      aria-valuemax={account.aiUsage.limitTokens}
                      aria-valuenow={Math.min(account.aiUsage.usedTokens, account.aiUsage.limitTokens)}
                    >
                      <span style={{ width: `${account.aiUsage.percentUsed}%` }} />
                    </div>
                    <div className="account-usage-meta">
                      <span>{formatTokens(account.aiUsage.remainingTokens)} tokens remaining</span>
                      <span>Resets {formatUsageReset(account.aiUsage.resetAt)}</span>
                    </div>
                    <p className="account-usage-note">
                      Different AI tools use different amounts. This meter follows provider-reported tokens.
                    </p>
                  </>
                ) : (
                  <p className="account-usage-unavailable">Usage meter temporarily unavailable.</p>
                )}
              </div>
              {errorMessage && <p className="account-error" role="alert">{errorMessage}</p>}
              <div className="account-profile-actions">
                <button type="button" className="account-primary" onClick={openPlannerView}>Open planner</button>
                <button type="button" className="account-signout" onClick={handleSignOut} disabled={account.busy}>
                  {account.busy ? <LoaderCircle className="account-spinner" aria-hidden /> : <LogOut aria-hidden />}
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="account-auth">
              <div className="account-tabs" role="tablist" aria-label="Account action">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'create'}
                  className={mode === 'create' ? 'is-active' : ''}
                  onClick={() => switchMode('create')}
                >
                  Create account
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={mode === 'signin' ? 'is-active' : ''}
                  onClick={() => switchMode('signin')}
                >
                  Sign in
                </button>
              </div>

              <div className="account-form-head">
                <p>{mode === 'create' ? 'Get started' : 'Welcome back'}</p>
                <h2>{mode === 'create' ? 'Create your account' : 'Sign in to your account'}</h2>
              </div>

              {account.google.available && account.google.clientId && account.google.nonce && (
                <div className="account-google-auth">
                  <GoogleSignInButton
                    busy={account.busy}
                    clientId={account.google.clientId}
                    nonce={account.google.nonce}
                    onCredential={handleGoogleCredential}
                    onError={setFormError}
                  />
                  <div className="account-auth-divider"><span>or use email</span></div>
                </div>
              )}

              <form className="account-form" onSubmit={handleSubmit}>
                {mode === 'create' && (
                  <label>
                    <span>Name</span>
                    <div className="account-input-wrap">
                      <UserRound aria-hidden />
                      <input
                        type="text"
                        autoComplete="name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        maxLength={80}
                        required
                      />
                    </div>
                  </label>
                )}
                <label>
                  <span>Email</span>
                  <div className="account-input-wrap">
                    <Mail aria-hidden />
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      maxLength={254}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>Password</span>
                  <div className="account-input-wrap">
                    <KeyRound aria-hidden />
                    <input
                      type="password"
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={12}
                      maxLength={128}
                      aria-describedby={mode === 'create' ? 'account-password-help' : undefined}
                      required
                    />
                  </div>
                  {mode === 'create' && <small id="account-password-help">Use at least 12 characters.</small>}
                </label>
                {mode === 'create' && (
                  <label>
                    <span>Confirm password</span>
                    <div className="account-input-wrap">
                      <KeyRound aria-hidden />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        minLength={12}
                        maxLength={128}
                        required
                      />
                    </div>
                  </label>
                )}

                {errorMessage && <p className="account-error" role="alert">{errorMessage}</p>}

                <button type="submit" className="account-submit" disabled={account.busy}>
                  {account.busy && <LoaderCircle className="account-spinner" aria-hidden />}
                  {account.busy
                    ? (mode === 'create' ? 'Creating account…' : 'Signing in…')
                    : (mode === 'create' ? 'Create account' : 'Sign in')}
                </button>
              </form>

              {(mode === 'create' || account.google.available) && (
                <p className="account-legal">
                  By creating an account or continuing with Google, you agree to the{' '}
                  <button type="button" onClick={() => navigateToView('terms')}>Terms of Use</button>
                  {' '}and acknowledge the{' '}
                  <button type="button" onClick={() => navigateToView('privacy')}>Privacy Policy</button>.
                </p>
              )}
            </div>
          )}
        </section>
      </main>

      {!embedded && (
        <footer className="account-footer">
          <span>Backcountry Conditions</span>
          <LegalLinks navigateToView={navigateToView} />
        </footer>
      )}
    </div>
  );
}
