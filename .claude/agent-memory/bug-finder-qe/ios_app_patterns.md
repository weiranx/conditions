---
name: iOS App Bug Patterns
description: Recurring bugs and fragility points found during the iOS app audit (2026-03-11)
type: project
---

## Architecture Summary
- Swift iOS app in `BackcountryConditions/BackcountryConditions/`
- Observable/SwiftUI, no UIKit outside of keyboard dismissal
- Model layer: `Models/*.swift` — all Codable structs
- Services: thin wrappers over `APIClient` actor
- ViewModels: `@Observable` classes
- Utilities: pure enums/static functions (DateFormatting, UnitConversions, DecisionEngine, TravelWindowEngine)
- Tests: `BackcountryConditionsTests/` — 4 test files covering models, date formatting, unit conversions, decision engine

## Key Bugs Found

### HIGH: TravelWindowEngine.deriveSpans — last-row span drops final element
- File: `Utilities/TravelWindowEngine.swift` L71-96
- When the last row is a PASS, `spanEnded` fires because `isLast=true`, endIndex is set to `idx`
  and that element IS included correctly. BUT: if all rows pass, `startIndex=0` and the span
  is recorded correctly. No bug here — re-verified.
- ACTUAL BUG: If last row is the start of a new pass span (startIndex set to idx and isLast=true simultaneously),
  endIndex = idx, length = 1 — that single-hour span IS captured. Correct.

### HIGH: RouteAnalysisCard — isLoadingAnalysis not reset on cancel
- File: `Views/Planner/Cards/RouteAnalysisCard.swift` L233-257
- `analysisTask?.cancel()` is called, then a NEW Task is created. The old task's `defer { isLoadingAnalysis = false }` fires
  on the OLD task when it's cancelled. But if Task.isCancelled causes early return, the defer fires — so loading IS reset.
- However: `analysisTask = task` is set AFTER the task is started but the task captures `isLoadingAnalysis`
  which is set to `true` before the task. If the view is dismissed while loading, isLoadingAnalysis stays true.

### MEDIUM: SettingsView settingsVM not initialized synchronously
- File: `Views/Settings/SettingsView.swift` L126-132
- `settingsVM` is initialized in `.onAppear` not in an `init`. On first render, `if let vm = settingsVM` is false
  so no settings UI renders. This is correct SwiftUI lazy init pattern, but the form is completely blank
  until onAppear fires (which is immediate but after first render frame).

### MEDIUM: formatAmPm — does not clamp out-of-range minutes
- File: `Utilities/DateFormatting.swift` L130-135
- `minutesTo24hClock` clamps to 1439, but `formatAmPm` does no clamping.
- If minutes >= 1440 (e.g. 1500): hour24 = 25, ampm = "PM", hour12 = 25 % 12 = 1 → "1:00 PM" (wrong)
- `formatClockForStyle` always parses validated times so in practice ≤1439, but it's a latent defect.

### MEDIUM: PeakCatalog.rankScore — missing rank 2 creates gap
- File: `Services/SearchService.swift` L78-85
- Score values are 0, 1, 3, 5 — rank 2 is skipped. Not a crash but a minor sorting inconsistency.

### LOW: AvalancheProblem.problem_description field — decoded but never displayed
- `Models/SafetyData.swift` L187: `problem_description` is decoded but AvalancheCard only shows `discussion`
- Backend sends `discussion` on problems from the scraper path. No display bug in normal flow.

## Recurrent Pattern: @unchecked Sendable
- `SearchViewModel` is marked `@unchecked Sendable` — mutation of suggestions/isSearching happens on MainActor task
  so this is safe, but worth watching.

**Why:** Record this so future reviewers know to check MainActor isolation carefully for @unchecked Sendable classes.
**How to apply:** Verify all state mutations in @unchecked Sendable VMs occur on MainActor.

## Navigation Architecture Fragility (discovered 2026-03-12)
- `navigationDestination` MUST be registered unconditionally in the view hierarchy. Placing it inside
  conditional content (e.g., `if !dayResults.isEmpty { ... .navigationDestination(...) }`) creates a
  registration gap when the condition is false. The destination closure also needs an `else` branch —
  returning `EmptyView` from the closure produces a blank navigation push with no recovery affordance.
- Pattern to check: any `NavigationLink(value:)` paired with `.navigationDestination` buried inside a
  computed property or conditional block.

## Keyboard Toolbar Propagation Through TabView (discovered 2026-03-12)
- `.toolbar { ToolbarItemGroup(placement: .keyboard) }` applied at the `TabView` level is NOT guaranteed
  to propagate into nested `NavigationStack` children. Number-pad keyboards inside `Form`/`TextField`
  inside a `NavigationStack` inside a `TabView` tab may not show the "Done" button.
- Preferred approach: keep a `.toolbar { .keyboard }` on the `Form` or `ScrollView` that directly
  contains the `TextField` nodes, not on an ancestor `TabView`.

## MarkdownStrip Half-Implementation (discovered 2026-03-12)
- `MarkdownStrip.inlineOnly` only converts `#` headings to `**bold**`. Unordered list markers (`- `, `* `)
  and ordered list markers (`1. `) pass through as literal characters. `Text(LocalizedStringKey(...))`
  does not render markdown lists. AI briefs using list formatting will render raw markdown syntax.
- Fix: strip leading list markers from lines before passing to `Text(LocalizedStringKey(...))`, or
  convert `- text` to `• text`.
