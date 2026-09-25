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
| `BackcountryConditions/App` | App entry, tab bar, deep links, background watch checks |
| `BackcountryConditions/Models` | `JSON` (tolerant payload reader), `Plan`, `Report` (reads `/api/safety` and its `evaluation`) |
| `BackcountryConditions/Services` | `APIClient`, `PlanStore` (plans, reports, saved snapshots, watches; kept on device), `Notifier` |
| `BackcountryConditions/Design` | Page, cards, notices, chips and the other shared views |
| `BackcountryConditions/Views` | Plan, New plan, Brief (sky hero and check cards), chapters (Weather, Terrain & snow, Timing, Checks & sources, Gear), Trip, Compare, Saved, Watchlist, Search, Settings |
| `Shared` | Code compiled into the app and the widget: palette, decision levels, day strip, widget snapshot |
| `ConditionsWidget` | WidgetKit extension: Next plan (small, medium, lock screen) |
| `Config` | Info.plists and entitlements |

The project file is hand-written with file-system-synchronized groups: new files in these
folders are picked up automatically, so there is no file list to maintain.

## Backend endpoints used

- `GET /api/search`: place search
- `GET /api/safety`: a day plan's report and evaluation (`camp_night=1` for a trip day that ends at camp)
- `POST /api/evaluate`: re-evaluates a report at another elevation (Terrain & snow › Check an elevation)
- `GET /api/start-time-scenarios`: Timing › Other departures
- `POST /api/trip-forecasts`: Compare
- `POST /api/itineraries/check`: multi-day trips
- `GET /api/healthz`: Settings › Test connection

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

- Plans, saved reports and watches live on the device only; the app doesn't sign in or sync
  with web accounts.
- Settings has no unit choices yet, so reports use the backend's defaults (°F, mph, ft,
  12-hour clock).
- Route/GPX approaches, AI briefs and report chat from the web app aren't in the iOS app.
