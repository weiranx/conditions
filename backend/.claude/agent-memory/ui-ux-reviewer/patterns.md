# Design system & file map (verified 2026-06-30)

## Color palette (CSS custom properties, defined in `frontend/src/App.css` ~line 18-24)
```
--accent-green: #2f8a57       /* brand color AND "safe/go" semantic */
--accent-green-deep: #1f6a42
--accent-teal: #1f8376
--accent-yellow: #c58d3b      /* caution */
--accent-orange: #d4742c      /* elevated risk */
--accent-red: #c84444         /* high risk / danger / fail */
--accent-sky: #4d8fb7
```
This is a deliberate, well-organized system, not ad hoc — green doubles as both the brand
accent (buttons, selected states, nav) and the "safe" risk signal. Before flagging a
"green vs orange clash" as a bug, check whether it's actually this intentional dual-use
pattern. The one legitimate edge case: the selected-hour pill in the hourly forecast strip
(`WeatherHourPillStrip.tsx`) uses solid `--accent-green` fill directly above/near rows that
use red/green for go/no-go (MOVE OK row) — could momentarily misread as a safety signal.
Minor, not worth a high-severity flag.

## Key style files
- `frontend/src/App.css` — 11k+ lines, global styles, CSS vars, legacy planner styles.
- `frontend/src/styles/home-redesign.css` — home/landing page.
- `frontend/src/styles/planner-redesign.css` — the "Full Report" (`RedesignView`) card system;
  prefix `.ssr-*` (safety score report?). Two-column grid `grid-template-columns: 1fr 340px`
  around line 75.
- `frontend/src/styles/planner-shell-redesign.css` — shell chrome around the planner (map, date/time bar).
- `frontend/src/styles/settings-redesign.css` — settings page.
- `frontend/src/styles/dashboard-redesign.css`, `trip-redesign.css` — other redesigned views.

## Full Report layout structure (`frontend/src/components/planner/RedesignView.tsx`)
The report is NOT a single CSS grid with matched row tracks — it's two independently-stacked
columns (left: score gauge → What to adjust → hourly weather → critical checks → elevation
profile → wind loading → score breakdown → gear; right: avalanche/snowpack/daylight/fire
risk/air quality/terrain/sources). The right column is shorter than the left, so once it runs
out of cards (after "Sources"), the rest of the left column's scroll height shows bare page
background on the right — looks unfinished. Found 2026-06-30, not yet fixed as of that date.

## Critical Checks "Passing" list truncation
`frontend/src/styles/planner-redesign.css:731` — `.ssr-cc-pass span { overflow: hidden;
text-overflow: ellipsis; white-space: nowrap; }` forces single-line truncation, which cuts
mid-word (e.g. "No convective storm signal (thunder/lightning/h…"). There IS a `title`
attribute on the wrapping div (`RedesignView.tsx:646`) with the full text, but `title`
tooltips don't work on touch devices — so on mobile this content is effectively unreadable.
Confirmed live in browser 2026-06-30, not yet fixed.

## Text-generation bug: duplicated word in wind-loading "What to adjust" lever
`frontend/src/components/planner/RedesignView.tsx:363` —
`` `Loading is focused ${localizeUnitText(windLoadingElevationFocus)}.` `` where
`windLoadingElevationFocus` itself already starts with "Focus near and above treeline...",
producing "Loading is focused Focus near and above treeline...zones.." (duplicate "Focus",
trailing double period). Backend-sourced string concatenated with a UI-template prefix.
Confirmed live 2026-06-30, not yet fixed.
