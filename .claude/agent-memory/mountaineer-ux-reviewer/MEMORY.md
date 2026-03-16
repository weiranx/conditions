# Mountaineer UX Reviewer - Persistent Memory

## Project: SummitSafe / Backcountry Conditions
- [review-session-1.md](review-session-1.md) -- Initial feature inventory and gap analysis
- [review-session-2.md](review-session-2.md) -- Deep safety code audit (10 bugs, several since fixed)
- [review-session-3.md](review-session-3.md) -- Feature gap and decision-support analysis (8 gaps)
- [review-session-4.md](review-session-4.md) -- Card visibility, Essential View, glove-hostile inputs (6 gaps)
- [review-session-5.md](review-session-5.md) -- Session 5 full-stack audit, bug status update, decision logic deep-dive

### App Summary
US-focused backcountry planning tool. NOAA/NWS + Avalanche.org + SNOTEL/NOHRSC + Open-Meteo.
React SPA frontend + Express API backend. No PWA/offline. No mobile-native app.

### Key Bugs -- Current Status (Session 5, 2026-03-13)
- FIXED: `createUnavailableWeatherData()` now returns null (not 0)
- FIXED: `deriveOverallDangerLevelFromElevations()` uses Math.max (not average/downgrade)
- FIXED: `createUnavailableFireRiskData` returns level:null (not 0)
- FIXED: L3 Considerable now addBlocker() in decision.ts (was CAUTION-only)
- FIXED: Gear suggestions now include ice axe/crampons for deep snow/icy+cold
- FIXED: Wind loading hints gated on `avalancheRelevant || resolvedWindDirection` (not just !avalancheUnknown)
- OPEN: Expired bulletins may preserve stale danger level
- OPEN: terrain-condition.js snowTrendHours uses current tempF not per-row tempF
- OPEN: No aspect overlap WARNING shown to user (data computed but display unverified)

### Persistent Critical Gaps (all sessions)
1. NO offline/PWA -- fully network-dependent
2. NO US-only coverage disclosure on landing page
3. NO emergency/SOS feature
4. NO acclimatization/AMS guidance
5. NO field observation logging
6. SAT one-liner default 170 chars (Garmin inReach limit is 160)
7. No weather model source differentiation (GFS vs ECMWF)
8. Score card displays before Decision Gate (raw % before verdict)
9. Threshold inputs are type="number" only -- no sliders for glove use
10. No pressure trend rate interpretation
