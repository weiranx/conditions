/**
 * The ridge line from the app icon (public/summitsafe-icon.svg), cropped so it sits
 * centred at small sizes. It draws in `currentColor`; `.sky-brand-tile` puts it on the
 * icon's dark tile.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="80 66 328 328"
      fill="none"
      stroke="currentColor"
      strokeWidth={32}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M96 322 L196 178 L232 218 L292 138 L392 322" />
    </svg>
  );
}
