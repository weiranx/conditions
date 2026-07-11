import Foundation
import SwiftUI

struct UserPreferences: Codable, Sendable, Equatable {
    var defaultStartTime: String = "07:00"
    var themeMode: ThemeMode = .system
    var temperatureUnit: TemperatureUnit = .fahrenheit
    var elevationUnit: ElevationUnit = .feet
    var windSpeedUnit: WindSpeedUnit = .mph
    var timeStyle: TimeStyle = .ampm
    var maxWindGustMph: Double = 25
    var maxPrecipChance: Double = 60
    var minFeelsLikeF: Double = 5
    var maxFeelsLikeF: Double = 95
    var travelWindowHours: Double = 12

    enum ThemeMode: String, Codable, Sendable, CaseIterable {
        case system, light, dark

        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light: return .light
            case .dark: return .dark
            }
        }
    }

    enum TemperatureUnit: String, Codable, Sendable, CaseIterable {
        case fahrenheit = "f"
        case celsius = "c"

        var symbol: String {
            switch self {
            case .fahrenheit: return "°F"
            case .celsius: return "°C"
            }
        }
    }

    enum ElevationUnit: String, Codable, Sendable, CaseIterable {
        case feet = "ft"
        case meters = "m"

        var symbol: String { rawValue }
    }

    enum WindSpeedUnit: String, Codable, Sendable, CaseIterable {
        case mph
        case kph

        var symbol: String { rawValue }
    }

    enum TimeStyle: String, Codable, Sendable, CaseIterable {
        case ampm
        case twentyFourHour = "24h"
    }

    enum ThresholdPreset: String, Codable, Sendable, CaseIterable, Identifiable {
        case conservative
        case standard
        case aggressive
        case runner

        var id: String { rawValue }

        var label: String {
            switch self {
            case .conservative: return "Conservative"
            case .standard: return "Standard"
            case .aggressive: return "Aggressive"
            case .runner: return "Trail Runner"
            }
        }

        var description: String {
            switch self {
            case .conservative: return "Lower thresholds for cautious planning"
            case .standard: return "Balanced defaults for most trips"
            case .aggressive: return "Higher tolerance for experienced users"
            case .runner: return "Optimized for fast-and-light trail running"
            }
        }

        var maxWindGustMph: Double {
            switch self {
            case .conservative: return 30
            case .standard: return 40
            case .aggressive: return 55
            case .runner: return 35
            }
        }

        var maxPrecipChance: Double {
            switch self {
            case .conservative: return 30
            case .standard: return 40
            case .aggressive: return 60
            case .runner: return 25
            }
        }

        var minFeelsLikeF: Double {
            switch self {
            case .conservative: return 25
            case .standard: return 15
            case .aggressive: return 0
            case .runner: return 20
            }
        }

        var maxFeelsLikeF: Double {
            switch self {
            case .conservative: return 85
            case .standard: return 95
            case .aggressive: return 105
            case .runner: return 90
            }
        }

        var travelWindowHours: Double {
            switch self {
            case .conservative: return 10
            case .standard: return 12
            case .aggressive: return 16
            case .runner: return 8
            }
        }
    }

    mutating func applyPreset(_ preset: ThresholdPreset) {
        maxWindGustMph = preset.maxWindGustMph
        maxPrecipChance = preset.maxPrecipChance
        minFeelsLikeF = preset.minFeelsLikeF
        maxFeelsLikeF = preset.maxFeelsLikeF
        travelWindowHours = preset.travelWindowHours
    }

    mutating func reset() {
        self = UserPreferences()
    }

    mutating func normalize() {
        maxWindGustMph = min(80, max(10, maxWindGustMph))
        maxPrecipChance = min(100, max(0, maxPrecipChance.rounded()))
        minFeelsLikeF = min(60, max(-40, minFeelsLikeF))
        maxFeelsLikeF = min(120, max(70, maxFeelsLikeF))
        travelWindowHours = min(24, max(1, travelWindowHours.rounded()))
    }

    enum CodingKeys: String, CodingKey {
        case defaultStartTime, themeMode, temperatureUnit, elevationUnit, windSpeedUnit, timeStyle
        case maxWindGustMph, maxPrecipChance, minFeelsLikeF, maxFeelsLikeF, travelWindowHours
    }

    init() {}

    init(from decoder: Decoder) throws {
        let defaults = UserPreferences()
        let values = try decoder.container(keyedBy: CodingKeys.self)
        defaultStartTime = try values.decodeIfPresent(String.self, forKey: .defaultStartTime) ?? defaults.defaultStartTime
        themeMode = try values.decodeIfPresent(ThemeMode.self, forKey: .themeMode) ?? defaults.themeMode
        temperatureUnit = try values.decodeIfPresent(TemperatureUnit.self, forKey: .temperatureUnit) ?? defaults.temperatureUnit
        elevationUnit = try values.decodeIfPresent(ElevationUnit.self, forKey: .elevationUnit) ?? defaults.elevationUnit
        windSpeedUnit = try values.decodeIfPresent(WindSpeedUnit.self, forKey: .windSpeedUnit) ?? defaults.windSpeedUnit
        timeStyle = try values.decodeIfPresent(TimeStyle.self, forKey: .timeStyle) ?? defaults.timeStyle
        maxWindGustMph = try values.decodeIfPresent(Double.self, forKey: .maxWindGustMph) ?? defaults.maxWindGustMph
        maxPrecipChance = try values.decodeIfPresent(Double.self, forKey: .maxPrecipChance) ?? defaults.maxPrecipChance
        minFeelsLikeF = try values.decodeIfPresent(Double.self, forKey: .minFeelsLikeF) ?? defaults.minFeelsLikeF
        maxFeelsLikeF = try values.decodeIfPresent(Double.self, forKey: .maxFeelsLikeF) ?? defaults.maxFeelsLikeF
        travelWindowHours = try values.decodeIfPresent(Double.self, forKey: .travelWindowHours) ?? defaults.travelWindowHours
        normalize()
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(defaultStartTime, forKey: .defaultStartTime)
        try values.encode(themeMode, forKey: .themeMode)
        try values.encode(temperatureUnit, forKey: .temperatureUnit)
        try values.encode(elevationUnit, forKey: .elevationUnit)
        try values.encode(windSpeedUnit, forKey: .windSpeedUnit)
        try values.encode(timeStyle, forKey: .timeStyle)
        try values.encode(maxWindGustMph, forKey: .maxWindGustMph)
        try values.encode(maxPrecipChance, forKey: .maxPrecipChance)
        try values.encode(minFeelsLikeF, forKey: .minFeelsLikeF)
        try values.encode(maxFeelsLikeF, forKey: .maxFeelsLikeF)
        try values.encode(travelWindowHours, forKey: .travelWindowHours)
    }

    // MARK: - Persistence

    private static let storageKey = "summitsafe:user-preferences:v1"

    static func load() -> UserPreferences {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let prefs = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            return UserPreferences()
        }
        return prefs
    }

    func save() {
        var normalized = self
        normalized.normalize()
        guard let data = try? JSONEncoder().encode(normalized) else { return }
        UserDefaults.standard.set(data, forKey: UserPreferences.storageKey)
    }
}
