import type { WeatherTrendPoint } from "../app/types";

// Match the displayed forecast, with precipitation taking precedence over cloud cover.
export function weatherAppearance(
  point: Pick<WeatherTrendPoint, "condition" | "isDaytime">,
) {
  const text = (point.condition || "").toLowerCase();
  const condition = /thunder|storm|lightning/.test(text)
    ? "storm"
    : /snow|sleet|ice|freezing/.test(text)
      ? "snow"
      : /rain|shower|drizzle/.test(text)
        ? "rain"
        : /fog|mist|haze|smoke/.test(text)
          ? "fog"
          : /partly|mostly sunny|mostly clear/.test(text)
            ? "partly"
            : /cloud|overcast/.test(text)
              ? "cloudy"
              : /sun|clear|fair/.test(text)
                ? "clear"
                : "neutral";
  return { condition, night: point.isDaytime === false };
}
