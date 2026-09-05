const aspects = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function WindCompass({
  leeward,
  secondary,
}: {
  leeward: string[];
  secondary: string[];
}) {
  return (
    <figure className="wind-compass">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Potential wind-loading aspects: ${leeward.join(", ") || "unavailable"}. Secondary aspects: ${secondary.join(", ") || "none identified"}.`}
      >
        {aspects.map((aspect, index) => {
          const angle = index * 45 - 90;
          const point = (degrees: number, radius: number) => [
            100 + Math.cos((degrees * Math.PI) / 180) * radius,
            100 + Math.sin((degrees * Math.PI) / 180) * radius,
          ];
          const a = point(angle - 20, 65),
            b = point(angle + 20, 65),
            label = point(angle, 86);
          return (
            <g key={aspect}>
              <path
                d={`M100,100 L${a} A65,65 0 0,1 ${b} Z`}
                className={
                  leeward.includes(aspect)
                    ? "is-leeward"
                    : secondary.includes(aspect)
                      ? "is-secondary"
                      : ""
                }
              />
              <text
                x={label[0]}
                y={label[1]}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {aspect}
              </text>
            </g>
          );
        })}
        <circle cx="100" cy="100" r="6" />
      </svg>
      <figcaption>
        Leeward <strong>{leeward.join(" · ") || "Unknown"}</strong>
      </figcaption>
    </figure>
  );
}
