interface GearRecommendation {
  title: string;
  tone: string;
  category: string;
  detail: string;
}

export interface GearCardProps {
  gearRecommendations: GearRecommendation[];
}

export function GearCard({ gearRecommendations }: GearCardProps) {
  return (
    <>
      {gearRecommendations.length > 0 ? (
        <>
          <p className="muted-note">
            Prioritized for this objective/time. Handle safety-critical items first, then comfort and efficiency items.
          </p>
          <ul className="gear-list">
            {gearRecommendations.map((item, idx) => (
              <li key={`${item.title}-${idx}`} className="gear-item">
                <div className="gear-item-head">
                  <strong className="gear-item-title">{item.title}</strong>
                  <span className={`decision-pill ${item.tone}`}>{item.category}</span>
                </div>
                <p className="gear-item-detail">{item.detail}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted-note">No special gear flags detected. Use your standard backcountry safety kit and expected seasonal layers.</p>
      )}
    </>
  );
}
