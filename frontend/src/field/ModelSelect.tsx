import { useState } from "react";
export function ModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const customMode = custom || Boolean(value && !options.includes(value));
  return (
    <div className="field-model-select">
      <label className="field-form-label">
        {label}
        <select
          aria-label={label}
          value={customMode ? "__custom__" : value}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "__custom__") {
              setCustom(true);
            } else {
              setCustom(false);
              onChange(event.target.value);
            }
          }}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          <option value="__custom__">Enter a custom model ID…</option>
        </select>
      </label>
      {customMode && (
        <label className="field-form-label">
          Custom model ID
          <input
            aria-label={`${label} custom model ID`}
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder="Model ID"
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
