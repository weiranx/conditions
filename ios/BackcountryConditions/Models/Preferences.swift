import Foundation
import Observation
import SwiftUI

enum TemperatureUnit: String, Codable, CaseIterable, Sendable { case f, c }
enum WindUnit: String, Codable, CaseIterable, Sendable { case mph, kph }
enum ElevationUnit: String, Codable, CaseIterable, Sendable { case ft, m }
enum TimeStyle: String, Codable, CaseIterable, Sendable {
    case ampm
    case twentyFour = "24h"
}
enum ThemeMode: String, Codable, CaseIterable, Sendable { case system, light, dark }

/// How fast an activity moves; spreads route checkpoint and approach arrival times.
struct RouteTiming: Codable, Hashable, Sendable {
    var paceMinutesPerMile: Int
    var ascentMinutesPer1000Ft: Int
    var stopMinutes: Int

    static let paceRange = 5...90
    static let ascentRange = 0...120
    static let stopRange = 0...240
}

/// An activity the traveler named: planned as `baseActivity`, checked against its own limits.
struct CustomActivity: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var label: String
    var baseActivity: Activity

    static let maxCount = 6
    static let maxLabelLength = 40
}

extension Activity {
    var description: String {
        switch self {
        case .hiking: "On-trail and off-trail mountain travel without sustained technical climbing."
        case .backpacking: "Multi-day travel with a full pack, where each night at camp matters as much as each day on trail."
        case .scrambling: "Hands-on movement where wind, precipitation, and visibility quickly affect consequences."
        case .alpineClimbing: "Long, exposed objectives with technical transitions and limited retreat options."
        case .mountaineering: "Glaciated and high peaks on snow, ice, and rock, with rope teams, altitude, and long summit days."
        case .snowClimbing: "Snow and glacier objectives where refreeze, warming, and avalanche timing dominate."
        case .skiTouring: "Human-powered snow travel with avalanche exposure and transition time."
        case .trailRunning: "Fast summer movement with tighter heat limits and shorter stop buffers."
        case .backcountry: "A neutral baseline when the objective does not fit a more specific movement mode."
        }
    }

    var symbol: String {
        switch self {
        case .hiking: "figure.hiking"
        case .backpacking: "backpack"
        case .scrambling: "hand.raised"
        case .alpineClimbing: "figure.climbing"
        case .mountaineering: "mountain.2"
        case .snowClimbing: "snowflake"
        case .skiTouring: "figure.skiing.crosscountry"
        case .trailRunning: "figure.run"
        case .backcountry: "safari"
        }
    }

    /// Route timing defaults, as `frontend/src/app/activity-profiles.ts` sets them.
    var defaultRouteTiming: RouteTiming {
        switch self {
        case .hiking, .backcountry: RouteTiming(paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopMinutes: 45)
        case .backpacking: RouteTiming(paceMinutesPerMile: 35, ascentMinutesPer1000Ft: 50, stopMinutes: 60)
        case .scrambling: RouteTiming(paceMinutesPerMile: 35, ascentMinutesPer1000Ft: 55, stopMinutes: 60)
        case .alpineClimbing, .mountaineering: RouteTiming(paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 65, stopMinutes: 90)
        case .snowClimbing: RouteTiming(paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 60, stopMinutes: 90)
        case .skiTouring: RouteTiming(paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 50, stopMinutes: 60)
        case .trailRunning: RouteTiming(paceMinutesPerMile: 20, ascentMinutesPer1000Ft: 30, stopMinutes: 30)
        }
    }

    /// Wind and rain lead for trail activities; wind and cold for the rest (the brief's two numbers).
    var leadsWithRain: Bool { [.hiking, .backpacking, .trailRunning, .scrambling, .skiTouring, .backcountry].contains(self) }
}

/// The traveler's preferences. Kept on the device and, when signed in, synced to the account in the
/// web app's `UserPreferences` shape so both apps read the same settings.
struct Preferences: Codable, Equatable, Sendable {
    var defaultActivity: Activity = .hiking
    var customActivityID: String?
    var customActivities: [CustomActivity] = []
    /// Limits per built-in activity (raw value) or custom activity id.
    var activityLimits: [String: Limits] = [:]
    var activityRouteTiming: [String: RouteTiming] = [:]
    var defaultStartTime = "07:00"
    var travelWindowHours = 12
    var themeMode: ThemeMode = .system
    var temperatureUnit: TemperatureUnit = .f
    var windUnit: WindUnit = .mph
    var elevationUnit: ElevationUnit = .ft
    var timeStyle: TimeStyle = .ampm
    var approachElevationAdjustment = true

