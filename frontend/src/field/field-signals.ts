import type { SafetyData, UserPreferences } from "../app/types";
export type FieldSignal = {
  key: string;
  title: string;
  detail: string;
  tone: "attention" | "unavailable";
};
export function fieldSignals(
  local: SafetyData["localConditions"],
  preferences: Pick<UserPreferences, "maxWindGustMph">,
  now = Date.now(),
): FieldSignal[] {
  if (!local)
    return [
      {
        key: "all",
        title: "Field observations unavailable",
        detail: "No local observation or access feed was returned.",
        tone: "unavailable",
      },
    ];
  const signals: FieldSignal[] = [];
  const add = (key: string, title: string, detail: string) =>
    signals.push({ key, title, detail, tone: "attention" });
  const roads =
    (local.access?.closedRoadCount || 0) +
    (local.access?.caltransClosureCount || 0);
  if (local.access?.available && roads > 0)
    add(
      "roads",
      `${roads} road closure${roads === 1 ? "" : "s"} nearby`,
      "Check whether the closures affect your approach.",
    );
  const closures = Math.max(
    local.closures?.alertCount || 0,
    local.closures?.alerts?.length || 0,
  );
  if (local.closures?.available && closures > 0)
    add(
      "closures",
      `${closures} land-manager notice${closures === 1 ? "" : "s"}`,
      local.closures?.alerts?.[0]?.title ||
        "Review the posted notices for route and access restrictions.",
    );
  if (
    local.radar?.lightning?.available &&
    local.radar.lightning.detectionAtObjective === true
  )
    add(
      "lightning",
      "Lightning detected at the objective",
      "Review the observation time and current radar before continuing.",
    );
  else if (local.radar?.available && local.radar.echoDetected === true)
    add(
      "radar",
      "Radar echo detected",
      "Precipitation was detected near the objective; check the radar time.",
    );
  if (local.streamflow?.available && local.streamflow.trend === "rising")
    add(
      "water",
      "Nearby stream is rising",
      local.streamflow.siteName || "Review the gauge and crossing conditions.",
    );
  if (local.smoke?.available) {
    const categories = [
      local.smoke.currentCategory,
      local.smoke.peakCategory,
    ].filter((v): v is string => Boolean(v));
    const unusual = categories.find((v) =>
      /moderate|unhealthy|hazardous|poor/i.test(v),
    );
    if (unusual)
      add(
        "smoke",
        `Smoke outlook: ${unusual}`,
        "Check the current and peak forecast times; the peak may be later.",
      );
  }
  const fires = Math.max(
    local.wildfire?.nearbyIncidentCount || 0,
    local.wildfire?.incidents?.length || 0,
  );
  if (local.wildfire?.available && fires > 0)
    add(
      "fire",
      `${fires} wildfire incident${fires === 1 ? "" : "s"} nearby`,
      "Nearby incidents do not necessarily intersect this route. Check locations and access notices.",
    );
  if (
    local.wildfire?.available &&
    (local.wildfire.firmsDetectionCount || 0) > 0
  )
    add(
      "detections",
      "Satellite fire detections nearby",
      "Review the detection locations and acquisition times.",
    );
  const observation = local.weatherObservation;
  if (
    observation?.available &&
    typeof observation.gustMph === "number" &&
    Number.isFinite(observation.gustMph) &&
    observation.gustMph > preferences.maxWindGustMph
  )
    add(
      "gust",
      "Observed gusts exceed your limit",
      "The nearby station is reporting gusts above your selected weather threshold.",
    );
  if (
    observation?.available &&
    observation.observedTime &&
    Number.isFinite(Date.parse(observation.observedTime)) &&
    now - Date.parse(observation.observedTime) > 3 * 3600000
  )
    add(
      "stale",
      "Station observation is over 3 hours old",
      "Check the observation time before relying on this reading.",
    );
  for (const [key, label, value] of [
    ["station", "Weather station", observation],
    ["access", "Road access", local.access],
    ["closures", "Land-manager notices", local.closures],
    ["radar", "Radar", local.radar],
    ["fire", "Wildfire feed", local.wildfire],
  ] as const) {
    if (!value?.available)
      signals.push({
        key: `missing-${key}`,
        title: `${label} unavailable`,
        detail: "This feed cannot confirm current conditions.",
        tone: "unavailable",
      });
  }
  return signals;
}
