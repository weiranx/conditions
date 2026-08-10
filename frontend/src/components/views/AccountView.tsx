import React from 'react';
import {
  CalendarRange,
  Check,
  CircleUserRound,
  Crown,
  FileText,
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
import { GUEST_REPORT_LIMIT } from '../../app/guest-report-limit';
import { persistUserPreferences } from '../../app/preferences';
import type { UserPreferences } from '../../app/types';
import type { AccountLinkAction } from '../../app/account-links';
import '../../styles/account.css';

interface AccountViewProps {
  accountLinkAction: AccountLinkAction | null;
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
  preferences: UserPreferences;
  guestReportCount: number;
  embedded?: boolean;
}

type AuthMode = 'create' | 'signin' | 'forgot' | 'reset';

const authHeading = (mode: AuthMode) => {
  if (mode === 'forgot') return { kicker: 'Account recovery', title: 'Reset your password' };
  if (mode === 'reset') return { kicker: 'Choose a new password', title: 'Secure your account' };
  return mode === 'create'
    ? { kicker: 'Get started', title: 'Create your account' }
    : { kicker: 'Welcome back', title: 'Sign in to your account' };
};

const submitLabel = (mode: AuthMode, busy: boolean) => {
  if (mode === 'forgot') return busy ? 'Sending reset link…' : 'Send reset link';
  if (mode === 'reset') return busy ? 'Resetting password…' : 'Reset password';
  if (mode === 'create') return busy ? 'Creating account…' : 'Create account';
  return busy ? 'Signing in…' : 'Sign in';
};

const formatMemberSince = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Member'
    : `Member since ${parsed.toLocaleDateString([], { month: 'long', year: 'numeric' })}`;
};

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

interface MonthlyUsageMeterProps {
  icon: React.ReactNode;
  label: string;
  singularUnit: string;
  pluralUnit: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  resetAt: string | null;
  unlimited: boolean;
  note: string;
}

function MonthlyUsageMeter({
  icon,
  label,
  singularUnit,
  pluralUnit,
  used,
  limit,
  remaining,
  percentUsed,
  resetAt,
  unlimited,
  note,
}: MonthlyUsageMeterProps) {
  const available = used !== null
    && resetAt !== null
    && (unlimited || (limit !== null && remaining !== null && percentUsed !== null));
  const usedUnit = used === 1 ? singularUnit : pluralUnit;

  return (
    <section className="account-usage-card" aria-label={label}>
      <div className="account-usage-heading">
        <span>{icon} {label}</span>
        <small>Monthly</small>
      </div>
      {available && used !== null && resetAt !== null ? (
        <>
          <p className="account-usage-total">
            <strong>{used.toLocaleString()}</strong>
            <span>
              {unlimited
                ? ` ${usedUnit} used this month`
                : ` / ${limit?.toLocaleString()} ${pluralUnit}`}
            </span>
          </p>
          {unlimited ? (
            <>
              <div className="account-usage-unlimited">
                <Crown aria-hidden />
                <span>Unlimited {label.toLowerCase()}</span>
              </div>
              <div className="account-usage-meta">
                <span>No monthly cap</span>
                <span>Tracking resets {formatUsageReset(resetAt)}</span>
              </div>
            </>
          ) : (
            <>
              <div
                className="account-usage-progress"
                role="progressbar"
                aria-label={`Monthly ${label.toLowerCase()}`}
                aria-valuemin={0}
                aria-valuemax={limit ?? 0}
                aria-valuenow={Math.min(used, limit ?? 0)}
              >
                <span style={{ width: `${percentUsed}%` }} />
              </div>
              <div className="account-usage-meta">
                <span>{remaining?.toLocaleString()} {remaining === 1 ? singularUnit : pluralUnit} remaining</span>
                <span>Resets {formatUsageReset(resetAt)}</span>
              </div>
            </>
          )}
          <p className="account-usage-note">{note}</p>
        </>
      ) : (
        <p className="account-usage-unavailable">Usage meter temporarily unavailable.</p>
      )}
    </section>
  );
}

