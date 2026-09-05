import type { Administration } from "./model/useAdministration";
import { AdminNotice } from "./Administration";
import { Details } from "./Details";
export function AdminUsers({ a }: { a: Administration }) {
  return (
    <>
      <section className="field-panel">
        <h2>Free account allowances</h2>
        <p>
          Monthly defaults apply to accounts without individual overrides.
          Premium accounts have unlimited usage.
        </p>
        <AdminNotice message={a.usageSettingsError} />
        <div className="field-action-row">
          <label className="field-form-label">
            AI tokens per month
            <input
              type="number"
              min="0"
              max={a.usageSettings?.maxMonthlyAITokenLimit}
              value={a.usageLimitDraft}
              onChange={(e) => a.setUsageLimitDraft(e.target.value)}
            />
          </label>
          <label className="field-form-label">
            Reports per month
            <input
              type="number"
              min="0"
              max={a.usageSettings?.maxFreeMonthlyUsageLimit}
              value={a.reportLimitDraft}
              onChange={(e) => a.setReportLimitDraft(e.target.value)}
            />
          </label>
          <button
            className="field-button field-button-primary"
            disabled={a.usageSettingsPending || !a.usageSettings}
            onClick={() => void a.updateDefaultUsageLimits()}
          >
            Save allowances
          </button>
          <button
            className="field-button"
            disabled={a.usageSettingsPending || !a.usageSettings}
            onClick={() =>
              a.usageSettings &&
              void a.updateDefaultUsageLimits(
                String(a.usageSettings.environmentFreeMonthlyAITokenLimit),
                String(a.usageSettings.environmentFreeMonthlyReportUsageLimit),
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
      <section className="field-panel">
        <h2>
          Accounts <small>{a.usersTotal}</small>
        </h2>
        <div className="field-action-row">
          <label className="field-form-label">
            Search accounts
            <input
              type="search"
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
              {a.USER_STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="field-button"
            onClick={() => void a.fetchUserDirectory()}
          >
            Refresh accounts
          </button>
        </div>
        <AdminNotice message={a.usersError || a.usersNotice} />
        {a.filteredUsers.map((user) => {
          const disabled = !!a.userActionPending;
          const aiLimit =
            a.userUsageLimitDrafts[user.id] ??
            String(
              user.aiTokenLimitOverride ??
                a.usageSettings?.freeMonthlyAITokenLimit ??
                250000,
            );
          const reportLimit =
            a.userReportLimitDrafts[user.id] ??
            String(
              user.reportUsageLimitOverride ??
                a.usageSettings?.freeMonthlyReportUsageLimit ??
                50,
            );
          return (
            <details className="field-admin-user" key={user.id}>
              <summary>
                <span>
                  <strong>{user.displayName}</strong>
                  <small>
                    {user.email || "No email"} ·{" "}
                    {user.emailVerified ? "Verified" : "Unverified"}
                  </small>
                </span>
                <span>
                  {user.tier} · {user.status}
                  {user.isOwner ? " · Owner" : ""}
                </span>
              </summary>
              <p>
                {a.formatTokenCount(user.aiTokens)} AI tokens ·{" "}
                {user.savedReports} reports · {user.activeSessions} sessions ·
                Active {a.formatAccountDate(user.lastActivityAt)}
              </p>
              <fieldset disabled={disabled}>
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
                        Revoke sessions
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
                {user.tier !== "premium" && (
                  <div className="field-admin-limits">
                    <label className="field-form-label">
                      Monthly AI token limit
                      <input
                        type="number"
                        min="0"
                        value={aiLimit}
                        onChange={(e) =>
                          a.setUserUsageLimitDrafts((v) => ({
                            ...v,
                            [user.id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      className="field-button"
                      disabled={!aiLimit.trim()}
                      onClick={() =>
                        void a.updateManagedUserUsageLimit(
                          user,
                          Number(aiLimit),
                        )
                      }
                    >
                      Save AI limit
                    </button>
                    <button
                      className="field-button"
                      disabled={user.aiTokenLimitOverride === null}
                      onClick={() =>
                        void a.updateManagedUserUsageLimit(user, null)
                      }
                    >
                      Use default AI limit
                    </button>
                    <label className="field-form-label">
                      Monthly report limit
                      <input
                        type="number"
                        min="0"
                        value={reportLimit}
                        onChange={(e) =>
                          a.setUserReportLimitDrafts((v) => ({
                            ...v,
                            [user.id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      className="field-button"
                      disabled={!reportLimit.trim()}
                      onClick={() =>
                        void a.updateManagedUserReportUsageLimit(
                          user,
                          Number(reportLimit),
                        )
                      }
                    >
                      Save report limit
                    </button>
                    <button
                      className="field-button"
                      disabled={user.reportUsageLimitOverride === null}
                      onClick={() =>
                        void a.updateManagedUserReportUsageLimit(user, null)
                      }
                    >
                      Use default report limit
                    </button>
                  </div>
                )}
              </fieldset>
              <Details title="Account details" value={user} />
            </details>
          );
        })}
        {!a.filteredUsers.length && <p>No accounts match this filter.</p>}
      </section>
    </>
  );
}
