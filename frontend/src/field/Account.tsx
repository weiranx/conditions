import { useState } from "react";
import { Check, LoaderCircle, LogOut, Mail, UserRound } from "lucide-react";
import { useAccount } from "../hooks/useAccount";
import type { Workspace } from "./model/useWorkspace";
import { GoogleAuth } from "./GoogleAuth";
import { GUEST_REPORT_LIMIT } from "../app/guest-report-limit";
import { dateLabel } from "./data";

function Usage({
  label,
  used,
  limit,
  remaining,
  unlimited,
  resetAt,
}: {
  label: string;
  used: number | undefined;
  limit: number | null | undefined;
  remaining: number | null | undefined;
  unlimited?: boolean;
  resetAt?: string;
}) {
  return (
    <section className="field-usage">
      <h3>{label}</h3>
      {used === undefined ? (
        <p>Usage unavailable</p>
      ) : (
        <>
          <strong>
            {used.toLocaleString()}
            <small>
              {unlimited
                ? " used · unlimited"
                : ` / ${limit?.toLocaleString() ?? "—"}`}
            </small>
          </strong>
          {!unlimited && typeof limit === "number" && limit > 0 && (
            <progress
              aria-label={label}
              value={Math.min(used, limit)}
              max={limit}
            />
          )}
          <p>
            {unlimited
              ? "No monthly cap"
              : `${remaining?.toLocaleString() ?? "—"} remaining`}
            {resetAt && ` · Resets ${dateLabel(resetAt)}`}
          </p>
        </>
      )}
    </section>
  );
}

