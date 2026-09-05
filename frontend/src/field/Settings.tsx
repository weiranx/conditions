import { useId } from "react";
import type { UserPreferences } from "../app/types";
import type { Workspace } from "./model/useWorkspace";
import {
  ACTIVITY_PROFILES,
  ACTIVITY_PROFILE_ORDER,
} from "../app/activity-profiles";
import { TRAVEL_THRESHOLD_PRESETS } from "../hooks/usePreferenceHandlers";
import { Account } from "./Account";
import { useAccount } from "../hooks/useAccount";

export function Thresholds({ workspace: w }: { workspace: Workspace }) {
  const limits = [
    {
      label: `Wind gust ceiling (${w.windUnitLabel})`,
      value: w.maxWindGustDraft,
      min: w.windThresholdMin,
      max: w.windThresholdMax,
      step: w.windThresholdStep,
      onChange: w.handleWindThresholdDisplayChange,
      onBlur: w.handleWindThresholdDisplayBlur,
    },
    {
      label: "Precipitation chance ceiling (%)",
      value: w.maxPrecipChanceDraft,
      min: 0,
      max: 100,
      step: 1,
      onChange: w.handleMaxPrecipChanceDraftChange,
      onBlur: w.handleMaxPrecipChanceDraftBlur,
    },
    {
      label: `Feels-like floor (${w.tempUnitLabel})`,
      value: w.minFeelsLikeDraft,
      min: w.feelsLikeThresholdMin,
      max: w.feelsLikeThresholdMax,
      step: w.feelsLikeThresholdStep,
      onChange: w.handleFeelsLikeThresholdDisplayChange,
      onBlur: w.handleFeelsLikeThresholdDisplayBlur,
    },
    {
      label: `Heat ceiling (${w.tempUnitLabel})`,
      value: w.maxFeelsLikeDraft,
      min: w.heatCeilingMin,
      max: w.heatCeilingMax,
      step: w.feelsLikeThresholdStep,
      onChange: w.handleHeatCeilingDisplayChange,
      onBlur: w.handleHeatCeilingDisplayBlur,
    },
  ];
  return (
    <div>
      <div
        className="field-preset-list"
        role="group"
        aria-label="Weather threshold presets"
      >
        {Object.entries(TRAVEL_THRESHOLD_PRESETS).map(([key, preset]) => (
          <button
            key={key}
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
      <div className="field-settings-inputs">
        {limits.map((limit) => (
          <label key={limit.label}>
            {limit.label}
            <input
              type="number"
              value={limit.value}
              min={limit.min}
              max={limit.max}
              step={limit.step}
              onChange={limit.onChange}
              onBlur={limit.onBlur}
            />
          </label>
        ))}
      </div>
      <p className="field-muted">
        Planning thresholds guide the hourly assessment; they do not define safe
        conditions.
      </p>
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
  return (
    <div className="field-settings">
      <header className="field-page-heading">
        <span className="field-kicker">Settings</span>
        <h1>{accountOnly ? "Your account" : "Planning preferences"}</h1>
        <p>
          {accountOnly
            ? "Your profile, saved preferences, and monthly allowances."
            : "Make the tool work for your activity, units, and travel pace."}
        </p>
      </header>
      {!accountOnly && (
        <nav className="field-settings-shortcuts" aria-label="Preference sections">
          {[
            ["display", "Display"],
            ["plan", "Default plan"],
            ["weather", "Weather limits"],
            ["route", "Route timing"],
            ["save", "Save and apply"],
          ].map(([key, label]) => (
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
        <div className="field-settings-layout">
          <div>
            <section id={`${sectionId}-display`} tabIndex={-1} aria-label="Display" className="field-panel field-settings-panel">
              <h2>Display</h2>
              {(
                [
                  {
                    key: "themeMode",
                    label: "Appearance",
                    options: [
                      ["system", "Match device"],
                      ["light", "Light"],
                      ["dark", "Dark"],
                    ],
                  },
                  {
                    key: "temperatureUnit",
                    label: "Temperature",
                    options: [
                      ["f", "Fahrenheit · °F"],
                      ["c", "Celsius · °C"],
                    ],
                  },
                  {
                    key: "windSpeedUnit",
                    label: "Wind speed",
                    options: [
                      ["mph", "Miles per hour"],
                      ["kph", "Kilometers per hour"],
                    ],
                  },
                  {
                    key: "elevationUnit",
                    label: "Elevation and distance",
                    options: [
                      ["ft", "Feet and miles"],
                      ["m", "Meters and kilometers"],
                    ],
                  },
                  {
                    key: "timeStyle",
                    label: "Clock",
                    options: [
                      ["ampm", "12 hour"],
                      ["24h", "24 hour"],
                    ],
                  },
                ] as const
              ).map((item) => (
                <div className="field-setting-row" key={item.key}>
                  <h3>{item.label}</h3>
                  <select
                    aria-label={item.label}
                    value={p[item.key]}
                    onChange={(e) => {
                      if (item.key === "elevationUnit")
                        w.handleElevationUnitChange(
                          e.target.value as "m" | "ft",
                        );
                      else onChange({ ...p, [item.key]: e.target.value });
                    }}
                  >
                    {item.options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
            <section id={`${sectionId}-plan`} tabIndex={-1} aria-label="Default plan" className="field-panel field-settings-panel">
              <h2>Default plan</h2>
              <div className="field-settings-inputs">
                <label>
                  Departure time
                  <input
                    type="time"
                    onInput={(e) =>
                      w.handlePreferenceTimeChange(
                        "defaultStartTime",
                        e.currentTarget.value,
                      )
                    }
                    value={p.defaultStartTime}
                    onChange={(e) =>
                      w.handlePreferenceTimeChange(
                        "defaultStartTime",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  Travel window (hours)
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={w.travelWindowHoursDraft}
                    onChange={w.handleTravelWindowHoursDraftChange}
                    onBlur={w.handleTravelWindowHoursDraftBlur}
                  />
                </label>
              </div>
              <h3 className="field-subtitle">Activity profile</h3>
              <p>
                Applying a profile sets its planning thresholds and route pace.
                You can adjust each value below.
              </p>
              <div
                className="field-profile-options"
                role="group"
                aria-label="Activity profile"
              >
                {ACTIVITY_PROFILE_ORDER.map((key) => (
                  <button
                    key={key}
                    aria-pressed={p.defaultActivity === key}
                    onClick={() =>
                      w.updatePreferences(
                        ACTIVITY_PROFILES[key].preferencePatch,
                      )
                    }
                  >
                    <strong>{ACTIVITY_PROFILES[key].label}</strong>
                    <small>{ACTIVITY_PROFILES[key].description}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
          <div>
            <section id={`${sectionId}-weather`} tabIndex={-1} aria-label="Weather thresholds" className="field-panel field-settings-panel">
              <h2>Weather thresholds</h2>
              <Thresholds workspace={w} />
              <details className="field-details">
                <summary>Try the thresholds on a sample hour</summary>
                <p className="field-muted">
                  Illustrative values, not a forecast. Adjust your thresholds to
                  see which checks pass.
                </p>
                {[
                  {
                    label: "Wind gust",
                    value: w.formatWindDisplay(32),
                    pass: 32 < p.maxWindGustMph,
                  },
                  {
                    label: "Precipitation chance",
                    value: "5%",
                    pass: 5 < p.maxPrecipChance,
                  },
                  {
                    label: "Cold exposure",
                    value: w.formatTempDisplay(16),
                    pass: 16 > p.minFeelsLikeF,
                  },
                  {
                    label: "Heat exposure",
                    value: w.formatTempDisplay(71),
                    pass: 71 < p.maxFeelsLikeF,
                  },
                ].map((row) => (
                  <div className="field-setting-row" key={row.label}>
                    <span>
                      {row.label} · {row.value}
                    </span>
                    <strong>{row.pass ? "Within limit" : "Review"}</strong>
                  </div>
                ))}
              </details>
            </section>
            <section id={`${sectionId}-route`} tabIndex={-1} aria-label="Route timing" className="field-panel field-settings-panel">
              <h2>Route timing</h2>
              <p>Used to estimate GPX checkpoint arrivals for your party.</p>
              <div className="field-settings-inputs">
                {(
                  [
                    {
                      key: "runnerPaceMinutesPerMile",
                      label: "Travel pace (min/mile)",
                      min: 5,
                      max: 90,
                    },
                    {
                      key: "runnerAscentMinutesPer1000Ft",
                      label: "Ascent (min/1,000 ft)",
                      min: 0,
                      max: 120,
                    },
                    {
                      key: "runnerStopBufferMinutes",
                      label: "Stops and transitions (minutes)",
                      min: 0,
                      max: 240,
                    },
                  ] as const
                ).map((item) => (
                  <label key={item.key}>
                    {item.label}
                    <input
                      type="number"
                      min={item.min}
                      max={item.max}
                      value={p[item.key]}
                      onChange={(e) => {
                        if (e.target.value !== "")
                          w.updatePreferences({
                            [item.key]: Math.min(
                              item.max,
                              Math.max(item.min, Number(e.target.value)),
                            ),
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
            </section>
            <section id={`${sectionId}-save`} tabIndex={-1} aria-label="Save and apply" className="field-panel">
              <h2>Save and apply</h2>
              <p>
                {account.user
                  ? `Account sync: ${account.preferenceSyncState}`
                  : "Saved automatically on this browser."}
              </p>
              {account.preferenceError && (
                <p className="field-warning" role="alert">
                  {account.preferenceError}
                </p>
              )}
              <div className="field-action-row">
                <button
                  className="field-button field-button-primary"
                  onClick={w.applyPreferencesToPlanner}
                >
                  Apply to planner
                </button>
                <button className="field-button" onClick={w.resetPreferences}>
                  Reset defaults
                </button>
                {account.user && account.preferenceSyncState === "error" && (
                  <button
                    className="field-button"
                    onClick={() =>
                      void account.savePreferences(p).catch(() => undefined)
                    }
                  >
                    Retry sync
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
