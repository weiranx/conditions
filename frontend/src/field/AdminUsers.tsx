import { useState } from "react";
import type {
  Administration,
  AdminUserRecord,
} from "./model/useAdministration";
import { AdminNotice } from "./Administration";
import { Details } from "./Details";

type LimitState = "near" | "at" | null;
function limitState(used: number, limit: number | null | undefined): LimitState {
  if (!limit || !Number.isFinite(limit) || !Number.isFinite(used)) return null;
  const ratio = used / limit;
  return ratio >= 1 ? "at" : ratio >= 0.8 ? "near" : null;
}

function UsageMeter({
  label,
  used,
  limit,
  custom,
  format,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
  custom: boolean;
  format: (value: number) => string;
}) {
  const known = limit != null && Number.isFinite(limit) && limit > 0;
  return (
    <div className="admin-resource">
      <div>
        <span>{label}</span>
        <strong>
          {format(used)}
          {known ? ` of ${format(limit)}` : ""}
        </strong>
      </div>
      {known && (
        <meter
          aria-label={`${label} used this month`}
          min={0}
          max={limit}
          low={limit * 0.8}
          high={limit * 0.95}
          optimum={0}
          value={Math.min(Math.max(0, used), limit)}
        />
      )}
      <small>
        {known
          ? custom
            ? "Custom limit"
            : "Default limit"
          : "Default limit unavailable"}
      </small>
    </div>
  );
}

/** A limit input with Save enabled only once the value differs from the saved one. */
function LimitEditor({
  label,
  draft,
  saved,
  custom,
  onDraft,
  onSave,
  onReset,
}: {
  label: string;
  draft: string | undefined;
  saved: number | null | undefined;
  custom: boolean;
  onDraft: (value: string) => void;
  onSave: (value: number) => void;
  onReset: () => void;
}) {
  const value = draft ?? (saved == null ? "" : String(saved));
  const changed =
    draft !== undefined && draft.trim() !== "" && Number(draft) !== saved;
  return (
    <div className="field-action-row">
      <label className="field-form-label">
        {label}
        <input
          type="number"
          min="1"
          inputMode="numeric"
          placeholder="Default"
          value={value}
          onChange={(e) => onDraft(e.target.value)}
        />
      </label>
      <button
        className="field-button"
        disabled={!changed}
        onClick={() => onSave(Number(value))}
      >
        Save limit
      </button>
      <button className="field-button" disabled={!custom} onClick={onReset}>
        Use default
      </button>
    </div>
  );
}

const lastActive = (a: Administration, user: AdminUserRecord) =>
  user.lastActivityAt
    ? `Active ${a.formatAccountDate(user.lastActivityAt).replace(/^Just now$/, "just now")}`
    : "No activity yet";

const methodLabel = (method: string) =>
  method.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