export function Account({ workspace: w }: { workspace: Workspace }) {
  const account = useAccount();
  const [mode, setMode] = useState<"signin" | "create" | "forgot" | "reset">(
    w.initialAccountLinkAction?.type === "reset-password" ? "reset" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [verifiedLink, setVerifiedLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = busy || account.busy || account.loading;
  const verification =
    !verifiedLink && w.initialAccountLinkAction?.type === "verify-email"
      ? w.initialAccountLinkAction
      : null;
  async function run(action: () => Promise<unknown>, done?: () => void) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const result = await action();
      if (typeof result === "string") setMessage(result);
      done?.();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "The account request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function switchMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setConfirm("");
    setError("");
    setMessage("");
  }
  return (
    <section className="field-account-panel" aria-busy={pending}>
      {verification && (
        <div className="field-panel">
          <h2>Verify your email</h2>
          <p>Confirm this account’s email address using the link you opened.</p>
          <button
            className="field-button"
            disabled={pending}
            onClick={() =>
              void run(
                () => account.verifyEmail(verification.token),
                () => setVerifiedLink(true),
              )
            }
          >
            Verify email
          </button>
        </div>
      )}
      {account.loading ? (
        <p role="status">
          <LoaderCircle className="field-spin" />
          Checking your account…
        </p>
      ) : account.user && mode !== "reset" ? (
        <>
          <div className="field-profile">
            <span className="field-account-symbol">
              {account.user.displayName.slice(0, 1).toUpperCase() || (
                <UserRound />
              )}
            </span>
            <div>
              <span className="field-kicker">
                {account.tier?.label || "Free"} account
              </span>
              <h2>{account.user.displayName}</h2>
              <p>{account.user.email}</p>
              <small>Member since {dateLabel(account.user.createdAt)}</small>
            </div>
          </div>
          {account.user.emailVerified ? (
            <p className="field-feedback">
              <Check size={17} />
              Email verified
            </p>
          ) : (
            <div className="field-warning">
              <Mail size={18} />
              <div>
                <p>Verify your email to use account email delivery.</p>
                <button
                  className="field-text-button"
                  disabled={pending}
                  onClick={() => void run(account.resendVerification)}
                >
                  Send verification email
                </button>
              </div>
            </div>
          )}
          <section aria-labelledby="chatgpt-setup-heading">
            <h3 id="chatgpt-setup-heading" className="field-subtitle">Use Conditions in ChatGPT</h3>
            <p>Search objectives, compare forecasts, and read your saved reports and objective watches from ChatGPT.</p>
            <details className="field-disclosure">
              <summary>Set up ChatGPT</summary>
              <p>Setup currently requires access from the Conditions administrator. This connector is not yet available as a public ChatGPT plugin.</p>
              <ol>
                <li>Ask the Conditions administrator for access to the configured plugin. If creating a custom connection, ask them to register your ChatGPT callback and provide the OAuth client details privately.</li>
                <li>In ChatGPT on the web, open Settings → Plugins (or Apps). Open Conditions and choose Connect or Reconnect. For a custom connection, enable Developer mode if available and create an app using the details below.</li>
                <li>Sign in to your own Conditions account and review the permissions. Choose “Allow read access” to connect your reports and watches.</li>
                <li>Return to ChatGPT, refresh the plugin’s actions if needed, and select Conditions in a chat. Try “Show my saved Conditions reports.”</li>
              </ol>
              <p><strong>MCP server URL</strong><br /><code style={{ overflowWrap: "anywhere" }}>https://apivps.conditions.weiranxiong.com/mcp</code></p>
              <p><strong>Authentication:</strong> OAuth · <strong>Scope:</strong> <code>conditions:read</code>. Use only the client details supplied by the administrator; your Conditions password belongs on the Conditions sign-in page.</p>
              <p>If custom apps or Developer mode are unavailable, check your ChatGPT account or workspace permissions. See the <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noreferrer">official ChatGPT setup guide</a>.</p>
            </details>
            <p>Access is read-only and limited to your account, including saved trip locations and dates. Signing out of Conditions or letting your sign-in expire ends access; reconnect in ChatGPT to renew it.</p>
            <p><a href="/connect">Manage connected apps or disconnect ChatGPT</a></p>
          </section>
          <h3 className="field-subtitle">Usage this month</h3>
          <div className="field-usage-grid">
            <Usage
              label="Generated reports"
              used={account.reportUsage?.usedReports}
              limit={account.reportUsage?.limitReports}
              remaining={account.reportUsage?.remainingReports}
              unlimited={account.reportUsage?.unlimited}
              resetAt={account.reportUsage?.resetAt}
            />
            <Usage
              label="Multi-day comparisons"
              used={account.multiDayUsage?.usedRuns}
              limit={account.multiDayUsage?.limitRuns}
              remaining={account.multiDayUsage?.remainingRuns}
              unlimited={account.multiDayUsage?.unlimited}
              resetAt={account.multiDayUsage?.resetAt}
            />
            <Usage
              label="AI tokens"
              used={account.aiUsage?.usedTokens}
              limit={account.aiUsage?.limitTokens}
              remaining={account.aiUsage?.remainingTokens}
              unlimited={account.aiUsage?.unlimited}
              resetAt={account.aiUsage?.resetAt}
            />
          </div>
          <details className="field-disclosure">
            <summary>Current plan · {account.tier?.label || "Free"}</summary>
            <p>
              {account.tier?.key === "premium"
                ? "Unlimited AI, report generation, and multi-day comparisons. Up to 10 watches with automatic checks, email alerts, and 90 days of history."
                : "Separate monthly allowances for reports, AI tokens, and comparisons. One watch with manual refresh and 14 days of check history."}
            </p>
            {account.tier?.currentPeriodEnd && (
              <p>
                {account.tier.cancelAtPeriodEnd
                  ? "Access ends"
                  : "Current period through"}{" "}
                {dateLabel(account.tier.currentPeriodEnd)}
              </p>
            )}
          </details>
          <div className="field-action-row">
            <button
              className="field-button"
              disabled={pending}
              onClick={() => void run(account.refreshAccount)}
            >
              Refresh account
            </button>
            <button
              className="field-button"
              disabled={pending}
              onClick={() =>
                void run(
                  async () => {
                    try {
                      await account.savePreferences(w.preferences);
                    } catch {
                      /* Sign-out remains available offline. */
                    }
                    await account.signOut();
                  },
                  () => switchMode("signin"),
                )
              }
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field-account-symbol">
            <UserRound size={28} />
          </div>
          <span className="field-kicker">Your account</span>
          <h2>
            {mode === "forgot"
              ? "Reset your password"
              : mode === "reset"
                ? "Choose a new password"
                : mode === "create"
                  ? "Create your account"
                  : "Sign in to your account"}
          </h2>
          <p>Save reports, sync preferences, and use AI planning tools.</p>
          {account.available === false && (
            <p className="field-feedback" role="status">
              Accounts are not enabled on this server. Your local plans and
              preferences remain available.
            </p>
          )}
          {(mode === "signin" || mode === "create") && (
            <>
              <div className="field-account-modes">
                <button
                  aria-pressed={mode === "signin"}
                  onClick={() => switchMode("signin")}
                >
                  Sign in
                </button>
                <button
                  aria-pressed={mode === "create"}
                  onClick={() => switchMode("create")}
                >
                  Create account
                </button>
              </div>
              <Usage
                label="Guest reports on this browser"
                used={w.guestReportCount}
                limit={GUEST_REPORT_LIMIT}
                remaining={Math.max(0, GUEST_REPORT_LIMIT - w.guestReportCount)}
              />
              {account.google.available &&
                account.google.clientId &&
                account.google.nonce && (
                  <>
                    <GoogleAuth
                      busy={pending}
                      clientId={account.google.clientId}
                      nonce={account.google.nonce}
                      onCredential={(credential) =>
                        void run(
                          () =>
                            account.signInWithGoogle({
                              credential,
                              preferences: w.preferences,
                            }),
                          w.closeAccountAccessPrompt,
                        )
                      }
                      onError={setError}
                    />
                    <p className="field-form-note">or continue with email</p>
                  </>
                )}
            </>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              if (
                (mode === "create" || mode === "reset") &&
                password !== confirm
              ) {
                setError("Passwords do not match.");
                return;
              }
              void run(async () => {
                if (mode === "forgot")
                  return account.requestPasswordReset(email);
                if (mode === "reset") {
                  if (w.initialAccountLinkAction?.type !== "reset-password")
                    throw new Error(
                      "This link is missing its reset token. Request a new link.",
                    );
                  const result = await account.resetPassword({
                    token: w.initialAccountLinkAction.token,
                    password,
                  });
                  setMode("signin");
                  setPassword("");
                  setConfirm("");
                  return result;
                }
                if (mode === "create")
                  await account.createAccount({
                    displayName: name,
                    email,
                    password,
                    preferences: w.preferences,
                  });
                else await account.signIn({ email, password });
                setPassword("");
                setConfirm("");
                w.closeAccountAccessPrompt();
              });
            }}
          >
            {mode === "create" && (
              <label>
                Your name
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                {mode === "reset" ? "New password" : "Password"}
                <input
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "signin" ? undefined : 12}
                  maxLength={128}
                />
                {mode !== "signin" && (
                  <small>Use at least 12 characters.</small>
                )}
              </label>
            )}
            {(mode === "create" || mode === "reset") && (
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}
            <button
              className="field-button field-button-primary"
              disabled={pending || account.available === false}
            >
              {pending
                ? "Please wait…"
                : mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Save new password"
                    : mode === "create"
                      ? "Create account"
                      : "Sign in"}
            </button>
          </form>
          <button
            className="field-text-button"
            onClick={() => switchMode(mode === "signin" ? "forgot" : "signin")}
          >
            {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
          </button>
          {mode === "create" && (
            <p className="field-muted">
              By creating an account, you agree to the{" "}
              <a href="/terms">Terms of Use</a> and acknowledge the{" "}
              <a href="/privacy">Privacy Policy</a>.
            </p>
          )}
        </>
      )}
      {(error || account.error) && (
        <p className="field-warning" role="alert">
          {error || account.error}
        </p>
      )}
      {message && (
        <p className="field-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
