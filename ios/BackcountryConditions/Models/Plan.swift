import Foundation

/// A place the traveler is heading to: a peak, trailhead or camp.
struct Place: Codable, Hashable, Sendable, Identifiable {
    var name: String
    var lat: Double
    var lon: Double
    var elevationFt: Double?
    var kind: String?

    var id: String { "\(name)|\(lat)|\(lon)" }

    /// "Mount Shasta, California" reads as "Mount Shasta" in titles.
    var shortName: String {
        name.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? name
    }

    var region: String? {
        let parts = name.split(separator: ",").dropFirst().map { $0.trimmingCharacters(in: .whitespaces) }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

/// Activity profiles. Labels and default limits mirror `frontend/src/app/activity-profiles.ts`;
/// the backend applies the same defaults when the app sends only `activity`.
enum Activity: String, Codable, CaseIterable, Identifiable, Sendable {
    case hiking, backpacking, scrambling
    case alpineClimbing = "alpine-climbing"
    case mountaineering
    case snowClimbing = "snow-climbing"
    case skiTouring = "ski-touring"
    case trailRunning = "trail-running"
    case backcountry

    var id: String { rawValue }

    var label: String {
        switch self {
        case .hiking: "Mountain hiking"
        case .backpacking: "Backpacking"
        case .scrambling: "Scrambling"
        case .alpineClimbing: "Alpine climbing"
        case .mountaineering: "Mountaineering"
        case .snowClimbing: "Snow climbing"
        case .skiTouring: "Ski touring"
        case .trailRunning: "Trail running"
        case .backcountry: "General backcountry"
        }
    }

    var shortLabel: String {
        switch self {
        case .hiking: "Hike"
        case .backpacking: "Backpack"
        case .scrambling: "Scramble"
        case .alpineClimbing: "Alpine"
        case .mountaineering: "Mountaineer"
        case .snowClimbing: "Snow climb"
        case .skiTouring: "Ski tour"
        case .trailRunning: "Run"
        case .backcountry: "General"
        }
    }

    var defaultLimits: Limits {
        switch self {
        case .hiking: Limits(maxGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95)
        case .backpacking: Limits(maxGustMph: 30, maxPrecipChance: 60, minFeelsLikeF: 15, maxFeelsLikeF: 90)
        case .scrambling: Limits(maxGustMph: 20, maxPrecipChance: 45, minFeelsLikeF: 10, maxFeelsLikeF: 90)
        case .alpineClimbing: Limits(maxGustMph: 18, maxPrecipChance: 35, minFeelsLikeF: 10, maxFeelsLikeF: 85)
        case .mountaineering: Limits(maxGustMph: 20, maxPrecipChance: 35, minFeelsLikeF: -5, maxFeelsLikeF: 85)
        case .snowClimbing: Limits(maxGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 0, maxFeelsLikeF: 85)
        case .skiTouring: Limits(maxGustMph: 25, maxPrecipChance: 50, minFeelsLikeF: -5, maxFeelsLikeF: 90)
        case .trailRunning: Limits(maxGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85)
        case .backcountry: Limits(maxGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95)
        }
    }
}

/// The traveler's weather limits, sent as plan params.
struct Limits: Codable, Hashable, Sendable {
    var maxGustMph: Int
    var maxPrecipChance: Int
    var minFeelsLikeF: Int
    var maxFeelsLikeF: Int
}

/// One day of a multi-day trip: where it starts and ends, and when it leaves.
struct Stage: Codable, Hashable, Sendable, Identifiable {
    var id = UUID()
    var start: String
    var travelHours: Int
    var from: Place
    var to: Place
    /// A layover day stays at last night's camp.
    var layover: Bool?
    /// High points or passes the day crosses, checked besides the camp (up to two).
    var checkpoints: [Place]?

    var isLayover: Bool { layover ?? (from == to) }
}

extension Place {
    /// An itinerary point as `/api/itineraries/check` reads one.
    var json: JSON {
        var object: [String: JSON] = ["name": .string(shortName), "lat": .number(lat), "lon": .number(lon)]
        object["elevationFt"] = elevationFt.map(JSON.number) ?? .null
        return .object(object)
    }

    init?(json: JSON) {
        guard let lat = json["lat"].double, let lon = json["lon"].double else { return nil }
        self.init(name: json["name"].string ?? String(format: "%.4f, %.4f", lat, lon), lat: lat, lon: lon,
                  elevationFt: json["elevationFt"].double ?? json["elevation"].double, kind: nil)
    }

    /// A dropped pin, named by its coordinates.
    static func pin(lat: Double, lon: Double, name: String? = nil) -> Place {
        Place(name: name ?? String(format: "%.4f, %.4f", lat, lon), lat: lat, lon: lon, elevationFt: nil, kind: "Pin")
    }
}

/// Where a check last left the plan, for the watchlist.
struct WatchState: Codable, Hashable, Sendable {
    var level: DecisionLevel
    var checkedAt: Date
    var previousLevel: DecisionLevel?
    var changedAt: Date?
    var reason: String?
    var reviewed: Bool = true
    var incomplete: Bool = false
}

struct Plan: Codable, Hashable, Sendable, Identifiable {
    var id = UUID()
    var objective: Place
    var activity: Activity
    /// `yyyy-MM-dd`, the objective's local date.
    var date: String
    /// `HH:mm`, 24-hour.
    var start: String
    var travelHours: Int
    var limits: Limits
    /// Present for multi-day trips; nil for a day plan.
    var stages: [Stage]?
    var watched: Bool = false
    var watch: WatchState?
    var createdAt = Date()
    /// Backed by the bundled sample report instead of the server.
    var isSample: Bool = false
    /// The traveler's own activity, planned as `activity` with its own limits.
    var customActivityID: String?
    var customActivityLabel: String?
    /// Trailhead elevation, when the traveler knows it; the backend estimates it otherwise.
    var trailheadFt: Double?
    /// The route the plan follows, and its analysis.
    var route: PlanRoute?
    /// A multi-day trip's name, and places to leave it early.
    var tripName: String?
    var bailPoints: [Place]?
    /// The latest report as saved to the account, and its share link token.
    var accountReportID: String?
    var shareToken: String?
    /// The report generation the account copy was saved from.
    var accountReportGeneratedAt: String?
    /// The account's watch of this plan, when it has one.
    var accountWatchID: String?

    var isTrip: Bool { (stages?.count ?? 0) >= 2 }

    var activityLabel: String { customActivityLabel ?? activity.label }

    /// Where the plan's limits and route timing are kept in preferences.
    var activityKey: String { customActivityID ?? activity.rawValue }

    var title: String {
        if isTrip, let tripName, !tripName.isEmpty { return tripName }
        return objective.shortName
    }

    var endDate: String {
        guard let stages, stages.count > 1 else { return date }
        return DateText.addDays(date, stages.count - 1)
    }

    /// The traveler's limits and display units (the web's `planSettingsParams`).
    var settingsParams: [String: String] {
        var params = [
            "max_gust_mph": String(limits.maxGustMph),
            "max_precip_chance": String(limits.maxPrecipChance),
            "min_feels_like_f": String(limits.minFeelsLikeF),
            "max_feels_like_f": String(limits.maxFeelsLikeF),
        ]
        params.merge(PreferencesStore.shared.preferences.unitParams) { _, new in new }
        return params
    }

    /// The flat plan params `/api/safety` and `/api/evaluate` read: when, for how long, the limits,
    /// the display units and the approach.
    var planParams: [String: String] {
        let preferences = PreferencesStore.shared.preferences
        var params = settingsParams
        params["date"] = date
        params["start"] = start
        params["travel_window_hours"] = String(travelHours)
        params["activity"] = activity.rawValue
        params.merge(Approach.params(enabled: preferences.approachElevationAdjustment, trailheadFt: trailheadFt, route: route,
                                     timing: preferences.routeTiming(for: activityKey))) { _, new in new }
        return params
    }

    /// The plan an analysis or check was run for, to tell when it's out of date.
    var timingKey: String { "\(date)|\(start)|\(travelHours)" }

    /// Everything a check of the plan sends the server, to tell when a check or comparison no longer
    /// matches the plan (it was edited, or the units or approach changed, while it ran).
    var checkKey: String {
        let request: JSON = isTrip ? itineraryRequest()
            : .object(planParams.mapValues(JSON.string).merging(["lat": .number(objective.lat), "lon": .number(objective.lon)]) { value, _ in value })
        return String(decoding: request.prettyData, as: UTF8.self)
    }

    /// `/api/itineraries/check`'s body (the web's `buildItineraryRequest`).
    func itineraryRequest(startDate: String? = nil) -> JSON {
        var params = settingsParams
        if !PreferencesStore.shared.preferences.approachElevationAdjustment { params["approach"] = "off" }
        let timing = PreferencesStore.shared.preferences.routeTiming(for: activityKey)
        if timing.ascentMinutesPer1000Ft > 0 { params["ascent_min_per_kft"] = String(timing.ascentMinutesPer1000Ft) }
        return .object([
            "startDate": .string(startDate ?? date),
            "name": .string(tripName?.isEmpty == false ? tripName! : objective.shortName),
            "activity": .string(activity.rawValue),
            "plan": .object(params.mapValues { .string($0) }),
            "bailPoints": .array((bailPoints ?? []).map(\.json)),
            "stages": .array((stages ?? []).map { stage in
                .object(["start": .string(stage.start), "travelHours": .number(Double(stage.travelHours)),
                         "from": stage.from.json, "to": stage.to.json,
                         "checkpoints": .array((stage.checkpoints ?? []).map(\.json))])
            }),
        ])
    }

    /// The same plan for one day of its trip.
    func dayPlan(_ index: Int) -> Plan? {
        guard let stages, stages.indices.contains(index) else { return nil }
        let stage = stages[index]
        var day = self
        day.id = UUID()
        day.stages = nil
        day.objective = stage.to
        day.date = DateText.addDays(date, index)
        day.start = stage.start
        day.travelHours = stage.travelHours
        day.tripName = nil
        day.bailPoints = nil
        day.watched = false
        day.watch = nil
        day.accountReportID = nil
        day.shareToken = nil
        day.accountWatchID = nil
        return day
    }
}

// MARK: - The web app's saved report format

extension Plan {
    /// The preferences a report was checked with, in the web's shape: the traveler's settings with
    /// this plan's activity, limits and duration.
    var webPreferences: JSON {
        var preferences = PreferencesStore.shared.preferences
        if let custom = customActivityID, preferences.customActivities.contains(where: { $0.id == custom }) {
            preferences.customActivityID = custom
        } else {
            preferences.customActivityID = nil
        }
        preferences.defaultActivity = activity
        preferences.limits = limits
        preferences.travelWindowHours = travelHours
        return preferences.web
    }

    /// A report snapshot as the web app saves one (`PersistedReport`, version 3), so saved reports,
    /// watches and share links work in both apps.
    func persistedReport(_ report: Report, aiNarrative: String? = nil, chat: [ChatMessage] = []) -> JSON {
        let units = Units.current
        let routeJSON: JSON = .object([
            "routeSuggestions": .null,
            "routeAnalysis": route?.analysis ?? .null,
            "customRouteName": .string(route?.gpx == nil ? route?.name ?? "" : ""),
            "gpxRoute": route?.gpx?.json ?? .null,
            "routeShape": .string(route?.shape ?? "auto"),
        ])
        return .object([
            "version": .number(3),
            "savedAt": .string(ISO8601DateFormatter.flexible.string(from: Date())),
            "plan": .object([
                "lat": .number(objective.lat),
                "lon": .number(objective.lon),
                "objectiveName": .string(objective.shortName),
                "searchQuery": .string(objective.name),
                "forecastDate": .string(report.selectedDate ?? date),
                "alpineStartTime": .string(start),
                "targetElevationInput": .string(""),
                "trailheadElevationInput": .string(trailheadFt.map { String(Int(units.elevation($0).rounded())) } ?? ""),
                "travelWindowHours": .number(Double(travelHours)),
            ]),
            "preferences": webPreferences,
            "safetyData": report.json,
            "ai": .object([
                "aiBriefNarrative": aiNarrative.map(JSON.string) ?? .null,
                "snowVisionAnalysis": .null,
                "snowVisionImage": .null,
                "reportChatMessages": .array(chat.map(\.json)),
            ]),
            "route": routeJSON,
        ])
    }

    /// A plan read back from a saved report snapshot.
    init?(persisted snapshot: JSON) {
        let plan = snapshot["plan"]
        let data = snapshot["safetyData"]
        guard let lat = plan["lat"].double, let lon = plan["lon"].double else { return nil }
        let preferences = snapshot["preferences"]
        let activity = (data.at("forecast.activity").string ?? preferences["defaultActivity"].string).flatMap(Activity.init(rawValue:)) ?? .backcountry
        let evaluated = data.at("evaluation.plan.limits")
        let limits = Limits(web: .object([
            "maxWindGustMph": evaluated["maxWindGustMph"].isNull ? preferences["maxWindGustMph"] : evaluated["maxWindGustMph"],
            "maxPrecipChance": evaluated["maxPrecipChance"].isNull ? preferences["maxPrecipChance"] : evaluated["maxPrecipChance"],
            "minFeelsLikeF": evaluated["minFeelsLikeF"].isNull ? preferences["minFeelsLikeF"] : evaluated["minFeelsLikeF"],
            "maxFeelsLikeF": evaluated["maxFeelsLikeF"].isNull ? preferences["maxFeelsLikeF"] : evaluated["maxFeelsLikeF"],
        ]), fallback: activity.defaultLimits) ?? activity.defaultLimits
        let name = plan["objectiveName"].string ?? data.at("location.name").string ?? "Objective"
        self.init(objective: Place(name: name, lat: lat, lon: lon, elevationFt: data.at("weather.elevation").double, kind: nil),
                  activity: activity,
                  date: plan["forecastDate"].string ?? data.at("forecast.selectedDate").string ?? DateText.today(),
                  start: plan["alpineStartTime"].string ?? "07:00",
                  travelHours: plan["travelWindowHours"].int ?? 12,
                  limits: limits)
        let customID = preferences["customActivityId"].string
        if let customID, let custom = preferences["customActivities"].array.first(where: { $0["id"].string == customID }) {
            customActivityID = customID
            customActivityLabel = custom["label"].string
        }
        let route = snapshot["route"]
        let gpx = GpxRoute(json: route["gpxRoute"])
        let routeName = gpx?.name ?? route["customRouteName"].string ?? route.at("routeAnalysis.routeName").string
        if let routeName {
            self.route = PlanRoute(name: routeName, gpx: gpx, shape: route["routeShape"].string ?? "auto",
                                   analysis: route["routeAnalysis"].isNull ? nil : route["routeAnalysis"])
        }
    }
}

/// A report kept as it was when saved. It never updates.
struct SavedReport: Codable, Hashable, Sendable, Identifiable {
    var id = UUID()
    var plan: Plan
    var savedAt = Date()
    var reportData: Data
    var aiNarrative: String?
    var chat: [ChatMessage]?
}

/// Date and clock text in the formats the API and the screens use.
enum DateText {
    static let iso: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(_ iso: String) -> Date? { self.iso.date(from: iso) }

    static func addDays(_ iso: String, _ days: Int) -> String {
        guard let date = date(iso), let next = Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: date) else { return iso }
        return self.iso.string(from: next)
    }

    static func today() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    /// "Sat, May 15"
    static func short(_ iso: String) -> String {
        guard let date = date(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: date)
    }

    /// "Saturday, May 15"
    static func long(_ iso: String) -> String {
        guard let date = date(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: date)
    }

    /// "Jun 4–7" or "May 30 – Jun 2"
    static func range(_ start: String, _ end: String) -> String {
        guard let a = date(start), let b = date(end) else { return "\(start) – \(end)" }
        let month = DateFormatter(); month.timeZone = TimeZone(identifier: "UTC"); month.dateFormat = "MMM"
        let day = DateFormatter(); day.timeZone = TimeZone(identifier: "UTC"); day.dateFormat = "d"
        if month.string(from: a) == month.string(from: b) { return "\(month.string(from: a)) \(day.string(from: a))–\(day.string(from: b))" }
        return "\(month.string(from: a)) \(day.string(from: a)) – \(month.string(from: b)) \(day.string(from: b))"
    }

    /// "03:00" → "3:00 AM" (or "03:00" on a 24-hour clock)
    static func clock(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return hhmm }
        return clock(minutes: (parts[0] % 24) * 60 + parts[1])
    }

