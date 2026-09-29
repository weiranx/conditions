import type { SafetyData } from "../app/types";
import { Evidence } from "./Evidence";
import { readable, type EvidenceFormat } from "./evidence-format";

type Local = NonNullable<SafetyData["localConditions"]>;

const unavailable = (available: boolean | undefined, note?: string | null) =>
  available === false ? [note || "This feed returned no data for this report."] : [];

const trendWord = (trend: string | null | undefined) =>
  trend && trend !== "unknown" ? readable(trend) : null;

/** The nearby station, radar, access, fire, water, smoke and tide feeds, each written out. */
export function FieldFeedEvidence({ local, f }: { local: Local | null | undefined; f: EvidenceFormat }) {
  if (!local) return null;
  const { weatherObservation: station, radar, access, closures, wildfire, streamflow, smoke, tides } = local;
  const lightning = radar?.lightning;
  const roads = access?.roads ?? [];
  const caltrans = access?.caltransClosures ?? [];
  const notices = closures?.alerts ?? [];
  const incidents = wildfire?.incidents ?? [];
  const detections = wildfire?.firmsDetections ?? [];
  const nearestDetectionKm = detections
    .map((d) => d.distanceKm)
    .filter((km): km is number => typeof km === "number" && Number.isFinite(km))
    .sort((a, b) => a - b)[0];
  const windLine = [
    f.wind(station?.windMph),
    f.wind(station?.gustMph) && `gusts ${f.wind(station?.gustMph)}`,
  ].filter(Boolean).join(", ");
  const tide = (point: { timeIso?: string | null; rawTime?: string | null; heightFt?: number | null } | null | undefined) =>
    point ? [f.time(point.timeIso) || point.rawTime, f.number(point.heightFt, " ft")].filter(Boolean).join(" · ") || null : null;

  return (
    <>
      {station && (
        <Evidence
          title="Nearby weather station"
          rows={[
            ["Station", station.stationName],
            ["Distance", f.distance(station.distanceKm)],
            ["Station elevation", f.elevation(station.elevationFt)],
            ["Observed", f.observed(station.observedTime)],
            ["Conditions", station.textDescription],
            ["Temperature", f.temp(station.tempF)],
            ["Dew point", f.temp(station.dewPointF)],
            ["Humidity", f.percent(station.humidityPct)],
            ["Wind", windLine || null],
            ["Visibility", f.number(station.visibilityMi, " mi")],
            ["Rain, past hour", f.rain(station.precipLastHourIn)],
          ]}
          notes={unavailable(station.available)}
          links={[{ url: station.sourceLink, label: "Station page" }]}
        />
      )}
      {radar && (
        <Evidence
          title="Radar and lightning"
          rows={[
            ["Radar", radar.status === "echo_detected" || radar.echoDetected
              ? "Precipitation echo near the objective"
              : radar.status === "no_echo_detected" || radar.echoDetected === false
                ? "No precipitation echo"
                : null],
            ["Radar time", f.observed(radar.observedTime)],
            ["Rain, past hour", f.rain(radar.rain1hIn)],
            ["Rain, past 6 hours", f.rain(radar.rain6hIn)],
            ["Rain, past 24 hours", f.rain(radar.rain24hIn)],
            ["Lightning", lightning?.available
              ? lightning.detectionAtObjective === true
                ? "Detected at the objective"
                : lightning.detectionAtObjective === false
                  ? "None detected at the objective"
                  : null
              : null],
            ["Lightning time", lightning?.available ? f.observed(lightning.productTime) : null],
          ]}
          notes={[...unavailable(radar.available), radar.note, lightning?.note]}
          links={[
            { url: radar.sourceLink, label: "Radar" },
            { url: lightning?.sourceLink, label: "Lightning" },
          ]}
        />
      )}
      {access && (
        <Evidence
          title="Trail and road access"
          rows={[
            ["Closed forest roads", access.available ? String(access.closedRoadCount ?? roads.length) : null],
            ["State highway closures", access.available && typeof access.caltransClosureCount === "number" ? String(access.caltransClosureCount) : null],
            ["Searched within", f.distance(access.searchRadiusKm)?.replace(" away", "")],
          ]}
          points={[
            ...roads.map((road) => [road.name, readable(road.routeStatus)].filter(Boolean).join(" · ")),
            ...caltrans.map((c) => [c.name, c.summary].filter(Boolean).join(": ")),
          ]}
          notes={[...unavailable(access.available), access.note]}
          links={[
            { url: access.sourceLink, label: "Road status" },
            { url: access.caltransSourceLink, label: "Caltrans" },
          ]}
        />
      )}
      {closures && (
        <Evidence
          title="Land-manager closures"
          rows={[
            ["Park or forest", closures.parkName],
            ["Distance", closures.matchedBy === "boundary" ? "Objective is inside the boundary" : f.distance(closures.distanceKm)],
            ["Posted notices", closures.available ? String(Math.max(closures.alertCount ?? 0, notices.length)) : null],
          ]}
          points={notices.map((notice) => [notice.title, notice.category && `(${notice.category})`].filter(Boolean).join(" "))}
          notes={[...unavailable(closures.available), closures.note]}
          links={[{ url: closures.sourceLink, label: "Park alerts" }]}
        />
      )}
      {wildfire && (
        <Evidence
          title="Wildfire incidents and detections"
          rows={[
            ["Incidents nearby", wildfire.available ? String(Math.max(wildfire.nearbyIncidentCount ?? 0, incidents.length)) : null],
            ["Satellite detections", wildfire.available && wildfire.firmsConfigured !== false ? String(wildfire.firmsDetectionCount ?? detections.length) : null],
            ["Nearest detection", f.distance(nearestDetectionKm)],
            ["Searched within", f.distance(wildfire.searchRadiusKm)?.replace(" away", "")],
          ]}
          points={incidents.map((fire) => [
            fire.name,
            f.number(fire.acres, " acres"),
            f.percent(fire.percentContained) && `${f.percent(fire.percentContained)} contained`,
            f.distance(fire.distanceKm),
          ].filter(Boolean).join(" · "))}
          notes={[...unavailable(wildfire.available), wildfire.note]}
          links={[{ url: wildfire.sourceLink, label: "Incident map" }]}
        />
      )}
      {streamflow && (
        <Evidence
          title="Stream crossings and flow"
          rows={[
            ["Gauge", streamflow.siteName],
            ["Distance", f.distance(streamflow.distanceKm)],
            ["Flow", f.number(streamflow.dischargeCfs, " cfs")],
            ["Gauge height", f.number(streamflow.gageHeightFt, " ft")],
            ["Trend", trendWord(streamflow.trend)],
            ["Observed", f.observed(streamflow.observedTime)],
            ["Forecast peak", streamflow.forecast?.available
              ? [f.number(streamflow.forecast.peakFlowCfs, " cfs"), f.time(streamflow.forecast.peakTime)].filter(Boolean).join(" at ") || null
              : null],
          ]}
          notes={[...unavailable(streamflow.available), streamflow.forecast?.note]}
        />
      )}
      {smoke && (
        <Evidence
          title="Smoke observations and forecast"
          rows={[
            ["Now", [f.number(smoke.currentPm25, " µg/m³ PM2.5"), smoke.currentCategory].filter(Boolean).join(" · ") || null],
            ["Forecast peak", [f.number(smoke.peakPm25, " µg/m³ PM2.5"), smoke.peakCategory].filter(Boolean).join(" · ") || null],
            ["Peak time", f.time(smoke.peakTimeIso)],
            ["Forecast covers", f.number(smoke.horizonHours, " hours")],
          ]}
          notes={unavailable(smoke.available)}
        />
      )}
      {tides && tides.available !== false && (
        <Evidence
          title="Coastal tides"
          rows={[
            ["Station", tides.stationName],
            ["Distance", f.distance(tides.distanceKm)],
            ["Tide now", trendWord(tides.direction)],
            ["Next high", tide(tides.nextHigh)],
            ["Next low", tide(tides.nextLow)],
          ]}
        />
      )}
    </>
  );
}
