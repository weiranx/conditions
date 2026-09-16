import type { SafetyData } from "../app/types";

export function SurfacePrediction({ condition }: { condition: SafetyData['terrainCondition'] }) {
  return (
    <>
      {condition?.outlook && (
        <div>
          <p>{condition.outlook.terrainLimitations}</p>
          {condition.outlook.travelEffects.map(effect => <p key={effect}>{effect}</p>)}
          <p>Temperature coverage: {condition.outlook.coverageHours.toFixed(1)} of {condition.outlook.requestedHours} planned hours.</p>
          {condition.outlook.timeline.length > 0 && (
            <details>
              <summary>Surface changes during your trip</summary>
              <ul>
                {condition.outlook.timeline.map((point, index) => (
                  <li key={`${point.time}-${index}`}>
                    <strong>{point.time}</strong>: {point.state.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {condition?.moisture && <p>{condition.moisture.summary}</p>}
      {Boolean(condition?.confidenceReasons?.length) && (
        <details>
          <summary>What limits this estimate</summary>
          <ul>{condition?.confidenceReasons?.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </details>
      )}
    </>
  );
}
