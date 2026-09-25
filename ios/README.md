# Conditions for iOS

A native SwiftUI client for the Backcountry Conditions API. It uses the web app's design
(sky tokens, day strips, status tags, Newsreader-style titles) with iOS Liquid Glass for the
bars and controls. Like the web frontend, it only presents: every decision, hourly check,
comparison and trip verdict comes from the backend's evaluation.

## Run it

Requirements: Xcode 27 with the iOS 26 SDK.

1. Start the API: `cd backend && npm run dev` (port 3001).
2. Open `ios/BackcountryConditions.xcodeproj`, choose the **Conditions** scheme and an iPhone
   simulator, and run.

In the simulator the app calls `http://localhost:3001` by default. On a phone it calls the
deployed API (`https://apivps.conditions.weiranxiong.com`). To use another server (for example
your Mac's backend from a phone on the same network), change it in
**Plan › Settings (gear) › Conditions server**. The app allows plain HTTP only on local
networks (`NSAllowsLocalNetworking`).

With no server running, **Try a sample** (or Settings › Add the sample plan) loads a bundled
Mount Shasta report (`Resources/demo-report.json`) so every screen can be explored offline.

From the command line:

```bash
cd ios
xcodebuild -project BackcountryConditions.xcodeproj -scheme Conditions \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## What's where

| Path | Contents |
| --- | --- |
| `BackcountryConditions/App` | App entry, tab bar, deep links (`conditions://plan/<id>`, `conditions://report/<token>`), background watch checks |
| `BackcountryConditions/Models` | `JSON` (tolerant payload reader), `Plan` (and the web's saved-report format), `Report`, `Preferences` (units, activities, limits, route timing; synced in the web's `UserPreferences` shape), `Route` (GPX parsing, approach params) |
| `BackcountryConditions/Services` | `APIClient`, `AccountStore` (session cookie, allowances, feature flags, AI availability, preference sync), `PlanStore` (plans, reports, AI explanations and chats, saved snapshots, watches, account saves), `Notifier` |
| `BackcountryConditions/Design` | Page, cards, notices, chips and the other shared views; report data export |
| `BackcountryConditions/Views` | Plan, New plan (day trip or multi-day), Brief, chapters (Weather, Terrain & snow, Timing, Route, Checks & sources, Gear), report sections, AI explanation and report chat, Trip, Compare (days, objectives, routes), Saved, Watchlist, Search and map picker, plan and trip maps, Settings, Account, Status, Administration |
| `Shared` | Code compiled into the app and the widget: palette, decision levels, day strip, widget snapshot |
| `ConditionsWidget` | WidgetKit extension: Next plan (small, medium, lock screen) |
| `Config` | Info.plists and entitlements |

The project file is hand-written with file-system-synchronized groups: new files in these
folders are picked up automatically, so there is no file list to maintain.

## Parity with the web app

- **Accounts.** Sign in, create an account, reset a password (with the code from the email
  link), verify email, usage and plan, connected AI apps (MCP). The session is the backend's
  `bc_session` cookie. Preferences sync with the account the way the web app does.
- **Preferences.** Appearance, °F/°C, mph/km/h, ft/m, 12/24-hour clock, default start and
  duration, per-activity limits (including your own activities), approach adjustment and route
  timing. Units go to the backend as plan params; loaded reports are re-evaluated when they change.
- **Planning.** Search, map pin, current location, recents and quick locations; trailhead
  elevation; GPX import. Multi-day trips have a name, layovers, high points, an exit, bail points
  and GPX splitting, as in the web form.
- **Brief and chapters.** Everything the web report shows: insights, field reports, route,
  precipitation, heat/fire/air/visibility, comfort, hourly table, approach, surface, wind loading,
  terrain window, snow observations, satellite snow, hour to watch, other departures (with "use
  this start"), contingency, sources, day-over-day, score breakdown, supplemental sources,
  alerts, gear and packing list, full report, data export.
- **AI.** "The report, explained", the report assistant (streamed), trip and compare-days chats,
  route suggestions and analysis. These need an account, as on the web.
- **Maps.** The brief, the Route chapter and a trip's brief show the plan on a map (Apple Maps:
  terrain, satellite or roads): the objective in its decision's colour, the route or GPX track and
  its numbered checkpoints, and a trip's trailhead, camps (coloured by the night check), high
  points (by the day check), exit and bail points. Tap it for the full-screen map, with pin details
  and directions in Maps. The Plan tab's map button shows every plan at its objective.
- **Library and watches.** Save, share links and email go through the account; saved reports,
  saved trips and shared links open in the app. The watchlist shows the account's server-checked
  watches (check now, review, history, email alerts) next to the ones on this iPhone.
- **Compare.** Days (ranked, tradeoffs, chat), objectives (shortlist, plan A/B) and routes.
- **Allowances.** Signed in, new reports count against the account; signed out, 10 reports per
  device, like the web's guest limit (not applied when the server has accounts turned off).
- **Also:** service status, privacy and terms, and Administration for the owner account.

## Backend endpoints used

- `GET /api/search`: place search
- `GET /api/safety`: a day plan's report and evaluation (`camp_night=1` for a trip day that ends at camp)
- `POST /api/evaluate`: re-evaluates a report at another elevation (Terrain & snow › Check an elevation)
- `GET /api/start-time-scenarios`: Timing › Other departures
- `POST /api/trip-forecasts`: Compare
- `POST /api/itineraries/check`: multi-day trips
- `GET /api/healthz`: Settings › Test connection, Service status, AI availability
- `GET /api/feature-flags`: which features the server has on
- `GET /api/day-over-day`: Checks & sources › Change from the prior day
- `/api/auth/*`, `/api/account/*`: accounts, preferences, saved reports, trips and watches
- `GET /api/reports/shared/:token`: shared report links
- `POST /api/ai-brief`, `POST /api/report-chat`, `POST /api/snow-vision`: AI features
- `GET /api/route-suggestions`, `POST /api/route-analysis`: routes (NDJSON progress)
- `/api/admin/*`, `/api/report-logs`, `/api/ai-usage`: Administration

Compare and multi-day trips need the server's database. When those endpoints answer `503`,
the app checks each day with `/api/safety` instead and says so. It doesn't rank the days and
doesn't make up a trip verdict ("No trip verdict").

## Watches, notifications and widgets

- **Watchlist.** Watching a plan asks for notification permission. Each check compares the
  backend's new decision with the last one: a change moves the plan to *Changed* and posts a
  local notification. Watched plans are also checked in the background with a
  `BGAppRefreshTask` (`app.summitsafe.conditions.watch-check`); iOS decides when that runs.
- **Widget.** The app writes a small snapshot of upcoming plans to the App Group
  `group.app.summitsafe.conditions` after every check, and the widget renders the next plan
  from it without calling the server. Tapping it opens `conditions://plan/<id>`.
- **Signing.** Both targets use automatic signing with a development team set in the project.
  Change `DEVELOPMENT_TEAM` to use yours. With a free personal team, the app stops opening
  after 7 days, and you run it from Xcode again to renew it.

## Known gaps

- Google sign-in is web only (the backend verifies web client ID tokens). A Google account can
  set a password with Reset password and then sign in here.
- Reset and verification links in emails open the web app; the app takes the reset code by hand.
- Universal links for `https://…/report/<token>` need an apple-app-site-association file on the
  web host; until then, paste a link under Saved › Open a shared link.
