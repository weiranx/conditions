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

    var isTrip: Bool { (stages?.count ?? 0) >= 2 }

    var endDate: String {
        guard let stages, stages.count > 1 else { return date }
        return DateText.addDays(date, stages.count - 1)
    }

    /// The flat plan params `/api/safety` and `/api/evaluate` read.
    var planParams: [String: String] {
        [
            "date": date,
            "start": start,
            "travel_window_hours": String(travelHours),
            "activity": activity.rawValue,
            "max_gust_mph": String(limits.maxGustMph),
            "max_precip_chance": String(limits.maxPrecipChance),
            "min_feels_like_f": String(limits.minFeelsLikeF),
            "max_feels_like_f": String(limits.maxFeelsLikeF),
        ]
    }
}

/// A report kept as it was when saved. It never updates.
struct SavedReport: Codable, Hashable, Sendable, Identifiable {
    var id = UUID()
    var plan: Plan
    var savedAt = Date()
    var reportData: Data
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

    /// "03:00" → "3:00 AM"
    static func clock(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return hhmm }
        let hour = parts[0] % 24
        let suffix = hour < 12 ? "AM" : "PM"
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return String(format: "%d:%02d %@", twelve, parts[1], suffix)
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
        let hour = (minutes / 60) % 24
        let suffix = hour < 12 ? "AM" : "PM"
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return String(format: "%d:%02d %@", twelve, minutes % 60, suffix)
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