    /// The selected activity's key: a custom activity's id, or the built-in activity.
    var activeKey: String { customActivityID ?? defaultActivity.rawValue }

    var activeCustom: CustomActivity? { customActivities.first { $0.id == customActivityID } }

    var activeLabel: String { activeCustom?.label ?? defaultActivity.label }

    func limits(for key: String) -> Limits {
        if let saved = activityLimits[key] { return saved }
        if let custom = customActivities.first(where: { $0.id == key }) {
            return activityLimits[custom.baseActivity.rawValue] ?? custom.baseActivity.defaultLimits
        }
        return (Activity(rawValue: key) ?? .backcountry).defaultLimits
    }

    func routeTiming(for key: String) -> RouteTiming {
        if let saved = activityRouteTiming[key] { return saved }
        if let custom = customActivities.first(where: { $0.id == key }) {
            return activityRouteTiming[custom.baseActivity.rawValue] ?? custom.baseActivity.defaultRouteTiming
        }
        return (Activity(rawValue: key) ?? .backcountry).defaultRouteTiming
    }

    var limits: Limits {
        get { limits(for: activeKey) }
        set { activityLimits[activeKey] = newValue }
    }

    var routeTiming: RouteTiming {
        get { routeTiming(for: activeKey) }
        set { activityRouteTiming[activeKey] = newValue }
    }

    /// Display units and clock as plan params; the backend writes the evaluation's text in them.
    var unitParams: [String: String] {
        [
            "temp_unit": temperatureUnit.rawValue,
            "wind_unit": windUnit.rawValue,
            "elevation_unit": elevationUnit.rawValue,
            "time_style": timeStyle.rawValue,
        ]
    }

    /// What loaded reports were evaluated with besides the plan itself: display units (the evaluation's
    /// text is written in them), the approach switch and route timing (the approach hours).
    struct EvaluationInputs: Equatable {
        var units: [String: String]
        var approach: Bool
        var timing: [String: RouteTiming]
    }

    var evaluationInputs: EvaluationInputs {
        EvaluationInputs(units: unitParams, approach: approachElevationAdjustment, timing: activityRouteTiming)
    }

    var colorScheme: ColorScheme? {
        switch themeMode {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    // MARK: Custom activities

    mutating func addCustomActivity(label: String, base: Activity) -> CustomActivity? {
        let clean = label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CustomActivity.maxLabelLength)
        guard !clean.isEmpty, customActivities.count < CustomActivity.maxCount else { return nil }
        let activity = CustomActivity(id: "custom-\(UUID().uuidString.prefix(8).lowercased())", label: String(clean), baseActivity: base)
        customActivities.append(activity)
        activityLimits[activity.id] = limits(for: base.rawValue)
        activityRouteTiming[activity.id] = routeTiming(for: base.rawValue)
        customActivityID = activity.id
        defaultActivity = base
        return activity
    }

    mutating func renameCustomActivity(_ id: String, to label: String) {
        let clean = label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(CustomActivity.maxLabelLength)
        guard !clean.isEmpty, let index = customActivities.firstIndex(where: { $0.id == id }) else { return }
        customActivities[index].label = String(clean)
    }

    mutating func deleteCustomActivity(_ id: String) {
        guard let custom = customActivities.first(where: { $0.id == id }) else { return }
        customActivities.removeAll { $0.id == id }
        activityLimits[id] = nil
        activityRouteTiming[id] = nil
        if customActivityID == id {
            customActivityID = nil
            defaultActivity = custom.baseActivity
        }
    }

    mutating func select(activity: Activity) {
        defaultActivity = activity
        customActivityID = nil
    }

    mutating func select(custom: CustomActivity) {
        defaultActivity = custom.baseActivity
        customActivityID = custom.id
    }
}

// MARK: - The web app's preferences shape

extension Preferences {
    /// The account's stored preferences (`user.preferences`), as the web app writes them.
    init(web json: JSON) {
        self.init()
        if let raw = json["defaultActivity"].string, let activity = Activity(rawValue: raw) { defaultActivity = activity }
        customActivities = json["customActivities"].array.compactMap { item in
            guard let id = item["id"].string, let label = item["label"].string,
                  let base = item["baseActivity"].string.flatMap(Activity.init(rawValue:)) else { return nil }
            return CustomActivity(id: id, label: label, baseActivity: base)
        }
        if let id = json["customActivityId"].string, customActivities.contains(where: { $0.id == id }) { customActivityID = id }
        for (key, value) in json["activityLimits"].object {
            if let limits = Limits(web: value, fallback: limits(for: key)) { activityLimits[key] = limits }
        }
        for (key, value) in json["activityRouteTiming"].object {
            if let timing = RouteTiming(web: value, fallback: routeTiming(for: key)) { activityRouteTiming[key] = timing }
        }
        // The flat limits and timing are the active activity's.
        if let flat = Limits(web: json, fallback: limits(for: activeKey)), json["maxWindGustMph"].double != nil { activityLimits[activeKey] = flat }
        if let flat = RouteTiming(web: json, fallback: routeTiming(for: activeKey)), json["runnerPaceMinutesPerMile"].double != nil {
            activityRouteTiming[activeKey] = flat
        }
        if let start = json["defaultStartTime"].string, DateText.minutes(start) != nil { defaultStartTime = start }
        if let hours = json["travelWindowHours"].int { travelWindowHours = max(1, min(24, hours)) }
        if let raw = json["themeMode"].string, let mode = ThemeMode(rawValue: raw) { themeMode = mode }
        if let raw = json["temperatureUnit"].string, let unit = TemperatureUnit(rawValue: raw) { temperatureUnit = unit }
        if let raw = json["windSpeedUnit"].string, let unit = WindUnit(rawValue: raw) { windUnit = unit }
        if let raw = json["elevationUnit"].string, let unit = ElevationUnit(rawValue: raw) { elevationUnit = unit }
        if let raw = json["timeStyle"].string, let style = TimeStyle(rawValue: raw) { timeStyle = style }
        if let adjust = json["approachElevationAdjustment"].bool { approachElevationAdjustment = adjust }
    }

