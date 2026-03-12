import Foundation
import SwiftUI

struct UserPreferences: Codable, Sendable, Equatable {
    var defaultStartTime: String = "04:30"
    var themeMode: ThemeMode = .system
    var temperatureUnit: TemperatureUnit = .fahrenheit
    var elevationUnit: ElevationUnit = .feet
    var windSpeedUnit: WindSpeedUnit = .mph
    var timeStyle: TimeStyle = .ampm
    var maxWindGustMph: Double = 40
    var maxPrecipChance: Double = 40
    var minFeelsLikeF: Double = 15
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
        travelWindowHours = preset.travelWindowHours
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
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: UserPreferences.storageKey)
    }
}