    /// Minutes after midnight for "03:00".
    static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    /// "03:00" plus hours, as "12:00".
    static func clockAdding(_ hhmm: String, hours: Int) -> String {
        guard let start = minutes(hhmm) else { return hhmm }
        let total = (start + hours * 60) % (24 * 60)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    /// "6:49:16 AM" (sunrisesunset.io) → minutes after midnight.
    static func minutesFromSolar(_ text: String?) -> Int? {
        guard let text else { return nil }
        let pieces = text.split(separator: " ")
        guard pieces.count == 2 else { return nil }
        let clock = pieces[0].split(separator: ":").compactMap { Int($0) }
        guard clock.count >= 2 else { return nil }
        var hour = clock[0] % 12
        if pieces[1].uppercased() == "PM" { hour += 12 }
        return hour * 60 + clock[1]
    }

    static func clock(minutes: Int) -> String {
        let wrapped = ((minutes % 1440) + 1440) % 1440
        let hour = wrapped / 60
        if Units.current.timeStyle == .twentyFour { return String(format: "%02d:%02d", hour, wrapped % 60) }
        let suffix = hour < 12 ? "AM" : "PM"
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return String(format: "%d:%02d %@", twelve, wrapped % 60, suffix)
    }

    /// "yyyy-MM-dd" for a local calendar date.
    static func iso(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2026, parts.month ?? 1, parts.day ?? 1)
    }

    /// "HH:mm" for a local time.
    static func hhmm(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// A local Date for "yyyy-MM-dd" (midnight), for date pickers.
    static func localDate(_ iso: String) -> Date? {
        guard let parsed = date(iso) else { return nil }
        let utc = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: parsed)
        return Calendar.current.date(from: DateComponents(year: utc.year, month: utc.month, day: utc.day))
    }

    /// A local Date today at "HH:mm", for time pickers.
    static func localTime(_ hhmm: String) -> Date? {
        guard let minutes = minutes(hhmm) else { return nil }
        return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date())
    }

    /// Timestamps from the server ("2026-09-24T18:03:11.201Z").
    static func stamp(_ text: String?) -> String? {
        guard let text, let date = ISO8601DateFormatter.parse(text) else { return nil }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func relative(_ date: Date) -> String {
        if abs(date.timeIntervalSinceNow) < 60 { return "just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}
