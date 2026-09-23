import { useId, type ChangeEvent, type FocusEvent } from "react";
import { Check, Compass, TriangleAlert } from "lucide-react";
import type { UserPreferences } from "../app/types";
import type { Workspace } from "./model/useWorkspace";
import {
  ACTIVITY_PROFILES,
  ACTIVITY_PROFILE_ORDER,
} from "../app/activity-profiles";
import { TRAVEL_THRESHOLD_PRESETS } from "../hooks/usePreferenceHandlers";
import { Account } from "./Account";
import { useAccount } from "../hooks/useAccount";
import { ACTIVITY_ICONS } from "./sky/activity-icons";
import "./settings.css";

/** A settings row: the label on the left, its control on the right. */
function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="sky-setting-row">
      <div className="sky-setting-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {hint && <small>{hint}</small>}
      </div>
      <div className="sky-setting-control">{children}</div>
    </div>
  );
}

function NumberField({ id, value, unit, min, max, step, onChange, onBlur }: {
  id: string;
  value: string | number;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <span className="sky-number-field">
      <input id={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} onChange={onChange} onBlur={onBlur} />
      <span aria-hidden="true">{unit}</span>
    </span>
  );
}

export function Thresholds({ workspace: w }: { workspace: Workspace }) {
  const id = useId();
  const limits = [
    {
      label: "Wind gusts up to",
      unit: w.windUnitLabel,
      value: w.maxWindGustDraft,
      min: w.windThresholdMin,
      max: w.windThresholdMax,
      step: w.windThresholdStep,
      onChange: w.handleWindThresholdDisplayChange,
      onBlur: w.handleWindThresholdDisplayBlur,
    },
    {
      label: "Rain or snow chance up to",
      unit: "%",
      value: w.maxPrecipChanceDraft,
      min: 0,
      max: 100,
      step: 1,
      onChange: w.handleMaxPrecipChanceDraftChange,
      onBlur: w.handleMaxPrecipChanceDraftBlur,
    },
    {
      label: "Feels-like at least",
      unit: w.tempUnitLabel,
      value: w.minFeelsLikeDraft,
      min: w.feelsLikeThresholdMin,
      max: w.feelsLikeThresholdMax,
      step: w.feelsLikeThresholdStep,
      onChange: w.handleFeelsLikeThresholdDisplayChange,
      onBlur: w.handleFeelsLikeThresholdDisplayBlur,
    },
    {
      label: "Feels-like at most",
      unit: w.tempUnitLabel,
      value: w.maxFeelsLikeDraft,
      min: w.heatCeilingMin,
      max: w.heatCeilingMax,
      step: w.feelsLikeThresholdStep,
      onChange: w.handleHeatCeilingDisplayChange,
      onBlur: w.handleHeatCeilingDisplayBlur,
    },
  ];
  return (
    <div className="sky-thresholds">
      <div
        className="field-preset-list sky-preset-row"
        role="group"
        aria-label="Weather threshold presets"
      >
        {Object.entries(TRAVEL_THRESHOLD_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            aria-pressed={w.activeTravelThresholdPreset === key}
            onClick={() =>
              w.handleApplyTravelThresholdPreset(
                key as keyof typeof TRAVEL_THRESHOLD_PRESETS,
              )
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="sky-setting-group">
        {limits.map((limit, index) => (
          <Row key={limit.label} label={limit.label} htmlFor={`${id}-${index}`}>
            <NumberField id={`${id}-${index}`} value={limit.value} unit={limit.unit} min={limit.min} max={limit.max}
              step={limit.step} onChange={limit.onChange} onBlur={limit.onBlur} />
          </Row>
        ))}
      </div>
      <p className="sky-setting-footnote">
        Planning thresholds guide the hourly assessment; they do not define safe
        conditions.
      </p>
    </div>
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
  const activity = ACTIVITY_PROFILES[p.defaultActivity];
  const sample = [
    { label: "Wind gust", value: w.formatWindDisplay(32), pass: 32 < p.maxWindGustMph },
    { label: "Rain or snow chance", value: "5%", pass: 5 < p.maxPrecipChance },
    { label: "Cold exposure", value: w.formatTempDisplay(16), pass: 16 > p.minFeelsLikeF },
    { label: "Heat exposure", value: w.formatTempDisplay(71), pass: 71 < p.maxFeelsLikeF },
  ];
  const sections = [
    ["display", "Display"],
    ["plan", "Default plan"],
    ["weather", "Weather limits"],
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
            You plan as <strong>{activity?.label || "a backcountry traveller"}</strong> for{" "}
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
            <h3 className="sky-setting-subhead">Activity</h3>
            <p className="sky-setting-footnote is-above">Choosing an activity sets its limits and route pace. You can still adjust each value.</p>
            <div className="field-profile-options sky-profile-grid" role="group" aria-label="Activity profile">
              {ACTIVITY_PROFILE_ORDER.map((key) => {
                const Icon = ACTIVITY_ICONS[key] || Compass;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={p.defaultActivity === key}
                    onClick={() => w.updatePreferences(ACTIVITY_PROFILES[key].preferencePatch)}
                  >
                    <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                    <strong>{ACTIVITY_PROFILES[key].label}</strong>
                    <small>{ACTIVITY_PROFILES[key].description}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section id={`${sectionId}-weather`} tabIndex={-1} aria-labelledby={`${sectionId}-weather-h`} className="sky-setting-section">
            <h2 id={`${sectionId}-weather-h`}>Weather limits</h2>
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
            <div className="sky-setting-group">
              {(
                [
                  { key: "runnerPaceMinutesPerMile", label: "Travel pace", unit: "min/mi", min: 5, max: 90 },
                  { key: "runnerAscentMinutesPer1000Ft", label: "Ascent", unit: "min/1,000 ft", min: 0, max: 120 },
                  { key: "runnerStopBufferMinutes", label: "Stops and transitions", unit: "min", min: 0, max: 240 },
                ] as const
              ).map((item) => (
                <Row key={item.key} label={item.label} htmlFor={`${sectionId}-${item.key}`}>
                  <NumberField id={`${sectionId}-${item.key}`} value={p[item.key]} unit={item.unit} min={item.min} max={item.max}
                    onChange={(e) => {
                      if (e.target.value !== "")
                        w.updatePreferences({
                          [item.key]: Math.min(item.max, Math.max(item.min, Number(e.target.value))),
                        });
                    }} />
                </Row>
              ))}
            </div>
            <p className="sky-setting-footnote">Used to estimate when your party reaches GPX checkpoints.</p>
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