    /// Whether an account's stored preferences were ever saved (the web's `hasStoredUserPreferences`).
    static func stored(in json: JSON) -> Bool {
        !json["defaultActivity"].isNull || !json["defaultStartTime"].isNull || !json["themeMode"].isNull
    }

    /// The preferences in the web app's shape, for the account and for saved reports.
    var web: JSON {
        let limits = self.limits
        let timing = self.routeTiming
        var allLimits = activityLimits
        allLimits[activeKey] = limits
        var allTiming = activityRouteTiming
        allTiming[activeKey] = timing
        return .object([
            "defaultActivity": .string(defaultActivity.rawValue),
            "customActivityId": customActivityID.map(JSON.string) ?? .null,
            "customActivities": .array(customActivities.map { .object(["id": .string($0.id), "label": .string($0.label), "baseActivity": .string($0.baseActivity.rawValue)]) }),
            "activityLimits": .object(allLimits.mapValues(\.web)),
            "activityRouteTiming": .object(allTiming.mapValues(\.web)),
            "defaultStartTime": .string(defaultStartTime),
            "themeMode": .string(themeMode.rawValue),
            "temperatureUnit": .string(temperatureUnit.rawValue),
            "elevationUnit": .string(elevationUnit.rawValue),
            "windSpeedUnit": .string(windUnit.rawValue),
            "timeStyle": .string(timeStyle.rawValue),
            "maxWindGustMph": .number(Double(limits.maxGustMph)),
            "maxPrecipChance": .number(Double(limits.maxPrecipChance)),
            "minFeelsLikeF": .number(Double(limits.minFeelsLikeF)),
            "maxFeelsLikeF": .number(Double(limits.maxFeelsLikeF)),
            "travelWindowHours": .number(Double(travelWindowHours)),
            "runnerPaceMinutesPerMile": .number(Double(timing.paceMinutesPerMile)),
            "runnerAscentMinutesPer1000Ft": .number(Double(timing.ascentMinutesPer1000Ft)),
            "runnerStopBufferMinutes": .number(Double(timing.stopMinutes)),
            "approachElevationAdjustment": .bool(approachElevationAdjustment),
        ])
    }
}

extension Limits {
    static let gustRange = 10...80
    static let precipRange = 0...100
    static let coldRange = -40...60
    static let heatRange = 70...120

    init?(web json: JSON, fallback: Limits) {
        guard case .object = json else { return nil }
        let clamp: (Double?, Int, ClosedRange<Int>) -> Int = { value, fallback, range in
            guard let value else { return fallback }
            return max(range.lowerBound, min(range.upperBound, Int(value.rounded())))
        }
        self.init(maxGustMph: clamp(json["maxWindGustMph"].double, fallback.maxGustMph, Self.gustRange),
                  maxPrecipChance: clamp(json["maxPrecipChance"].double, fallback.maxPrecipChance, Self.precipRange),
                  minFeelsLikeF: clamp(json["minFeelsLikeF"].double, fallback.minFeelsLikeF, Self.coldRange),
                  maxFeelsLikeF: clamp(json["maxFeelsLikeF"].double, fallback.maxFeelsLikeF, Self.heatRange))
    }

