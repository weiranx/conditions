import { useId, useState, type FormEvent } from "react";
import { Check, Compass, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { ActivityType, UserPreferences } from "../app/types";
import type { Workspace } from "./model/useWorkspace";
import {
  ACTIVITY_PROFILES,
  ACTIVITY_PROFILE_ORDER,
} from "../app/activity-profiles";
import {
  MAX_CUSTOM_ACTIVITIES,
  MAX_CUSTOM_ACTIVITY_LABEL_LENGTH,
  activeActivityKey,
  activeActivityLabel,
  createCustomActivityPatch,
  defaultRouteTimingForKey,
  deleteCustomActivityPatch,
  findCustomActivity,
  pickRouteTiming,
  renameCustomActivityPatch,
  sameRouteTiming,
} from "../app/activity-limits";
import { ROUTE_TIMING_BOUNDS } from "../app/preferences";
import { NumberField, Row, Thresholds } from "./Thresholds";
import { Account } from "./Account";
import { useAccount } from "../hooks/useAccount";
import { ACTIVITY_ICONS } from "./sky/activity-icons";
import "./settings.css";

const ROUTE_TIMING_FIELDS = [
  { key: "runnerPaceMinutesPerMile", label: "Travel pace", unit: "min/mi" },
  { key: "runnerAscentMinutesPer1000Ft", label: "Ascent", unit: "min/1,000 ft" },
  { key: "runnerStopBufferMinutes", label: "Stops and transitions", unit: "min" },
] as const;

/** Pace, climbing rate and stop time for the selected activity; each activity keeps its own. */
function RouteTiming({ workspace: w, idPrefix }: { workspace: Workspace; idPrefix: string }) {
  const p = w.preferences;
  const key = activeActivityKey(p);
  const custom = findCustomActivity(p, key);
  const defaults = defaultRouteTimingForKey(p, key);
  const atDefaults = sameRouteTiming(pickRouteTiming(p), defaults);
  const defaultsLabel = ACTIVITY_PROFILES[custom ? custom.baseActivity : p.defaultActivity].label.toLowerCase();
  return (
    <>
      <div className="sky-thresholds-activity">
        <p>
          <span>Timing for <strong>{activeActivityLabel(p)}</strong></span>
          <small>{atDefaults ? `Using the ${defaultsLabel} defaults` : "Adjusted by you"}</small>
        </p>
        {!atDefaults && (
          <button type="button" className="field-button sky-thresholds-reset" onClick={() => w.updatePreferences(defaults)}>
            <RotateCcw size={14} aria-hidden="true" />
            Reset to {defaultsLabel} defaults
          </button>
        )}
      </div>
      <div className="sky-setting-group">
        {ROUTE_TIMING_FIELDS.map((item) => {
          const [min, max] = ROUTE_TIMING_BOUNDS[item.key];
          return (
            <Row key={item.key} label={item.label} htmlFor={`${idPrefix}-${item.key}`}>
              <NumberField id={`${idPrefix}-${item.key}`} value={p[item.key]} unit={item.unit} min={min} max={max}
                onChange={(e) => {
                  if (e.target.value !== "")
                    w.updatePreferences({ [item.key]: Math.min(max, Math.max(min, Number(e.target.value))) });
                }} />
            </Row>
          );
        })}
      </div>
    </>
  );
}

/**
 * Every activity, built-in or the user's own, as one grid of cards. Choosing
 * a card loads that activity's weather limits and route timing into the
 * editors below it; the last card creates a new activity in place.
 */
function ActivityPicker({ workspace: w }: { workspace: Workspace }) {
  const id = useId();
  const p = w.preferences;
  const activityKey = activeActivityKey(p);
  const selectedCustom = findCustomActivity(p, activityKey);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState<ActivityType>(p.defaultActivity);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const full = p.customActivities.length >= MAX_CUSTOM_ACTIVITIES;

  const create = (event: FormEvent) => {
    event.preventDefault();
    const patch = createCustomActivityPatch(p, name, base);
    if (!patch) return;
    w.updatePreferences(patch);
    setName("");
    setCreating(false);
  };
  const commitRename = () => {
    if (selectedCustom && renameDraft !== null) {
      const patch = renameCustomActivityPatch(p, selectedCustom.id, renameDraft);
      if (patch) w.updatePreferences(patch);
    }
    setRenameDraft(null);
  };

  return (
    <>
      <div className="field-profile-options sky-profile-grid" role="group" aria-label="Activity">
        {ACTIVITY_PROFILE_ORDER.map((key) => {
          const Icon = ACTIVITY_ICONS[key] || Compass;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={activityKey === key}
              onClick={() => w.updatePreferences({ defaultActivity: key, customActivityId: null })}
            >
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <strong>{ACTIVITY_PROFILES[key].label}</strong>
              <small>{ACTIVITY_PROFILES[key].description}</small>
            </button>
          );
        })}
        {p.customActivities.map((custom) => {
          const Icon = ACTIVITY_ICONS[custom.baseActivity] || Compass;
          return (
            <button
              key={custom.id}
              type="button"
              aria-pressed={activityKey === custom.id}
              onClick={() => {
                setRenameDraft(null);
                w.updatePreferences({ defaultActivity: custom.baseActivity, customActivityId: custom.id });
              }}
            >
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <strong>{custom.label}</strong>
              <small>Your activity · planned like {ACTIVITY_PROFILES[custom.baseActivity].label.toLowerCase()}</small>
            </button>
          );
        })}
        {!full && !creating && (
          <button
            type="button"
            className="sky-profile-new"
            onClick={() => {
              setBase(p.defaultActivity);
              setCreating(true);
            }}
          >
            <Plus size={22} strokeWidth={1.7} aria-hidden="true" />
            <strong>New activity</strong>
            <small>Name the way you travel and give it its own limits and pace.</small>
          </button>
        )}
      </div>

      {creating && (
        <form className="sky-card sky-custom-activity-form" onSubmit={create} aria-label="New activity">
          <label htmlFor={`${id}-name`}>
            Name
            <input
              id={`${id}-name`}
              type="text"
              autoFocus
              placeholder="e.g. Winter peak bagging"
              maxLength={MAX_CUSTOM_ACTIVITY_LABEL_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-base`}>
            Plan it like
            <select id={`${id}-base`} value={base} onChange={(e) => setBase(e.target.value as ActivityType)}>
              {ACTIVITY_PROFILE_ORDER.map((key) => (
                <option key={key} value={key}>{ACTIVITY_PROFILES[key].label}</option>
              ))}
            </select>
          </label>
          <p className="sky-setting-footnote">
            It starts with your {ACTIVITY_PROFILES[base].label.toLowerCase()} limits and route timing. Change them below once
            it is created.
          </p>
          <div className="sky-toolbar-actions">
            <button type="submit" className="field-button field-button-primary" disabled={!name.trim()}>
              Create activity
            </button>
            <button type="button" className="field-button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {full && (
        <p className="sky-setting-footnote">You can keep up to {MAX_CUSTOM_ACTIVITIES} activities of your own. Delete one to add another.</p>
      )}

      {selectedCustom && !creating && (
        <div className="sky-setting-group sky-custom-activity-bar">
          <Row label="Name" htmlFor={`${id}-rename`}>
            <span className="sky-custom-activity-edit">
              <input
                id={`${id}-rename`}
                type="text"
                maxLength={MAX_CUSTOM_ACTIVITY_LABEL_LENGTH}
                value={renameDraft ?? selectedCustom.label}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenameDraft(null);
                }}
              />
              <button
                type="button"
                className="field-button sky-delete-activity"
                onClick={() => {
                  if (window.confirm(`Delete "${selectedCustom.label}" and its limits?`)) {
                    setRenameDraft(null);
                    w.updatePreferences(deleteCustomActivityPatch(p, selectedCustom.id));
                  }
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                Delete
              </button>
            </span>
          </Row>
        </div>
      )}
    </>
  );
}

/** Two to three choices shown side by side, like iOS settings. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="sky-segmented sky-setting-segmented" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} aria-pressed={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Settings({
  preferences: p,
  onChange,
  accountOnly = false,
  workspace: w,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
  accountOnly?: boolean;
  workspace: Workspace;
}) {
  const account = useAccount();
  const sectionId = useId();
  const sample = [
    { label: "Wind gust", value: w.formatWindDisplay(32), pass: 32 < p.maxWindGustMph },
    { label: "Rain or snow chance", value: "5%", pass: 5 < p.maxPrecipChance },
    { label: "Cold exposure", value: w.formatTempDisplay(16), pass: 16 > p.minFeelsLikeF },
    { label: "Heat exposure", value: w.formatTempDisplay(71), pass: 71 < p.maxFeelsLikeF },
  ];
  const sections = [
    ["display", "Display"],
    ["plan", "Default plan"],
    ["weather", "Activities and limits"],
    ["route", "Route timing"],
    ["save", "Save and apply"],
  ] as const;
  return (
    <div className={`field-settings sky-screen${accountOnly ? " sky-account-screen" : " sky-settings"}`}>
      <header className="field-page-heading">
        <span className="field-kicker">Settings</span>
        <h1>{accountOnly ? "Your account" : "Preferences"}</h1>
        {accountOnly ? (
          <p className="sky-lead"><span className="sky-lead-note">Your profile, sign-in, allowances and connected apps.</span></p>
        ) : (
          <p className="sky-lead">
            You plan as <strong>{activeActivityLabel(p)}</strong> for{" "}
            <strong>{p.travelWindowHours} hours</strong> from <strong>{w.formatClockForStyle(p.defaultStartTime, p.timeStyle)}</strong>, turning back when gusts pass{" "}
            <strong>{w.formatWindDisplay(p.maxWindGustMph)}</strong>, rain chance passes <strong>{p.maxPrecipChance}%</strong>, or it feels colder than{" "}
            <strong>{w.formatTempDisplay(p.minFeelsLikeF)}</strong>.
          </p>
        )}
      </header>
      {!accountOnly && (
        <nav className="field-settings-shortcuts" aria-label="Preference sections">
          {sections.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                const section = document.getElementById(`${sectionId}-${key}`);
                section?.scrollIntoView({ block: "start", behavior: "instant" });
                section?.focus({ preventScroll: true });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {accountOnly ? (
        <Account workspace={w} />
      ) : (
        <div className="sky-settings-body">
          <section id={`${sectionId}-display`} tabIndex={-1} aria-labelledby={`${sectionId}-display-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-display-h`}>Display</h2>
            <div className="sky-setting-group">
              <Row label="Appearance">
                <Segmented label="Appearance" value={p.themeMode} options={[["system", "Auto"], ["light", "Light"], ["dark", "Dark"]] as const}
                  onChange={(value) => onChange({ ...p, themeMode: value })} />
              </Row>
              <Row label="Temperature">
                <Segmented label="Temperature" value={p.temperatureUnit} options={[["f", "°F"], ["c", "°C"]] as const}
                  onChange={(value) => onChange({ ...p, temperatureUnit: value })} />
              </Row>
              <Row label="Wind speed">
                <Segmented label="Wind speed" value={p.windSpeedUnit} options={[["mph", "mph"], ["kph", "km/h"]] as const}
                  onChange={(value) => onChange({ ...p, windSpeedUnit: value })} />
              </Row>
              <Row label="Elevation and distance">
                <Segmented label="Elevation and distance" value={p.elevationUnit} options={[["ft", "ft · mi"], ["m", "m · km"]] as const}
                  onChange={(value) => w.handleElevationUnitChange(value)} />
              </Row>
              <Row label="Clock">
                <Segmented label="Clock" value={p.timeStyle} options={[["ampm", "12-hour"], ["24h", "24-hour"]] as const}
                  onChange={(value) => onChange({ ...p, timeStyle: value })} />
              </Row>
            </div>
          </section>

          <section id={`${sectionId}-plan`} tabIndex={-1} aria-labelledby={`${sectionId}-plan-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-plan-h`}>Default plan</h2>
            <div className="sky-setting-group">
              <Row label="Departure time" htmlFor={`${sectionId}-start`}>
                <input
                  id={`${sectionId}-start`}
                  className="sky-time-field"
                  type="time"
                  onInput={(e) => w.handlePreferenceTimeChange("defaultStartTime", e.currentTarget.value)}
                  value={p.defaultStartTime}
                  onChange={(e) => w.handlePreferenceTimeChange("defaultStartTime", e.target.value)}
                />
              </Row>
              <Row label="Travel window" htmlFor={`${sectionId}-hours`}>
                <NumberField id={`${sectionId}-hours`} value={w.travelWindowHoursDraft} unit="hours" min={1} max={24}
                  onChange={w.handleTravelWindowHoursDraftChange} onBlur={w.handleTravelWindowHoursDraftBlur} />
              </Row>
            </div>
          </section>

          <section id={`${sectionId}-weather`} tabIndex={-1} aria-labelledby={`${sectionId}-weather-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-weather-h`}>Activities and limits</h2>
            <p className="sky-setting-footnote is-above">
              Each activity remembers its own weather limits and route timing. Pick one to see or change them; the
              planner uses the settings of the activity you plan with.
            </p>
            <ActivityPicker workspace={w} />
            <Thresholds workspace={w} />
            <h3 className="sky-setting-subhead">Approach</h3>
            <div className="sky-setting-group">
              <Row label="Check the approach at trailhead elevation"
                hint="The forecast is for the objective. While you climb from the trailhead, your limits are checked at your estimated elevation. Rain and storm signals are never adjusted; clear, calm mornings treat the valley as colder in case of an inversion.">
                <label className="sky-switch">
                  <input type="checkbox" aria-label="Check the approach at trailhead elevation"
                    checked={p.approachElevationAdjustment}
                    onChange={(e) => w.updatePreferences({ approachElevationAdjustment: e.target.checked })} />
                  <span aria-hidden="true" />
                </label>
              </Row>
            </div>
            <h3 className="sky-setting-subhead">On a sample hour</h3>
            <div className="sky-setting-group">
              {sample.map((row) => (
                <Row key={row.label} label={row.label} hint={row.value}>
                  <span className={`sky-status is-${row.pass ? "ok" : "over"}`}>
                    {row.pass ? <Check size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}
                    {row.pass ? "Within limit" : "Over limit"}
                  </span>
                </Row>
              ))}
            </div>
            <p className="sky-setting-footnote">Illustrative values, not a forecast.</p>
          </section>

          <section id={`${sectionId}-route`} tabIndex={-1} aria-labelledby={`${sectionId}-route-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-route-h`}>Route timing</h2>
            <RouteTiming workspace={w} idPrefix={sectionId} />
            <p className="sky-setting-footnote">
              Used to estimate when your party reaches GPX checkpoints and how high you are during the approach. Choose
              another activity above to set its timing.
            </p>
          </section>

          <section id={`${sectionId}-save`} tabIndex={-1} aria-labelledby={`${sectionId}-save-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-save-h`}>Save and apply</h2>
            <div className="sky-card sky-save-card">
              <p className="sky-cap is-body">
                {account.user
                  ? `Account sync: ${account.preferenceSyncState}`
                  : "Saved automatically on this browser."}
              </p>
              {account.preferenceError && (
                <p className="sky-notice is-caution" role="alert">
                  {account.preferenceError}
                </p>
              )}
              <div className="sky-toolbar-actions">
                <button className="field-button field-button-primary" onClick={w.applyPreferencesToPlanner}>
                  Apply to planner
                </button>
                <button className="field-button" onClick={w.resetPreferences}>
                  Reset defaults
                </button>
                {account.user && account.preferenceSyncState === "error" && (
                  <button className="field-button" onClick={() => void account.savePreferences(p).catch(() => undefined)}>
                    Retry sync
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
