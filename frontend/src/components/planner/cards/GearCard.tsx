interface GearRecommendation {
  title: string;
  tone: string;
  category: string;
  detail: string;
}

export interface GearCardProps {
  gearRecommendations: GearRecommendation[];
}

const SAFETY_TONES = new Set(['nogo', 'caution']);

function GearList({ items }: { items: GearRecommendation[] }) {
  return (
    <ul className="gear-list">
      {items.map((item, idx) => (
        <li key={`${item.title}-${idx}`} className="gear-item">
          <div className="gear-item-head">
            <strong className="gear-item-title">{item.title}</strong>
            <span className={`decision-pill ${item.tone}`}>{item.category}</span>
          </div>
          <p className="gear-item-detail">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function GearCard({ gearRecommendations }: GearCardProps) {
  const safetyItems = gearRecommendations.filter((item) => SAFETY_TONES.has(item.tone));
  const comfortItems = gearRecommendations.filter((item) => !SAFETY_TONES.has(item.tone));

  return (
    <>
      {gearRecommendations.length > 0 ? (
        <>
          <p className="muted-note">
            Prioritized for this objective/time. Handle safety-critical items first, then comfort and efficiency items.
          </p>
          {safetyItems.length > 0 && comfortItems.length > 0 ? (
            <>
              <span className="section-label gear-group-label">Safety essentials</span>
              <GearList items={safetyItems} />
              <span className="section-label gear-group-label">Comfort &amp; efficiency</span>
              <GearList items={comfortItems} />
            </>
          ) : (
            <GearList items={gearRecommendations} />
          )}
        </>
      ) : (
        <p className="muted-note">No special gear flags detected. Use your standard backcountry safety kit and expected seasonal layers.</p>
      )}
    </>
  );
}