    var web: JSON {
        .object([
            "maxWindGustMph": .number(Double(maxGustMph)),
            "maxPrecipChance": .number(Double(maxPrecipChance)),
            "minFeelsLikeF": .number(Double(minFeelsLikeF)),
            "maxFeelsLikeF": .number(Double(maxFeelsLikeF)),
        ])
    }
}

extension RouteTiming {
    init?(web json: JSON, fallback: RouteTiming) {
        guard case .object = json else { return nil }
        let clamp: (Double?, Int, ClosedRange<Int>) -> Int = { value, fallback, range in
            guard let value else { return fallback }
            return max(range.lowerBound, min(range.upperBound, Int(value.rounded())))
        }
        self.init(paceMinutesPerMile: clamp(json["runnerPaceMinutesPerMile"].double, fallback.paceMinutesPerMile, Self.paceRange),
                  ascentMinutesPer1000Ft: clamp(json["runnerAscentMinutesPer1000Ft"].double, fallback.ascentMinutesPer1000Ft, Self.ascentRange),
                  stopMinutes: clamp(json["runnerStopBufferMinutes"].double, fallback.stopMinutes, Self.stopRange))
    }

    var web: JSON {
        .object([
            "runnerPaceMinutesPerMile": .number(Double(paceMinutesPerMile)),
            "runnerAscentMinutesPer1000Ft": .number(Double(ascentMinutesPer1000Ft)),
            "runnerStopBufferMinutes": .number(Double(stopMinutes)),
        ])
    }
}

// MARK: - Store

/// The live preferences. `Format` and `DateText` read the display units from here.
@Observable
final class PreferencesStore {
    static let shared = PreferencesStore()
    private static let key = "preferences.v1"

    var preferences: Preferences {
        didSet {
            guard preferences != oldValue else { return }
            Units.current = Units(preferences)
            if let data = try? JSONEncoder().encode(preferences) { UserDefaults.standard.set(data, forKey: Self.key) }
            onChange?(preferences)
        }
    }

    /// Called after every change; the account store uses it to sync preferences.
    @ObservationIgnored var onChange: ((Preferences) -> Void)?

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key), let decoded = try? JSONDecoder().decode(Preferences.self, from: data) {
            preferences = decoded
        } else {
            preferences = Preferences()
        }
        Units.current = Units(preferences)
    }

    /// Replaces the preferences without calling `onChange` (for preferences read from the account).
    func adopt(_ next: Preferences) {
        let callback = onChange
        onChange = nil
        preferences = next
        onChange = callback
    }
}

/// The display units every screen formats with. Report numbers stay imperial; these convert them.
nonisolated struct Units: Sendable {
    var temperature: TemperatureUnit = .f
    var wind: WindUnit = .mph
    var elevation: ElevationUnit = .ft
    var timeStyle: TimeStyle = .ampm

    init() {}

    @MainActor init(_ preferences: Preferences) {
        temperature = preferences.temperatureUnit
        wind = preferences.windUnit
        elevation = preferences.elevationUnit
        timeStyle = preferences.timeStyle
    }

    nonisolated(unsafe) static var current = Units()

    var tempSymbol: String { temperature == .c ? "°C" : "°F" }
    var windSymbol: String { wind == .kph ? "km/h" : "mph" }
    var elevationSymbol: String { elevation == .m ? "m" : "ft" }
    var distanceSymbol: String { elevation == .m ? "km" : "mi" }

    func temp(_ fahrenheit: Double) -> Double { temperature == .c ? (fahrenheit - 32) * 5 / 9 : fahrenheit }
    /// A temperature difference (no offset).
    func tempDelta(_ fahrenheit: Double) -> Double { temperature == .c ? fahrenheit * 5 / 9 : fahrenheit }
    func wind(_ mph: Double) -> Double { wind == .kph ? mph * 1.609344 : mph }
    func elevation(_ feet: Double) -> Double { elevation == .m ? feet * 0.3048 : feet }
    func distance(_ miles: Double) -> Double { elevation == .m ? miles * 1.609344 : miles }

    func feetFrom(display value: Double) -> Double { elevation == .m ? value / 0.3048 : value }
}
