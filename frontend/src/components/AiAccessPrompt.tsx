import React from 'react';
import { Crown, FileText, KeyRound, LoaderCircle, LockKeyhole, Mail, Sparkles, UserRound, X } from 'lucide-react';
import type { UserPreferences } from '../app/types';
import { useAccount } from '../hooks/useAccount';
import { GoogleSignInButton } from './account/GoogleSignInButton';
import '../styles/ai-access-prompt.css';

export type AccountAccessReason = 'ai' | 'guest-report-limit' | 'account-report-limit';

interface AiAccessPromptProps {
  reason: AccountAccessReason | null;
  onClose: () => void;
  onOpenAccount: () => void;
  preferences: UserPreferences;
}

type AuthMode = 'signin' | 'create';

const formatReportReset = (value?: string) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime())
    ? 'at the start of next month'
    : `on ${parsed.toLocaleDateString([], { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
};

export function AiAccessPrompt({
  reason,
  onClose,
  onOpenAccount,
  preferences,
}: AiAccessPromptProps) {
  const account = useAccount();
  const initialFocusRef = React.useRef<HTMLInputElement>(null);
  const [mode, setMode] = React.useState<AuthMode>('signin');
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const open = reason !== null;
  const guestReportLimitReached = reason === 'guest-report-limit';
  const accountReportLimitReached = reason === 'account-report-limit';
  const reportLimitReached = guestReportLimitReached || accountReportLimitReached;
  const resetAt = formatReportReset(account.reportUsage?.resetAt);
  const eyebrow = reportLimitReached ? 'Free report limit reached' : 'Free with an account';
  const title = accountReportLimitReached
    ? 'You’ve reached this month’s report limit'
    : guestReportLimitReached
      ? 'Sign in to create more reports'
      : 'AI is free to use';
  const description = accountReportLimitReached
    ? `Your Free report allowance resets ${resetAt}. Premium accounts can generate unlimited reports.`
    : guestReportLimitReached
      ? 'You have used the 10 reports available without an account in this browser. Sign in or create an account below to continue planning.'
      : 'AI features are free to use, but you need an account. Sign in or create one below to use AI analysis, report chat, snow imagery insights, and route assistance.';

  React.useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirmPassword('');
      setFormError(null);
      return undefined;
    }
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => initialFocusRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setFormError(null);
    window.setTimeout(() => initialFocusRef.current?.focus(), 0);
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
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Account request failed.');
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setFormError(null);
    try {
      await account.signInWithGoogle({ credential, preferences });
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  if (!open) return null;

  const errorMessage = formError || account.error;

  return (
    <div
      className="ai-access-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ai-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-access-title"
        aria-describedby="ai-access-description"
      >
        <button type="button" className="ai-access-close" onClick={onClose} aria-label="Close account prompt">
          <X size={18} aria-hidden />
        </button>
        <div className="ai-access-icon" aria-hidden>
          {reportLimitReached ? <FileText size={22} /> : <Sparkles size={22} />}
        </div>
        <span className="ai-access-eyebrow"><LockKeyhole size={13} aria-hidden /> {eyebrow}</span>
        <h2 id="ai-access-title">{title}</h2>
        <p id="ai-access-description">{description}</p>

        <div className="ai-access-account" aria-live="polite">
          {accountReportLimitReached ? (
            <div className="ai-access-limit">
              <div className="ai-access-limit-summary">
                <FileText aria-hidden />
                <div>
                  <strong>
                    {account.reportUsage?.usedReports.toLocaleString() ?? 'All'}
                    {account.reportUsage?.limitReports != null
                      ? ` of ${account.reportUsage.limitReports.toLocaleString()}`
                      : ''}
                    {' '}reports used
                  </strong>
                  <span>Monthly usage resets {resetAt}.</span>
                </div>
              </div>
              <div className="ai-access-limit-upgrade">
                <Crown aria-hidden />
                <span>Premium includes unlimited report generation and history.</span>
              </div>
              <div className="ai-access-limit-actions">
                <button type="button" className="ai-access-primary" onClick={onOpenAccount}>View account</button>
                <button type="button" className="ai-access-secondary" onClick={onClose}>Close</button>
              </div>
            </div>
          ) : account.loading ? (
            <div className="ai-access-status" role="status">
              <LoaderCircle className="ai-access-spinner" aria-hidden />
              <span>Checking account availability…</span>
            </div>
          ) : account.available === false ? (
            <div className="ai-access-unavailable" role="status">
              <strong>Accounts are temporarily unavailable.</strong>
              <span>
                Try again later to {reportLimitReached ? 'create more reports' : 'use AI features'} on this deployment.
              </span>
              <button type="button" className="ai-access-secondary" onClick={onClose}>Not now</button>
            </div>
          ) : (
            <>
              <div className="ai-access-tabs" role="tablist" aria-label="Account action">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={mode === 'signin' ? 'is-active' : ''}
                  onClick={() => switchMode('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'create'}
                  className={mode === 'create' ? 'is-active' : ''}
                  onClick={() => switchMode('create')}
                >
                  Sign up
                </button>
              </div>

              {account.google.available && account.google.clientId && account.google.nonce && (
                <div className="ai-access-google-auth">
                  <GoogleSignInButton
                    busy={account.busy}
                    clientId={account.google.clientId}
                    nonce={account.google.nonce}
                    onCredential={handleGoogleCredential}
                    onError={setFormError}
                  />
                  <div className="ai-access-divider"><span>or use email</span></div>
                </div>
              )}

              <form className="ai-access-form" onSubmit={handleSubmit}>
                {mode === 'create' && (
                  <label>
                    <span>Name</span>
                    <div className="ai-access-input-wrap">
                      <UserRound aria-hidden />
                      <input
                        ref={initialFocusRef}
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
                  <div className="ai-access-input-wrap">
                    <Mail aria-hidden />
                    <input
                      ref={mode === 'signin' ? initialFocusRef : undefined}
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
                  <div className="ai-access-input-wrap">
                    <KeyRound aria-hidden />
                    <input
                      type="password"
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={12}
                      maxLength={128}
                      aria-describedby={mode === 'create' ? 'ai-access-password-help' : undefined}
                      required
                    />
                  </div>
                  {mode === 'create' && <small id="ai-access-password-help">Use at least 12 characters.</small>}
                </label>
                {mode === 'create' && (
                  <label>
                    <span>Confirm password</span>
                    <div className="ai-access-input-wrap">
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

                {errorMessage && <p className="ai-access-error" role="alert">{errorMessage}</p>}

                <div className="ai-access-form-actions">
                  <button type="submit" className="ai-access-primary" disabled={account.busy}>
                    {account.busy && <LoaderCircle className="ai-access-spinner" aria-hidden />}
                    {account.busy
                      ? (mode === 'create' ? 'Creating account…' : 'Signing in…')
                      : (mode === 'create' ? 'Create free account' : 'Sign in')}
                  </button>
                  <button type="button" className="ai-access-secondary" onClick={onClose}>Not now</button>
                </div>
              </form>

              {(mode === 'create' || account.google.available) && (
                <p className="ai-access-legal">
                  By signing up or continuing with Google, you agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a>
                  {' '}and acknowledge the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
