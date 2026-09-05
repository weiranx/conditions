# Redesigned frontend

`main.tsx` mounts `FieldApp`. The new presentation uses its own components and styles. The former frontend remains in place to preserve unrelated work.

`model/useReportGeneration.ts` owns generation and startup checks; `useSavedReportSync.ts` owns browser/account persistence and report identity; `useReportComparisons.ts` enables comparisons only for the current completed plan. `useWorkspace.ts` composes these controllers.

The controllers in `model/` retain the established planning, account, persistence, sharing, feature-flag, and administrative behavior. Domain hooks and score calculations continue to come from the existing application modules. GPX duration is applied through an explicit action, and report chapter changes preserve page position.

## Feature coverage

| Previous workflow | New presentation |
| --- | --- |
| Objective search, coordinates, geolocation, GPX import, map layers | `WorkspacePlan`, `FieldMap` |
| Report decisions, confidence, source freshness | `Report`, `Sources` |
| Ten hourly weather metrics and selectable hours | `Forecast` |
| Daylight, departure scenarios, thresholds | `Timing` |
| Elevation forecasts, terrain timeline, avalanche, snowpack, satellite snow, wind loading | `Terrain` |
| Rain/snow history, heat, fire, AQI, visibility, atmosphere, field observations | `Conditions` |
| Named routes, GPX checkpoint analysis, elevation profile, checkpoint details | `Route` |
| Gear checklist, AI brief, persistent report chat | `Report`, `Chat` |
| Multi-day ranking, day detail, copy/print, open day in planner, trip chat | `Compare` |
| Objective × date shortlist, hazard ranking, weather tradeoffs, local Plan A / Plan B | `ObjectiveShortlist`, `useObjectiveShortlist` |
| Saved reports, sharing, email, report export, full report and printing | `FieldApp`, `Report`, `Library` |
| Objective watches, manual checks, notifications, baseline, checks and change history | `Library` |
| Units, appearance, activity defaults, thresholds, route pace, account sync | `Settings` |
| Email and Google sign-in, verification, recovery, membership and usage | `Account`, `GoogleAuth` |
| Health, accounts, usage limits, AI providers/models, product flags, scheduler, runtime configuration, diagnostics, analytics, audit exports | `Administration`, `AdminUsers`, `AdminControls`, `AdminAnalytics` |
| Shared report links, browser navigation, legal pages, status, unavailable states | `FieldApp`, `Legal`, `Operations` |

## Verification

Run from the repository root:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:field
npm --prefix frontend run test:mock
git diff --check
```

The presentation tests cover unit conversion, empty and sparse hourly evidence, comparison decision ranking, metric accumulation amounts, and blocked-day recommendations. The hook tests exercise changing plans during in-flight comparisons, aborted responses, saved-report boundaries, and report startup. CI runs both suites. Tests render components without a network; the map dependency is replaced by its coordinate constructor in this test harness only.

Browser verification also covers report generation, date/time commits, hourly metric changes, full report chapters, units/themes, mobile overflow, coordinate search, account and library states, and local administration. Database-backed actions and live AI require the corresponding backend configuration; an unavailable response is not a successful end-to-end test.

## Objective shortlist

Open **Compare → Compare objectives** to select 2–5 points and 2–7 consecutive dates. Each objective uses the same local departure time and trip duration. Forecast requests use the existing `/api/trip-forecasts` endpoint sequentially, with one comparison allowance per objective, idempotency keys, cancellation, and account usage updates. Missing dates remain visible; mismatched date, location, time, or duration responses are rejected.

Ranking uses the existing full hazard decision (including relevant avalanche evidence), then the canonical report score. Partial reports and incomplete hourly windows do not win ranking; comfort remains separate. This differs from the weather-only **Compare days** mode. Neither mode evaluates a route automatically.

Shortlists and explicit Plan A / Plan B selections persist in this browser under `summitsafe:objective-shortlist:v1`; forecast payloads are not persisted. Opening a saved choice prepares the selected objective, date, time, and duration in the planner for a fresh full report. It clears prior route/elevation context. Search, settings changes, and reloads do not automatically spend comparison allowances.
