# claude-in-chrome tooling notes (this environment)

- `mcp__claude-in-chrome__resize_window` reports success but the subsequent
  `computer screenshot` keeps returning the prior (desktop) resolution — could not get a
  true narrow-viewport (mobile) screenshot in this session despite several retries
  (390x844, 414x896). If a future review needs real mobile screenshots, try: closing and
  recreating the tab after resize, or ask the user to resize manually, before trusting any
  "mobile responsive" verdict — don't assume the tool's resize actually changed the captured
  viewport just because it returned no error.
- Scrolling with the mouse positioned over the embedded Leaflet map (`PlannerMapSection` /
  `map-components.tsx`) zooms the map instead of scrolling the page — when scrolling through
  a long report, aim scroll actions at the right margin (e.g. x≈1400 on a 1440-1512 wide
  viewport) or below the map's bottom edge, not over the map itself.
- A stray click anywhere on the embedded map (even an apparent no-op click while trying to
  dismiss a tooltip) re-pins the report location to the clicked coordinates and reloads the
  whole report silently (no confirmation dialog) — be careful not to click the map area when
  just trying to screenshot/inspect it.
