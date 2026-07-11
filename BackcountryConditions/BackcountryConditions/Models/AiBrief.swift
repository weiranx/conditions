import Foundation

struct AiBriefRequest: Encodable, Sendable {
    var decisionLevel: String
    var report: SafetyData
    var units: DisplayUnits

    struct DisplayUnits: Encodable, Sendable {
        var temperature: String
        var wind: String
        var elevation: String

        init(preferences: UserPreferences) {
            temperature = preferences.temperatureUnit.rawValue
            wind = preferences.windSpeedUnit.rawValue
            elevation = preferences.elevationUnit.rawValue
        }
    }
}

struct AiBriefResponse: Codable, Sendable {
    var narrative: String
    var cached: Bool?
}
