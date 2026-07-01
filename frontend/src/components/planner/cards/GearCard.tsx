interface GearRecommendation {
  title: string;
  tone: string;
  category: string;
  detail: string;
}

export interface GearCardProps {
  gearRecommendations: GearRecommendation[];
}

const GEAR_TONE_LABEL: Record<string, string> = {
  nogo: 'Essential',
  caution: 'Recommended',
  watch: 'Situational',
  go: 'Standard',
};

const GEAR_CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'Safety', label: 'Safety essentials' },
  { key: 'Conditions', label: 'Layering & traction' },
  { key: 'Exposure', label: 'Sun & heat' },
  { key: 'General', label: 'Other' },
];

function GearList({ items }: { items: GearRecommendation[] }) {
  return (
    <ul className="gear-list">
      {items.map((item, idx) => (
        <li key={`${item.title}-${idx}`} className="gear-item">
          <div className="gear-item-head">
            <strong className="gear-item-title">{item.title}</strong>
            <span className={`decision-pill ${item.tone}`}>{GEAR_TONE_LABEL[item.tone] || item.tone}</span>
          </div>
          <p className="gear-item-detail">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function GearCard({ gearRecommendations }: GearCardProps) {
  const groups = GEAR_CATEGORY_ORDER
    .map((g) => ({ ...g, items: gearRecommendations.filter((item) => item.category === g.key) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {gearRecommendations.length > 0 ? (
        <>
          <p className="muted-note">
            Prioritized for this objective/time. Handle safety-critical items first, then comfort and efficiency items.
          </p>
          {groups.length > 1 ? (
            groups.map((g) => (
              <div key={g.key}>
                <span className="section-label gear-group-label">{g.label}</span>
                <GearList items={g.items} />
              </div>
            ))
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
