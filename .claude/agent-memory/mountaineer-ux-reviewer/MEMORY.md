# Mountaineer UX Reviewer - Persistent Memory

## Project: SummitSafe / Backcountry Conditions

### App Summary
Planning tool synthesizing weather, avalanche, snowpack, alerts, AQI, fire risk, and terrain classification
into a single report-card interface. US-focused (NOAA/NWS, Avalanche.org, SNOTEL/NOHRSC).

### Key File Paths
- `frontend/src/App.tsx` - 8600-line monolith; all UI logic, state, report cards, decision gate
- `backend/index.js` - 4000-line monolith; full safety pipeline, all provider calls, score synthesis
- `frontend/src/app/types.ts` - core domain interfaces (SafetyData, UserPreferences, etc.)
- `frontend/src/app/constants.ts` - lapse rates, unit conversions, map styles
- `backend/src/utils/gear-suggestions.js` - layering gear recommendations engine
- `backend/src/utils/terrain-condition.js` - terrain/trail surface classification
- `backend/src/utils/snowpack.js` - SNOTEL+NOHRSC integration and historical comparison
- `backend/src/utils/sat-oneliner.js` - satellite message formatter

### Data Sources
- Weather: NOAA/NWS primary, Open-Meteo fallback
- Avalanche: Avalanche.org + center-specific scraping (Utah fallback)
- Snowpack: NRCS AWDB/SNOTEL + NOAA NOHRSC
- Alerts: NWS
- Solar: api.sunrisesunset.io
- Search: Nominatim + local peak catalog (10 popular peaks)
- AQI/Precip: Open-Meteo

### Confirmed Features (Review Session 1)
- Objective search (text + map click + coordinate paste)
- Time-aware condition reports (date + start time + travel window hours)
- GO/CAUTION/NO-GO decision gate with blocking/caution logic
- Avalanche forecast with center/zone matching, elevation bands, problems, bottom line
- Snowpack (SNOTEL + NOHRSC) with historical % of average
- Wind direction analysis (leeward aspects, cross-loading) in frontend
- Terrain/trail surface classification (6 categories: fresh powder, corn, wet/slushy, icy, wet/muddy, dry)
- Travel window planner (hourly pass/fail vs user-configurable thresholds)
- Elevation lapse rate estimation (3.3F/1000ft, 2 mph wind/1000ft)
- SAT one-liner message (170-char satellite-optimized condition summary)
- Team brief / field brief (structured departure checklist text, copyable)
- Printable report (HTML pop-up with all key data)
- Multi-day trip forecast (2-7 day comparison view)
- Better-day suggestions (auto-scans next 7 days when current day is CAUTION/NO-GO)
- Day-over-day comparison (score delta vs yesterday)
- Source freshness tracking per data feed
- Links to CalTopo, Gaia GPS, Windy from planner
- Unit preferences: F/C, ft/m, mph/kph, 12h/24h
- Shareable URLs (URL state sync)
- Dark/light/system theme

### Critical Gaps Identified (Review Session 1)
1. NO offline/PWA capability - fully network-dependent, no service worker
2. NO US-only coverage disclosure - users outside US will silently get degraded or failed data
3. NO emergency/SOS feature or emergency contact information display
4. NO route-specific aspect/elevation input - avalanche aspect rose not connected to user's planned route
5. NO permit or land-management information
6. NO acclimatization scheduling or AMS/altitude illness guidance
7. NO weather model source differentiation (GFS vs ECMWF vs NAM) for forecast quality context
8. NO observation/field notes logging (no way to record what you found vs forecast)
9. Gear suggestions are layering-only - no hardware (crampons, ice axe, rope, crevasse rescue kit)
10. Turnaround time input exists but is not wired to the travel window decision engine in a visible way
11. Popular peak catalog only has 10 peaks - international peaks absent
12. Wind loading aspect analysis is visual but not integrated into avalanche scoring
13. NO graupel-specific surface ice warning despite graupel detection in weather parsing

