export interface TerrainConditionDetails {
  summary: string;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low' | null;
  impact: string | null;
  recommendedTravel: string | null;
  footwear: string | null;
  snowProfile: { label: string; summary: string; reasons: string[]; confidence: 'high' | 'medium' | 'low' | null } | null;
}

export interface TerrainCardProps {
  terrainConditionDetails: TerrainConditionDetails;
  rainfall12hDisplay: string;
  rainfall24hDisplay: string;
  rainfall48hDisplay: string;
  snowfall12hDisplay: string;
  snowfall24hDisplay: string;
  snowfall48hDisplay: string;
}

export function TerrainCard({
  terrainConditionDetails,
  rainfall12hDisplay,
  rainfall24hDisplay,
  rainfall48hDisplay,
  snowfall12hDisplay,
  snowfall24hDisplay,
  snowfall48hDisplay,
}: TerrainCardProps) {
  return (
    <>
      <p className="muted-note">{terrainConditionDetails.summary}</p>
      {(terrainConditionDetails.impact || terrainConditionDetails.confidence) && (
        <div className="terrain-meta-row">
          {terrainConditionDetails.impact && (
            <span className={`terrain-impact-badge ${terrainConditionDetails.impact === 'high' ? 'nogo' : terrainConditionDetails.impact === 'low' ? 'go' : 'caution'}`}>
              {terrainConditionDetails.impact === 'high' ? 'High' : terrainConditionDetails.impact === 'low' ? 'Low' : 'Moderate'} impact
            </span>
          )}
          {terrainConditionDetails.confidence && (
            <span className={`terrain-confidence-chip ${terrainConditionDetails.confidence}`}>
              {terrainConditionDetails.confidence === 'high' ? 'High' : terrainConditionDetails.confidence === 'medium' ? 'Moderate' : 'Low'} confidence
            </span>
          )}
        </div>
      )}
      {terrainConditionDetails.recommendedTravel && (
        <div className="decision-action">
          <span className="decision-action-label">Recommended travel mode</span>
          <p>{terrainConditionDetails.recommendedTravel}</p>
        </div>
      )}
      {terrainConditionDetails.footwear && (
        <div className="decision-action">
          <span className="decision-action-label">Footwear / traction</span>
          <p>{terrainConditionDetails.footwear}</p>
        </div>
      )}
      {terrainConditionDetails.snowProfile && (
        <div className="terrain-snow-profile-block">
          <div className="terrain-snow-profile-header">
            <span className="terrain-snow-profile-title">Snow Profile</span>
            <strong className="terrain-snow-profile-label">{terrainConditionDetails.snowProfile.label}</strong>
          </div>
          {terrainConditionDetails.snowProfile.summary ? (
            <p className="terrain-snow-profile-summary">{terrainConditionDetails.snowProfile.summary}</p>
          ) : null}
          {terrainConditionDetails.snowProfile.reasons.length > 0 && (
            <ul className="signal-list compact">
              {terrainConditionDetails.snowProfile.reasons.map((reason, index) => (
                <li key={`snow-profile-reason-${index}`}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="terrain-precip-grid">
        <div className="terrain-precip-row">
          <span className="terrain-precip-label">Rain</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">12h</span>{rainfall12hDisplay}</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">24h</span>{rainfall24hDisplay}</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">48h</span>{rainfall48hDisplay}</span>
        </div>
        <div className="terrain-precip-row">
          <span className="terrain-precip-label">Snow</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">12h</span>{snowfall12hDisplay}</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">24h</span>{snowfall24hDisplay}</span>
          <span className="terrain-precip-val"><span className="terrain-precip-window">48h</span>{snowfall48hDisplay}</span>
        </div>
      </div>
      {terrainConditionDetails.reasons.length > 0 ? (
        <ul className="signal-list compact">
          {terrainConditionDetails.reasons.map((reason, index) => (
            <li key={`terrain-condition-reason-${index}`}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="muted-note">No strong surface signal was detected from current upstream data.</p>
      )}
      <p className="muted-note">Classification updates when you change location, date, or start time.</p>
    </>
  );
}
