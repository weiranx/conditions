import { useState } from "react";
import { Check, Copy, LoaderCircle, LogOut, Mail, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { useAccount } from "../hooks/useAccount";
import type { Workspace } from "./model/useWorkspace";
import { GoogleAuth } from "./GoogleAuth";
import { GUEST_REPORT_LIMIT } from "../app/guest-report-limit";
import { dateLabel } from "./data";
import "./account.css";

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
  const share = !unlimited && typeof limit === "number" && limit > 0 && used !== undefined ? used / limit : null;
  return (
    <section className={`sky-card sky-usage${share !== null && share >= 1 ? " is-over" : ""}`}>
      <h3>{label}</h3>
      {used === undefined ? (
        <p className="sky-usage-missing">Usage unavailable</p>
      ) : (
        <>
          <strong className="sky-usage-value">
            {used.toLocaleString()}
            <small>
              {unlimited
                ? " used · unlimited"
                : ` / ${limit?.toLocaleString() ?? "—"}`}
            </small>
          </strong>
          {share !== null && typeof limit === "number" && (
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

const MCP_URL = "https://apivps.conditions.weiranxiong.com/mcp";

function CopyUrl() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sky-mcp-url">
      <code>{MCP_URL}</code>
      <button
        type="button"
        className="field-button"
        onClick={() => {
          void navigator.clipboard?.writeText(MCP_URL).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
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
    <section className="sky-account" aria-busy={pending}>
      {verification && (
        <div className="sky-card sky-account-verify-link">
          <h2>Verify your email</h2>
          <p className="sky-cap is-body">Confirm this account’s email address using the link you opened.</p>
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
            <Mail size={16} aria-hidden="true" />
            Verify email
          </button>
        </div>
      )}
      {account.loading ? (
        <p className="sky-notice is-info" role="status">
          <LoaderCircle className="field-spin" aria-hidden="true" />
          Checking your account…
        </p>
      ) : account.user && mode !== "reset" ? (
        <div className="sky-account-body">
          <div className="sky-card sky-account-profile">
            <span className="sky-avatar" aria-hidden="true">
              {account.user.displayName.slice(0, 1).toUpperCase() || (
                <UserRound />
              )}
            </span>
            <div className="sky-account-id">
              <h2>{account.user.displayName}</h2>
              <p>{account.user.email}</p>
              <small>Member since {dateLabel(account.user.createdAt)}</small>
            </div>
            <span className={`sky-chip sky-tier-chip${account.tier?.key === "premium" ? " is-premium" : ""}`}>
              {account.tier?.key === "premium" && <Sparkles size={13} aria-hidden="true" />}
              {account.tier?.label || "Free"} account
            </span>
            {account.user.emailVerified ? (
              <p className="sky-status is-ok sky-account-verified">
                <Check size={14} aria-hidden="true" />
                Email verified
              </p>
            ) : (
              <div className="sky-notice is-caution sky-account-verify">
                <Mail size={18} aria-hidden="true" />
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
          </div>

          <section className="sky-account-section" aria-labelledby="usage-heading">
            <div className="sky-sh">
              <h2 id="usage-heading">Usage this month</h2>
            </div>
            <div className="sky-usage-grid">
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
          </section>

          <section className="sky-account-section" aria-labelledby="plan-heading">
            <div className="sky-sh">
              <h2 id="plan-heading">Your plan</h2>
            </div>
            <div className="sky-card">
              <dl className="sky-list">
                <div>
                  <dt>Plan</dt>
                  <dd>{account.tier?.label || "Free"}</dd>
                </div>
                {account.tier?.currentPeriodEnd && (
                  <div>
                    <dt>{account.tier.cancelAtPeriodEnd ? "Access ends" : "Current period through"}</dt>
                    <dd>{dateLabel(account.tier.currentPeriodEnd)}</dd>
                  </div>
                )}
              </dl>
              <p className="sky-cap is-body">
                {account.tier?.key === "premium"
                  ? "Unlimited AI, report generation, and multi-day comparisons. Up to 10 watches with automatic checks, email alerts, and 90 days of history."
                  : "Separate monthly allowances for reports, AI tokens, and comparisons. One watch with manual refresh and 14 days of check history."}
              </p>
            </div>
          </section>

          <section className="sky-account-section" aria-labelledby="chatgpt-setup-heading">
            <div className="sky-sh">
              <h2 id="chatgpt-setup-heading">Use Conditions with AI apps</h2>
            </div>
            <div className="sky-card sky-ai-card">
              <p className="sky-card-lede">Search objectives, compare forecasts, and read your saved reports and objective watches from your connected AI app.</p>
              <div>
                <span className="sky-cap">MCP server URL · OAuth · scope <code>conditions:read</code></span>
                <CopyUrl />
              </div>
              <div className="sky-ai-guides">
                <details className="sky-details">
                  <summary>Set up ChatGPT</summary>
                  <p>Connect with your own Conditions account. ChatGPT registers the connection automatically—no client ID or secret to request or copy.</p>
                  <ol>
                    <li>In ChatGPT on the web, open Settings → Plugins (or Apps). Enable Developer mode if available, then create a custom app named Conditions.</li>
                    <li>Paste the MCP server URL above, select OAuth, and leave the optional client ID and client secret fields blank. If offered a registration method, choose automatic or dynamic registration.</li>
                    <li>Continue to Conditions, sign in to your own account, and review the permissions. Choose “Allow read access”.</li>
                    <li>Return to ChatGPT and select Conditions in a chat. Try “Show my saved Conditions reports.” Refresh the plugin’s actions if the saved-report tools are missing.</li>
                  </ol>
                  <p>Already connected? Your existing connection still works. To switch a manually configured connection to automatic registration, create a new connection with both client fields blank.</p>
                  <p>If custom apps or Developer mode are unavailable, check your ChatGPT account or workspace permissions. See the <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noreferrer">official ChatGPT setup guide</a>.</p>
                </details>
                <details className="sky-details">
                  <summary>Set up Claude, Grok, Gemini, or another MCP client</summary>
                  <p><strong>Claude:</strong> Open Customize → Connectors, add a custom connector named Conditions, and enter the MCP server URL. Leave optional OAuth credentials blank, then connect and sign in to Conditions.</p>
                  <p><strong>Grok:</strong> Open Plugins → Connectors → New Connector → Custom. Name it Conditions, enter the MCP server URL, then add the connector and sign in to Conditions.</p>
                  <p><strong>Gemini:</strong> Open Settings → Personal Intelligence → Connected Apps (or Settings → Connected Apps). Under Custom apps, enter the MCP server URL, then choose Next. Leave the optional client ID and secret blank. Review Google's connection notice, connect, and sign in to Conditions. Custom apps may appear under Spark and depend on your account's availability.</p>
                  <p><strong>Desktop and CLI apps:</strong> Add the same URL as a remote Streamable HTTP MCP server with OAuth. The client must support automatic registration, PKCE, and a local browser callback. Start the connection on this device and verify the return address on the consent page.</p>
                  <p>Supported return destinations are ChatGPT, Claude, Grok, Gemini’s Google callbacks, and local callbacks on localhost, 127.0.0.1, or [::1]. Other hosted AI services and clients that only support API keys or local stdio are not supported by this connection flow.</p>
                  <p>Approve read access, return to your AI app, and try “Show my saved Conditions reports.” See <a href="https://claude.com/docs/connectors/building" target="_blank" rel="noreferrer">Claude’s connector guide</a> for client setup details.</p>
                </details>
              </div>
              <p className="sky-cap is-body">Access is read-only and limited to your account, including saved trip locations and dates. Signing out of Conditions or letting your sign-in expire ends access; reconnect in your AI app to renew it.</p>
              <a className="field-button sky-ai-manage" href="/connect">Manage or disconnect AI apps</a>
            </div>
          </section>

          <div className="sky-toolbar-actions sky-account-actions">
            <button
              className="field-button"
              disabled={pending}
              onClick={() => void run(account.refreshAccount)}
            >
              <RefreshCw size={16} aria-hidden="true" />
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
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="sky-card sky-auth-card">
          <div className="sky-avatar is-guest" aria-hidden="true">
            <UserRound size={26} />
          </div>
          <h2>
            {mode === "forgot"
              ? "Reset your password"
              : mode === "reset"
                ? "Choose a new password"
                : mode === "create"
                  ? "Create your account"
                  : "Sign in to your account"}
          </h2>
          <p className="sky-auth-sub">Save reports, sync preferences, and use AI planning tools.</p>
          {account.available === false && (
            <p className="sky-notice is-missing" role="status">
              Accounts are not enabled on this server. Your local plans and
              preferences remain available.
            </p>
          )}
          {(mode === "signin" || mode === "create") && (
            <>
              <div className="sky-segmented sky-auth-modes" role="group" aria-label="Account action">
                <button
                  type="button"
                  aria-pressed={mode === "signin"}
                  onClick={() => switchMode("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "create"}
                  onClick={() => switchMode("create")}
                >
                  Create account
                </button>
              </div>
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
                    <p className="sky-auth-divider"><span>or continue with email</span></p>
                  </>
                )}
            </>
          )}
          <form
            className="sky-auth-form"
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
            type="button"
            className="field-text-button sky-auth-switch"
            onClick={() => switchMode(mode === "signin" ? "forgot" : "signin")}
          >
            {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
          </button>
          {mode === "create" && (
            <p className="sky-cap sky-auth-legal">
              By creating an account, you agree to the{" "}
              <a href="/terms">Terms of Use</a> and acknowledge the{" "}
              <a href="/privacy">Privacy Policy</a>.
            </p>
          )}
          {(mode === "signin" || mode === "create") && (
            <Usage
              label="Guest reports on this browser"
              used={w.guestReportCount}
              limit={GUEST_REPORT_LIMIT}
              remaining={Math.max(0, GUEST_REPORT_LIMIT - w.guestReportCount)}
            />
          )}
        </div>
      )}
      {(error || account.error) && (
        <p className="sky-notice is-caution sky-account-message" role="alert">
          {error || account.error}
        </p>
      )}
      {message && (
        <p className="sky-notice is-info sky-account-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