function AccountRow({ a, user }: { a: Administration; user: AdminUserRecord }) {
  const premium = user.tier === "premium";
  const defaultAI = a.usageSettings?.freeMonthlyAITokenLimit;
  const defaultReports = a.usageSettings?.freeMonthlyReportUsageLimit;
  const aiLimit = user.aiTokenLimitOverride ?? defaultAI;
  const reportLimit = user.reportUsageLimitOverride ?? defaultReports;
  const worst = premium
    ? null
    : [limitState(user.savedReports, reportLimit), limitState(user.aiTokens, aiLimit)].reduce<LimitState>(
        (state, next) => (state === "at" || next === "at" ? "at" : state || next),
        null,
      );
  const created = new Date(user.createdAt);
  return (
    <details className="field-admin-user">
      <summary>
        <span>
          <strong>{user.displayName}</strong>
          <small>
            {user.email || "No email"} ·{" "}
            {user.emailVerified ? "Verified" : "Unverified"} ·{" "}
            {lastActive(a, user)}
          </small>
        </span>
        <span className="admin-user-badges">
          {worst && (
            <span className="admin-badge" data-tone={worst === "at" ? "critical" : "warning"}>
              {worst === "at" ? "At limit" : "Near limit"}
            </span>
          )}
          <span
            className="admin-badge"
            data-tone={user.status === "active" ? "good" : "critical"}
          >
            {a.capitalize(user.status)}
          </span>
          <span className="admin-badge">{a.capitalize(user.tier)}</span>
          {user.isOwner && <span className="admin-badge">Owner</span>}
        </span>
      </summary>
      <div className="admin-user-usage">
        {premium ? (
          <>
            <div className="admin-resource">
              <div>
                <span>Reports this month</span>
                <strong>{user.savedReports.toLocaleString()}</strong>
              </div>
              <small>Unlimited on Premium</small>
            </div>
            <div className="admin-resource">
              <div>
                <span>AI tokens this month</span>
                <strong>{a.formatTokenCount(user.aiTokens)}</strong>
              </div>
              <small>Unlimited on Premium</small>
            </div>
          </>
        ) : (
          <>
            <UsageMeter
              label="Reports this month"
              used={user.savedReports}
              limit={reportLimit}
              custom={user.reportUsageLimitOverride !== null}
              format={(n) => n.toLocaleString()}
            />
            <UsageMeter
              label="AI tokens this month"
              used={user.aiTokens}
              limit={aiLimit}
              custom={user.aiTokenLimitOverride !== null}
              format={a.formatTokenCount}
            />
          </>
        )}
      </div>
      <p className="admin-user-meta">
        {user.activeSessions} active{" "}
        {user.activeSessions === 1 ? "session" : "sessions"}
        {user.authMethods.length > 0 &&
          ` · Signs in with ${user.authMethods.map(methodLabel).join(", ")}`}
        {!Number.isNaN(created.getTime()) &&
          ` · Joined ${created.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
      </p>
      <fieldset disabled={!!a.userActionPending}>
        <div className="field-action-row">
          <label className="field-form-label">
            Membership
            <select
              value={user.tier}
              disabled={user.isOwner}
              onChange={(e) =>
                void a.updateManagedUserTier(
                  user,
                  e.target.value as "free" | "premium",
                )
              }
            >
              <option value="free">Free</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          {!user.isOwner && (
            <>
              <button
                className="field-button"
                onClick={() =>
                  void a.updateManagedUserStatus(
                    user,
                    user.status === "active" ? "suspended" : "active",
                  )
                }
              >
                {user.status === "active"
                  ? "Suspend account"
                  : "Reactivate account"}
              </button>
              <button
                className="field-button"
                disabled={!user.activeSessions}
                onClick={() => void a.revokeManagedUserSessions(user)}
              >
                Sign out everywhere
              </button>
            </>
          )}
          {!user.emailVerified && (
            <button
              className="field-button"
              disabled={user.status !== "active" || !user.email}
              onClick={() => void a.sendManagedUserVerification(user)}
            >
              Send verification email
            </button>
          )}
          <button
            className="field-button"
            disabled={!user.aiTokens && !user.savedReports}
            onClick={() => void a.resetManagedUserUsage(user)}
          >
            Reset monthly usage
          </button>
        </div>
        {!premium && (
          <div className="field-admin-limits">
            <LimitEditor
              label="Monthly report limit"
              draft={a.userReportLimitDrafts[user.id]}
              saved={reportLimit}
              custom={user.reportUsageLimitOverride !== null}
              onDraft={(value) =>
                a.setUserReportLimitDrafts((v) => ({ ...v, [user.id]: value }))
              }
              onSave={(value) =>
                void a.updateManagedUserReportUsageLimit(user, value)
              }
              onReset={() => void a.updateManagedUserReportUsageLimit(user, null)}
            />
            <LimitEditor
              label="Monthly AI token limit"
              draft={a.userUsageLimitDrafts[user.id]}
              saved={aiLimit}
              custom={user.aiTokenLimitOverride !== null}
              onDraft={(value) =>
                a.setUserUsageLimitDrafts((v) => ({ ...v, [user.id]: value }))
              }
              onSave={(value) => void a.updateManagedUserUsageLimit(user, value)}
              onReset={() => void a.updateManagedUserUsageLimit(user, null)}
            />
          </div>
        )}
      </fieldset>
      <Details title="Account record" value={user} />
    </details>
  );
}

export function AdminUsers({ a }: { a: Administration }) {
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const settings = a.usageSettings;
  const allowancesChanged =
    !!settings &&
    (a.usageLimitDraft !== String(settings.freeMonthlyAITokenLimit) ||
      a.reportLimitDraft !== String(settings.freeMonthlyReportUsageLimit));
  const atDeploymentDefaults =
    !!settings &&
    settings.freeMonthlyAITokenLimit ===
      settings.environmentFreeMonthlyAITokenLimit &&
    settings.freeMonthlyReportUsageLimit ===
      settings.environmentFreeMonthlyReportUsageLimit;
  const filterCount = (value: string) =>
    value === "all"
      ? a.usersTotal
      : a.userSummary[value as keyof typeof a.userSummary];
  return (
    <>
      <section className="field-panel">
        <h2>
          Accounts <small>{a.usersTotal}</small>
        </h2>
        <div className="field-action-row admin-filters">
          <label className="field-form-label">
            Search accounts
            <input
              type="search"
              placeholder="Name, email, or sign-in method"
              value={a.userQuery}
              onChange={(e) => a.setUserQuery(e.target.value)}
            />
          </label>
          <label className="field-form-label">
            Account filter
            <select
              value={a.userStatusFilter}
              onChange={(e) =>
                a.setUserStatusFilter(
                  e.target.value as typeof a.userStatusFilter,
                )
              }
            >
              {a.USER_STATUS_FILTERS.map((f) => {
                const count = filterCount(f.value);
                return (
                  <option key={f.value} value={f.value}>
                    {f.label}
                    {!a.loading && !a.usersError && Number.isFinite(count)
                      ? ` (${count.toLocaleString()})`
                      : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            className="field-button"
            disabled={refreshingUsers || a.loading}
            onClick={async () => {
              setRefreshingUsers(true);
              try {
                await a.fetchUserDirectory();
              } finally {
                setRefreshingUsers(false);
              }
            }}
          >
            {refreshingUsers ? "Refreshing accounts…" : "Refresh accounts"}
          </button>
        </div>
        <AdminNotice message={a.usersError} />
        <AdminNotice message={a.usersNotice} tone="success" />
        <div className="admin-result-summary" role="status">
          <span>
            {a.loading
              ? "Loading accounts…"
              : `${a.filteredUsers.length} of ${a.users.length} loaded accounts`}
          </span>
          {(a.userQuery || a.userStatusFilter !== "all") && (
            <button
              className="field-text-button"
              onClick={() => {
                a.setUserQuery("");
                a.setUserStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {a.usersTotal > a.users.length && (
          <p className="field-muted">
            Search covers the {a.users.length} loaded accounts of {a.usersTotal}{" "}
            total.
          </p>
        )}
        {a.filteredUsers.map((user) => (
          <AccountRow a={a} user={user} key={user.id} />
        ))}
        {!a.loading && !a.usersError && !a.filteredUsers.length && (
          <div className="admin-empty">
            <p>
              {a.users.length
                ? "No accounts match these filters. Try another name or email."
                : "No accounts are available."}
            </p>
          </div>
        )}
      </section>
      <section className="field-panel">
        <h2>Free account allowances</h2>
        <p>
          Monthly defaults apply to accounts without individual overrides.
          Premium accounts have unlimited usage.
          {settings &&
            ` Deployment defaults: ${settings.environmentFreeMonthlyAITokenLimit.toLocaleString()} AI tokens and ${settings.environmentFreeMonthlyReportUsageLimit.toLocaleString()} reports.`}
        </p>
        <AdminNotice message={a.usageSettingsError} />
        {settings && !settings.persistent && (
          <AdminNotice message="Persistent storage is unavailable, so allowance changes last until the backend restarts." />
        )}
        <div className="field-action-row">
          <label className="field-form-label">
            AI tokens per month
            <input
              type="number"
              min="1"
              inputMode="numeric"
              max={settings?.maxMonthlyAITokenLimit}
              value={a.usageLimitDraft}
              onChange={(e) => a.setUsageLimitDraft(e.target.value)}
            />
          </label>
          <label className="field-form-label">
            Reports per month
            <input
              type="number"
              min="1"
              inputMode="numeric"
              max={settings?.maxFreeMonthlyUsageLimit}
              value={a.reportLimitDraft}
              onChange={(e) => a.setReportLimitDraft(e.target.value)}
            />
          </label>
          <button
            className="field-button field-button-primary"
            disabled={a.usageSettingsPending || !allowancesChanged}
            onClick={() => void a.updateDefaultUsageLimits()}
          >
            Save allowances
          </button>
          <button
            className="field-button"
            disabled={a.usageSettingsPending || !settings || atDeploymentDefaults}
            onClick={() =>
              settings &&
              void a.updateDefaultUsageLimits(
                String(settings.environmentFreeMonthlyAITokenLimit),
                String(settings.environmentFreeMonthlyReportUsageLimit),
              )
            }
          >
            Restore deployment defaults
          </button>
        </div>
        <details className="field-details">
          <summary>Bulk account maintenance</summary>
          <p>
            These actions affect all managed accounts and require confirmation.
          </p>
          <div className="field-action-row">
            <button
              className="field-button"
              disabled={!!a.userActionPending}
              onClick={() => void a.resetAllManagedUserUsageLimits()}
            >
              Clear individual limits
            </button>
            <button
              className="field-button"
              disabled={!!a.userActionPending}
              onClick={() => void a.resetAllManagedUserUsage()}
            >
              Reset current month usage
            </button>
          </div>
        </details>
      </section>
    </>
  );
}
