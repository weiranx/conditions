import { useState, useEffect, useCallback } from 'react';
import type {
  ElevationUnit,
  ReportLayout,
  TemperatureUnit,
  ThemeMode,
  TimeStyle,
  UserPreferences,
  WindSpeedUnit,
} from '../app/types';
import { MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS } from '../app/constants';
import {
  convertDisplayElevationToFeet,
  convertDisplayTempToF,
  convertDisplayWindToMph,
  convertElevationFeetToDisplayValue,
  convertTempFToDisplayValue,
  convertWindMphToDisplayValue,
  parseTimeInputMinutes,
} from '../app/core';
import { parseOptionalElevationInput } from '../app/planner-helpers';
import { getDefaultUserPreferences, persistUserPreferences } from '../app/preferences';

type TravelThresholdPresetKey = 'conservative' | 'standard' | 'aggressive' | 'runner';

const TRAVEL_THRESHOLD_PRESETS: Record<
  TravelThresholdPresetKey,
  { label: string; maxWindGustMph: number; maxPrecipChance: number; minFeelsLikeF: number }
> = {
  conservative: { label: 'Conservative', maxWindGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 15 },
  standard: { label: 'Standard', maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5 },
  aggressive: { label: 'Aggressive', maxWindGustMph: 35, maxPrecipChance: 75, minFeelsLikeF: -5 },
  runner: { label: 'Runner / Summer', maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25 },
};

export { TRAVEL_THRESHOLD_PRESETS };
export type { TravelThresholdPresetKey };

export interface UsePreferenceHandlersParams {
  preferences: UserPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<UserPreferences>>;
  travelWindowHours: number;
  targetElevationInput: string;
  setTargetElevationInput: React.Dispatch<React.SetStateAction<string>>;
  onApplyToPlanner: () => void;
}

export interface UsePreferenceHandlersReturn {
  // Draft states
  travelWindowHoursDraft: string;
  maxPrecipChanceDraft: string;
  maxWindGustDraft: string;
  minFeelsLikeDraft: string;
  // Threshold display values
  windThresholdPrecision: number;
  windThresholdStep: number;
  windThresholdMin: number;
  windThresholdMax: number;
  windThresholdInputValue: number;
  feelsLikeThresholdPrecision: number;
  feelsLikeThresholdStep: number;
  feelsLikeThresholdMin: number;
  feelsLikeThresholdMax: number;
  feelsLikeThresholdInputValue: number;
  // Handlers
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  handlePreferenceTimeChange: (field: 'defaultStartTime', value: string) => void;
  handleThemeModeChange: (themeMode: ThemeMode) => void;
  handleTemperatureUnitChange: (temperatureUnit: TemperatureUnit) => void;
  handleWindSpeedUnitChange: (windSpeedUnit: WindSpeedUnit) => void;
  handleElevationUnitChange: (elevationUnit: ElevationUnit) => void;
  handleTimeStyleChange: (timeStyle: TimeStyle) => void;
  handleTravelWindowHoursDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTravelWindowHoursDraftBlur: () => void;
  handleMaxPrecipChanceDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleMaxPrecipChanceDraftBlur: () => void;
  handleWindThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleWindThresholdDisplayBlur: () => void;
  handleFeelsLikeThresholdDisplayChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFeelsLikeThresholdDisplayBlur: () => void;
  handleReportLayoutChange: (reportLayout: ReportLayout) => void;
  handleApplyTravelThresholdPreset: (presetKey: TravelThresholdPresetKey) => void;
  applyPreferencesToPlanner: () => void;
  resetPreferences: () => void;
  setTravelThresholdEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  travelThresholdEditorOpen: boolean;
}