### Domain Conventions Observed
- Danger scale: 1=Low, 2=Moderate, 3=Considerable, 4=High, 5=Extreme (IFAG standard)
- Lapse rate: 3.3F/1000ft (TEMP_LAPSE_F_PER_1000FT constant) - standard environmental lapse rate
- Wind gust increase: 2-2.5 mph/1000ft - appropriate for ridge exposure estimation
- Terrain condition labels include emoji - works on-screen but strips oddly in plain-text exports
- SAT line format: "Name Date Start | temp wind precip | Avy | Worst12h | GO/CAUTION/NO-GO"
- Score: 0-100% synthetic safety score (not standard mountaineering framework like FACETS)

### UX Patterns (Extreme Conditions)
- App is a web SPA - NOT mobile-native, no glove-mode touch targets assessed
- No font-size override for low-light/glare readability
- Card sorting is dynamic by risk level - smart but potentially disorienting in the field
- Travel threshold editor requires precise text input (not slider) - difficult with gloves

See `review-session-1.md` for full detailed notes.
See `review-session-2.md` for deep safety code audit findings (10 specific bugs identified).
See `review-session-3.md` for feature gap and decision-support analysis (8 new gaps identified).
See `review-session-4.md` for Session 4 full review (6 new gaps identified, all prior gaps re-confirmed open).

### Key Safety Bugs Confirmed in Code (Session 2)
- backend/index.js ~2728: Avalanche danger level silently DOWNGRADED by 1 in deriveOverallDangerLevelFromElevations()
- backend/index.js ~461: createUnavailableWeatherData() returns 0 for wind/precip/temp (looks like good conditions)
- frontend/src/App.tsx ~1729: Considerable danger (L3) only triggers CAUTION, not NO-GO
- backend/index.js ~3687: Expired bulletins set dangerUnknown:false, preserving stale danger level in score
- backend/src/utils/terrain-condition.js ~170: snowTrendHours uses current-hour tempF instead of per-row tempF
- backend/src/utils/fire-risk.js ~4: Unavailable fire risk returns level:0 label:'Low' (no penalty applied)

### New Feature Gaps Identified (Session 3, all still open in Session 4)
- Turnaround time never checked against sunset - daylight check only validates start time
- Wind direction not cross-referenced against avalanche problem aspects in scoring
- Forecast lead time confidence penalty is silent (not shown as a UI badge/warning)
- Snow loading rate (recent 24h snowfall) not shown adjacent to avalanche problem cards
- Pressure trend: basic Rising/Falling/Steady label added (line 4195-4208) but rate interpretation absent
- Gear suggestions missing ice axe/crampons/helmet for alpine snow/ice terrain (confirmed in gear-suggestions.js)
- Ground blizzard scenario (high wind + cold + snowpack but clear sky) not in visibility risk
- Lapse rate bands have no inversion detection or warning

### New Feature Gaps Identified (Session 4)
- GAP-4.1: AvalancheForecastCard is fully hidden in Essential View (!isEssentialView guard, line 8436) - SAFETY CRITICAL
- GAP-4.2: Score Trace shows only top 5 factors by absolute impact - data-gap/coverage-unavailable factors can be hidden
- GAP-4.3: Plan Snapshot card does not show turnaround time or turnaround-vs-sunset delta
- GAP-4.4: Travel window threshold editor uses type="number" inputs only - no sliders - glove-hostile on mobile
- GAP-4.5: Wind Loading Hints card gated on !avalancheUnknown - hidden precisely when coverage is absent and wind loading matters most
- GAP-4.6: No aspect overlap alert between wind leeward aspects and bulletin problem aspects (data exists, comparison never made)
- Score card order: raw percentage (order:0) displays before Decision Gate (order:100) - verdict should precede score
- Decision Gate check list hidden in <details> collapse - no compact pass/fail icon row visible without expanding
