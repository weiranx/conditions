import { useId, type ChangeEvent, type FocusEvent } from "react";
import { RotateCcw } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { ACTIVITY_PROFILES } from "../app/activity-profiles";
import {
  activeActivityKey,
  activeActivityLabel,
  defaultLimitsForKey,
  findCustomActivity,
  pickActivityLimits,
  sameActivityLimits,
} from "../app/activity-limits";
import { TRAVEL_THRESHOLD_PRESETS } from "../hooks/usePreferenceHandlers";
import "./settings.css";

/** A settings row: the label on the left, its control on the right. */
export function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
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

export function NumberField({ id, value, unit, min, max, step, onChange, onBlur }: {
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

export function Thresholds({ workspace: w, hideHeader = false }: { workspace: Workspace; hideHeader?: boolean }) {
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
  const p = w.preferences;
  const key = activeActivityKey(p);
  const custom = findCustomActivity(p, key);
  const activityDefaults = defaultLimitsForKey(p, key);
  const atDefaults = sameActivityLimits(pickActivityLimits(p), activityDefaults);
  const defaultsLabel = ACTIVITY_PROFILES[custom ? custom.baseActivity : p.defaultActivity].label.toLowerCase();
  return (
    <div className="sky-thresholds">
      {!hideHeader && (
        <div className="sky-thresholds-activity">
          <p>
            <span>Limits for <strong>{activeActivityLabel(p)}</strong></span>
            <small>{atDefaults ? `Using the ${defaultsLabel} defaults` : "Adjusted by you"}</small>
          </p>
          {!atDefaults && (
            <button type="button" className="field-button sky-thresholds-reset" onClick={() => w.updatePreferences(activityDefaults)}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset to {defaultsLabel} defaults
            </button>
          )}
        </div>
      )}
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