export function usePreferenceHandlers({
  preferences,
  setPreferences,
  travelWindowHours,
  targetElevationInput,
  setTargetElevationInput,
  onApplyToPlanner,
}: UsePreferenceHandlersParams): UsePreferenceHandlersReturn {
  const [travelWindowHoursDraft, setTravelWindowHoursDraft] = useState(() => String(preferences.travelWindowHours));
  const [maxPrecipChanceDraft, setMaxPrecipChanceDraft] = useState(() => String(preferences.maxPrecipChance));
  const [maxWindGustDraft, setMaxWindGustDraft] = useState(() =>
    convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(
      preferences.windSpeedUnit === 'kph' ? 1 : 0,
    ),
  );
  const [minFeelsLikeDraft, setMinFeelsLikeDraft] = useState(() =>
    convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(
      preferences.temperatureUnit === 'c' ? 1 : 0,
    ),
  );
  const [travelThresholdEditorOpen, setTravelThresholdEditorOpen] = useState(false);

  // Computed threshold display values
  const windThresholdPrecision = preferences.windSpeedUnit === 'kph' ? 1 : 0;
  const windThresholdStep = preferences.windSpeedUnit === 'kph' ? 0.5 : 1;
  const windThresholdMin = Number(convertWindMphToDisplayValue(10, preferences.windSpeedUnit).toFixed(windThresholdPrecision));
  const windThresholdMax = Number(convertWindMphToDisplayValue(80, preferences.windSpeedUnit).toFixed(windThresholdPrecision));
  const windThresholdInputValue = Number(
    convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(windThresholdPrecision),
  );
  const feelsLikeThresholdPrecision = preferences.temperatureUnit === 'c' ? 1 : 0;
  const feelsLikeThresholdStep = preferences.temperatureUnit === 'c' ? 0.5 : 1;
  const feelsLikeThresholdMin = Number(convertTempFToDisplayValue(-40, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision));
  const feelsLikeThresholdMax = Number(convertTempFToDisplayValue(60, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision));
  const feelsLikeThresholdInputValue = Number(
    convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(feelsLikeThresholdPrecision),
  );

  // Sync effects
  useEffect(() => {
    setTravelWindowHoursDraft(String(travelWindowHours));
  }, [travelWindowHours]);

  useEffect(() => {
    setMaxPrecipChanceDraft(String(preferences.maxPrecipChance));
  }, [preferences.maxPrecipChance]);

  useEffect(() => {
    setMaxWindGustDraft(String(windThresholdInputValue));
  }, [windThresholdInputValue]);

  useEffect(() => {
    setMinFeelsLikeDraft(String(feelsLikeThresholdInputValue));
  }, [feelsLikeThresholdInputValue]);

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      persistUserPreferences(next);
      return next;
    });
  }, [setPreferences]);

  const handlePreferenceTimeChange = useCallback((field: 'defaultStartTime', value: string) => {
    if (parseTimeInputMinutes(value) === null) {
      return;
    }
    updatePreferences({ [field]: value });
  }, [updatePreferences]);

  const handleThemeModeChange = useCallback((themeMode: ThemeMode) => {
    updatePreferences({ themeMode });
  }, [updatePreferences]);

  const handleTemperatureUnitChange = useCallback((temperatureUnit: TemperatureUnit) => {
    updatePreferences({ temperatureUnit });
  }, [updatePreferences]);

  const handleWindSpeedUnitChange = useCallback((windSpeedUnit: WindSpeedUnit) => {
    updatePreferences({ windSpeedUnit });
  }, [updatePreferences]);

  const handleElevationUnitChange = useCallback((elevationUnit: ElevationUnit) => {
    if (elevationUnit === preferences.elevationUnit) {
      return;
    }
    const parsed = parseOptionalElevationInput(targetElevationInput);
    if (parsed !== null) {
      const asFeet = convertDisplayElevationToFeet(parsed, preferences.elevationUnit);
      const nextDisplay = convertElevationFeetToDisplayValue(asFeet, elevationUnit);
      setTargetElevationInput(String(Math.max(0, Math.round(nextDisplay))));
    }
    updatePreferences({ elevationUnit });
  }, [preferences.elevationUnit, targetElevationInput, setTargetElevationInput, updatePreferences]);

  const handleTimeStyleChange = useCallback((timeStyle: TimeStyle) => {
    updatePreferences({ timeStyle });
  }, [updatePreferences]);

  const handleReportLayoutChange = useCallback((reportLayout: ReportLayout) => {
    updatePreferences({ reportLayout });
  }, [updatePreferences]);

  const commitRoundedThresholdValue = useCallback((
    rawValue: string,
    field: 'maxPrecipChance' | 'travelWindowHours',
    min: number,
    max: number,
    fallback: number,
  ): number => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const committed = Math.max(min, Math.min(max, Math.round(parsed)));
    updatePreferences({ [field]: committed } as Partial<UserPreferences>);
    return committed;
  }, [updatePreferences]);

  const handleTravelWindowHoursDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTravelWindowHoursDraft(raw);
    if (!raw.trim()) {
      return;
    }
    commitRoundedThresholdValue(raw, 'travelWindowHours', MIN_TRAVEL_WINDOW_HOURS, MAX_TRAVEL_WINDOW_HOURS, travelWindowHours);
  }, [commitRoundedThresholdValue, travelWindowHours]);

  const handleTravelWindowHoursDraftBlur = useCallback(() => {
    const committed = commitRoundedThresholdValue(
      travelWindowHoursDraft,
      'travelWindowHours',
      MIN_TRAVEL_WINDOW_HOURS,
      MAX_TRAVEL_WINDOW_HOURS,
      travelWindowHours,
    );
    setTravelWindowHoursDraft(String(committed));
  }, [commitRoundedThresholdValue, travelWindowHoursDraft, travelWindowHours]);

  const handleMaxPrecipChanceDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMaxPrecipChanceDraft(raw);
    if (!raw.trim()) {
      return;
    }
    commitRoundedThresholdValue(raw, 'maxPrecipChance', 0, 100, preferences.maxPrecipChance);
  }, [commitRoundedThresholdValue, preferences.maxPrecipChance]);

  const handleMaxPrecipChanceDraftBlur = useCallback(() => {
    const committed = commitRoundedThresholdValue(maxPrecipChanceDraft, 'maxPrecipChance', 0, 100, preferences.maxPrecipChance);
    setMaxPrecipChanceDraft(String(committed));
  }, [commitRoundedThresholdValue, maxPrecipChanceDraft, preferences.maxPrecipChance]);

  const handleWindThresholdDisplayChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMaxWindGustDraft(raw);
    if (!raw.trim()) {
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      return;
    }
    const mphValue = convertDisplayWindToMph(displayValue, preferences.windSpeedUnit);
    updatePreferences({ maxWindGustMph: Number(Math.max(10, Math.min(80, mphValue)).toFixed(2)) });
  }, [preferences.windSpeedUnit, updatePreferences]);

  const handleWindThresholdDisplayBlur = useCallback(() => {
    const raw = maxWindGustDraft.trim();
    if (!raw) {
      setMaxWindGustDraft(
        convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
      );
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      setMaxWindGustDraft(
        convertWindMphToDisplayValue(preferences.maxWindGustMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
      );
      return;
    }
    const mphValue = convertDisplayWindToMph(displayValue, preferences.windSpeedUnit);
    const committedMph = Number(Math.max(10, Math.min(80, mphValue)).toFixed(2));
    updatePreferences({ maxWindGustMph: committedMph });
    setMaxWindGustDraft(
      convertWindMphToDisplayValue(committedMph, preferences.windSpeedUnit).toFixed(preferences.windSpeedUnit === 'kph' ? 1 : 0),
    );
  }, [maxWindGustDraft, preferences.maxWindGustMph, preferences.windSpeedUnit, updatePreferences]);

  const handleFeelsLikeThresholdDisplayChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMinFeelsLikeDraft(raw);
    if (!raw.trim()) {
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      return;
    }
    const valueF = convertDisplayTempToF(displayValue, preferences.temperatureUnit);
    updatePreferences({ minFeelsLikeF: Number(Math.max(-40, Math.min(60, valueF)).toFixed(2)) });
  }, [preferences.temperatureUnit, updatePreferences]);

  const handleFeelsLikeThresholdDisplayBlur = useCallback(() => {
    const raw = minFeelsLikeDraft.trim();
    if (!raw) {
      setMinFeelsLikeDraft(
        convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
      );
      return;
    }
    const displayValue = Number(raw);
    if (!Number.isFinite(displayValue)) {
      setMinFeelsLikeDraft(
        convertTempFToDisplayValue(preferences.minFeelsLikeF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
      );
      return;
    }
    const valueF = convertDisplayTempToF(displayValue, preferences.temperatureUnit);
    const committedF = Number(Math.max(-40, Math.min(60, valueF)).toFixed(2));
    updatePreferences({ minFeelsLikeF: committedF });
    setMinFeelsLikeDraft(
      convertTempFToDisplayValue(committedF, preferences.temperatureUnit).toFixed(preferences.temperatureUnit === 'c' ? 1 : 0),
    );
  }, [minFeelsLikeDraft, preferences.minFeelsLikeF, preferences.temperatureUnit, updatePreferences]);

  const handleApplyTravelThresholdPreset = useCallback((presetKey: TravelThresholdPresetKey) => {
    const preset = TRAVEL_THRESHOLD_PRESETS[presetKey];
    if (!preset) {
      return;
    }
    updatePreferences({
      maxWindGustMph: preset.maxWindGustMph,
      maxPrecipChance: preset.maxPrecipChance,
      minFeelsLikeF: preset.minFeelsLikeF,
    });
    setTravelThresholdEditorOpen(true);
  }, [updatePreferences]);

  const applyPreferencesToPlanner = useCallback(() => {
    onApplyToPlanner();
  }, [onApplyToPlanner]);

  const resetPreferences = useCallback(() => {
    const defaults = getDefaultUserPreferences();
    setPreferences(defaults);
    persistUserPreferences(defaults);
  }, [setPreferences]);

  return {
    travelWindowHoursDraft,
    maxPrecipChanceDraft,
    maxWindGustDraft,
    minFeelsLikeDraft,
    windThresholdPrecision,
    windThresholdStep,
    windThresholdMin,
    windThresholdMax,
    windThresholdInputValue,
    feelsLikeThresholdPrecision,
    feelsLikeThresholdStep,
    feelsLikeThresholdMin,
    feelsLikeThresholdMax,
    feelsLikeThresholdInputValue,
    updatePreferences,
    handlePreferenceTimeChange,
    handleThemeModeChange,
    handleTemperatureUnitChange,
    handleWindSpeedUnitChange,
    handleElevationUnitChange,
    handleTimeStyleChange,
    handleTravelWindowHoursDraftChange,
    handleTravelWindowHoursDraftBlur,
    handleMaxPrecipChanceDraftChange,
    handleMaxPrecipChanceDraftBlur,
    handleWindThresholdDisplayChange,
    handleWindThresholdDisplayBlur,
    handleFeelsLikeThresholdDisplayChange,
    handleFeelsLikeThresholdDisplayBlur,
    handleReportLayoutChange,
    handleApplyTravelThresholdPreset,
    applyPreferencesToPlanner,
    resetPreferences,
    travelThresholdEditorOpen,
    setTravelThresholdEditorOpen,
  };
}