export function AccountView({
  accountLinkAction,
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
  preferences,
  guestReportCount,
  embedded = false,
}: AccountViewProps) {
  const account = useAccount();
  const { verifyEmail } = account;
  const [mode, setMode] = React.useState<AuthMode>(accountLinkAction?.type === 'reset-password' ? 'reset' : 'create');
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formNotice, setFormNotice] = React.useState<string | null>(null);
  const verificationStartedRef = React.useRef(false);

  React.useEffect(() => {
    if (accountLinkAction?.type !== 'verify-email' || verificationStartedRef.current) return;
    verificationStartedRef.current = true;
    setFormError(null);
    void verifyEmail(accountLinkAction.token)
      .then((message) => {
        setMode('signin');
        setFormNotice(message);
      })
      .catch((error) => {
        setMode('signin');
        setFormError(error instanceof Error ? error.message : 'Could not verify this email address.');
      });
  }, [accountLinkAction, verifyEmail]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setFormError(null);
    setFormNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if ((mode === 'create' || mode === 'reset') && password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    try {
      if (mode === 'forgot') {
        const message = await account.requestPasswordReset(email);
        setFormNotice(message);
      } else if (mode === 'reset') {
        if (!accountLinkAction?.token) {
          setFormError('This password reset link is missing its token. Request a new link.');
          return;
        }
        const message = await account.resetPassword({ token: accountLinkAction.token, password });
        setMode('signin');
        setFormNotice(message);
        setPassword('');
        setConfirmPassword('');
      } else if (mode === 'create') {
        await account.createAccount({ displayName, email, password, preferences });
      } else {
        await account.signIn({ email, password });
      }
      if (mode !== 'reset') {
        setPassword('');
        setConfirmPassword('');
      }
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
    setFormNotice(null);
    try {
      await account.signInWithGoogle({ credential, preferences });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  const handleResendVerification = async () => {
    setFormError(null);
    setFormNotice(null);
    try {
      setFormNotice(await account.resendVerification());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not send a verification email.');
    }
  };

  const errorMessage = formError || account.error;
  const heading = authHeading(mode);
  const isPremium = account.tier?.key === 'premium';
  const reportUsage = account.reportUsage;
  const multiDayUsage = account.multiDayUsage;
  const planPeriodEnd = account.tier?.currentPeriodEnd
    ? formatPlanPeriod(account.tier.currentPeriodEnd)
    : null;
  const guestReportsRemaining = Math.max(0, GUEST_REPORT_LIMIT - guestReportCount);
  const guestReportPercentUsed = Math.min(100, (guestReportCount / GUEST_REPORT_LIMIT) * 100);
  const isSignedIn = Boolean(account.user && mode !== 'reset');

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

      <main className={`${embedded ? 'account-settings-card' : 'account-page'}${isSignedIn ? ' is-signed-in' : ''}`}>
        {!isSignedIn && (
          <section className="account-intro" aria-labelledby="account-title">
            <div className="account-intro-icon" aria-hidden><CircleUserRound /></div>
            <p className="account-eyebrow">Your account</p>
            <h1 id="account-title">A secure home for your profile.</h1>
            <p className="account-lede">
              Every account starts on Free, with saved preferences, report history, and AI tools. Premium adds unlimited AI and reports.
            </p>
            <div className="account-benefits" aria-label="Account details">
              <span><ShieldCheck aria-hidden /> Verified Google or password sign-in</span>
              <span><KeyRound aria-hidden /> Secure, HTTP-only device session</span>
              <span><Check aria-hidden /> Preferences follow your account</span>
            </div>
          </section>
        )}

        <section
          className={`account-panel${isSignedIn ? ' is-profile-panel' : ''}${embedded && account.available === false ? ' is-compact-unavailable' : ''}`}
          aria-live="polite"
        >
          {account.loading ? (
            <div className="account-loading" role="status">
              <LoaderCircle className="account-spinner" aria-hidden />
              <span>Checking your account…</span>
            </div>
          ) : account.available === false ? (
            <div className="account-unavailable" role="status">
              <ShieldCheck aria-hidden />
              <h2>Accounts are not enabled here</h2>
              <p>You can keep planning with preferences saved in this browser.</p>
              <button type="button" onClick={openPlannerView}>Continue to planner</button>
            </div>
          ) : account.user && mode !== 'reset' ? (
            <div className="account-profile">
              <header className="account-profile-header">
                <div className="account-avatar" aria-hidden>
                  {account.user.displayName.slice(0, 1).toUpperCase() || <UserRound />}
                </div>
                <div className="account-profile-identity">
                  <p className="account-profile-kicker">Signed in</p>
                  <h2>{account.user.displayName}</h2>
                  <p className="account-profile-email"><Mail aria-hidden /> {account.user.email}</p>
                  <p className="account-member-since">{formatMemberSince(account.user.createdAt)}</p>
                </div>
                <div className={`account-plan-badge${isPremium ? ' is-premium' : ''}`}>
                  {isPremium ? <Crown aria-hidden /> : <ShieldCheck aria-hidden />}
                  <span>
                    <small>Current plan</small>
                    <strong>{account.tier?.label || 'Free'}</strong>
                  </span>
                </div>
              </header>
              {account.user.emailVerified ? (
                <div className="account-profile-note">
                  <ShieldCheck aria-hidden />
                  <div>
                    <strong>Email verified and session protected.</strong>
                    <span>Planning preferences and generated report history sync to your account.</span>
                  </div>
                </div>
              ) : (
                <div className="account-profile-note is-warning">
                  <Mail aria-hidden />
                  <div>
                    <strong>Verify your email address.</strong>
                    <span>We’ll send a secure, single-use link to {account.user.email}. The link expires after 24 hours.</span>
                    <button
                      type="button"
                      className="account-inline-action"
                      onClick={handleResendVerification}
                      disabled={account.busy}
                    >
                      {account.busy ? 'Sending…' : 'Send verification email'}
                    </button>
                  </div>
                </div>
              )}
              <div className="account-section-heading">
                <div>
                  <p className="account-profile-kicker">Allowance</p>
                  <h3>Usage this month</h3>
                </div>
                <span>Updates after each successful action</span>
              </div>
              <section className="account-usage-list" aria-label="Monthly usage limits">
                <MonthlyUsageMeter
                  icon={<FileText aria-hidden />}
                  label="Generated report usage"
                  singularUnit="report"
                  pluralUnit="reports"
                  used={reportUsage?.usedReports ?? null}
                  limit={reportUsage?.limitReports ?? null}
                  remaining={reportUsage?.remainingReports ?? null}
                  percentUsed={reportUsage?.percentUsed ?? null}
                  resetAt={reportUsage?.resetAt ?? null}
                  unlimited={reportUsage?.unlimited ?? false}
                  note="Each successfully generated report counts once, including reports added to your account history."
                />
                <MonthlyUsageMeter
                  icon={<CalendarRange aria-hidden />}
                  label="Multi-day forecast usage"
                  singularUnit="comparison"
                  pluralUnit="comparisons"
                  used={multiDayUsage?.usedRuns ?? null}
                  limit={multiDayUsage?.limitRuns ?? null}
                  remaining={multiDayUsage?.remainingRuns ?? null}
                  percentUsed={multiDayUsage?.percentUsed ?? null}
                  resetAt={multiDayUsage?.resetAt ?? null}
                  unlimited={multiDayUsage?.unlimited ?? false}
                  note="Each successful 2–7 day comparison counts once, regardless of how many forecast days it includes."
                />
                <MonthlyUsageMeter
                  icon={<Sparkles aria-hidden />}
                  label="AI usage"
                  singularUnit="token"
                  pluralUnit="tokens"
                  used={account.aiUsage?.usedTokens ?? null}
                  limit={account.aiUsage?.limitTokens ?? null}
                  remaining={account.aiUsage?.remainingTokens ?? null}
                  percentUsed={account.aiUsage?.percentUsed ?? null}
                  resetAt={account.aiUsage?.resetAt ?? null}
                  unlimited={account.aiUsage?.unlimited ?? false}
                  note="Input and output tokens from AI briefs, chat replies, imagery insights, and AI-assisted analysis count toward this allowance."
                />
              </section>
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
                    ? 'All Free features, with unlimited AI tools and report generation.'
                    : 'Generated reports use a monthly count allowance, while AI tools use a separate token allowance.'}
                </p>
                <ul aria-label={`${account.tier?.label || 'Free'} plan features`}>
                  <li>
                    <Check aria-hidden />
                    {isPremium
                      ? 'Unlimited report generation and history'
                      : reportUsage?.limitReports != null
                        ? `${reportUsage.limitReports.toLocaleString()} generated reports each month with synced history`
                        : 'Monthly report allowance with synced history'}
                  </li>
                  <li>
                    <Check aria-hidden />
                    {isPremium
                      ? 'Unlimited AI usage'
                      : account.aiUsage?.limitTokens != null
                        ? `${account.aiUsage.limitTokens.toLocaleString()} AI tokens each month`
                        : 'Monthly AI token allowance'}
                  </li>
                  <li>
                    <Check aria-hidden />
                    {isPremium
                      ? 'Unlimited multi-day forecast comparisons'
                      : multiDayUsage?.limitRuns != null
                        ? `${multiDayUsage.limitRuns.toLocaleString()} multi-day forecast comparisons each month`
                        : 'Monthly multi-day forecast allowance'}
                  </li>
                  <li>
                    <Check aria-hidden />
                    {isPremium
                      ? '10 Objective Watches with automatic checks, email alerts, and 90-day check history'
                      : '1 Objective Watch with manual refresh and 14-day check history'}
                  </li>
                </ul>
                {isPremium && planPeriodEnd && (
                  <small>
                    {account.tier?.cancelAtPeriodEnd ? 'Premium access ends' : 'Current period through'} {planPeriodEnd}
                  </small>
                )}
              </section>
              {formNotice && <p className="account-notice" role="status">{formNotice}</p>}
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
              {(mode === 'create' || mode === 'signin') && (
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
              )}

              {(mode === 'create' || mode === 'signin') && (
                <section className="account-usage-card account-guest-usage" aria-label="Generated report usage without an account">
                <div className="account-usage-heading">
                  <span><FileText aria-hidden /> Generated report usage</span>
                  <small>Browser limit</small>
                </div>
                <p className="account-usage-total">
                  <strong>{guestReportCount}</strong>
                  <span> / {GUEST_REPORT_LIMIT} reports</span>
                </p>
                <div
                  className="account-usage-progress"
                  role="progressbar"
                  aria-label="Generated reports used without an account"
                  aria-valuemin={0}
                  aria-valuemax={GUEST_REPORT_LIMIT}
                  aria-valuenow={guestReportCount}
                >
                  <span style={{ width: `${guestReportPercentUsed}%` }} />
                </div>
                <div className="account-usage-meta">
                  <span>
                    {guestReportsRemaining === 1
                      ? '1 report remaining'
                      : `${guestReportsRemaining} reports remaining`}
                  </span>
                  <span>Stored in this browser</span>
                </div>
                <p className="account-usage-note">
                  {guestReportsRemaining > 0
                    ? 'Create a free account for more reports and saved history.'
                    : 'Your browser quota is used. Sign in or create a free account to continue.'}
                </p>
                </section>
              )}

              <div className="account-form-head">
                <p>{heading.kicker}</p>
                <h2>{heading.title}</h2>
                {mode === 'forgot' && <span>Enter your email and we’ll send a single-use link if a password account exists.</span>}
                {mode === 'reset' && <span>Use at least 12 characters. Saving this password signs out every existing device.</span>}
              </div>

              {(mode === 'create' || mode === 'signin')
                && account.google.available
                && account.google.clientId
                && account.google.nonce && (
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
                {mode !== 'reset' && (
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
                )}
                {mode !== 'forgot' && (
                  <label>
                    <span>{mode === 'reset' ? 'New password' : 'Password'}</span>
                    <div className="account-input-wrap">
                      <KeyRound aria-hidden />
                      <input
                        type="password"
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={12}
                        maxLength={128}
                        aria-describedby={mode === 'create' || mode === 'reset' ? 'account-password-help' : undefined}
                        required
                      />
                    </div>
                    {(mode === 'create' || mode === 'reset') && <small id="account-password-help">Use at least 12 characters.</small>}
                  </label>
                )}
                {mode === 'signin' && (
                  <button type="button" className="account-forgot-link" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                )}
                {(mode === 'create' || mode === 'reset') && (
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

                {formNotice && <p className="account-notice" role="status">{formNotice}</p>}
                {errorMessage && <p className="account-error" role="alert">{errorMessage}</p>}

                <button type="submit" className="account-submit" disabled={account.busy}>
                  {account.busy && <LoaderCircle className="account-spinner" aria-hidden />}
                  {submitLabel(mode, account.busy)}
                </button>
                {(mode === 'forgot' || mode === 'reset') && (
                  <button type="button" className="account-back-link" onClick={() => switchMode('signin')}>
                    Back to sign in
                  </button>
                )}
              </form>

              {(mode === 'create' || (mode === 'signin' && account.google.available)) && (
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
