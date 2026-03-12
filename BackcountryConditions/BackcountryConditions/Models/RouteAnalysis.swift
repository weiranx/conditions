import Foundation

struct RouteSuggestion: Codable, Sendable, Identifiable {
    var name: String
    var description: String?
    var distance_rt_miles: Double?
    var elev_gain_ft: Double?
    // swiftlint:disable:next identifier_name
    var `class`: String?

    var id: String { name }

    var distance: String? {
        guard let d = distance_rt_miles else { return nil }
        return "\(String(format: "%.1f", d)) mi RT"
    }

    var elevation: String? {
        guard let e = elev_gain_ft else { return nil }
        return "+\(Int(e)) ft"
    }

    var difficulty: String? {
        `class`
    }
}

struct RouteAnalysisResult: Codable, Sendable {
    var waypoints: [RouteWaypoint]?
    var summaries: [RouteSummary]?
    var analysis: String?
}

struct RouteWaypoint: Codable, Sendable, Identifiable {
    var name: String?
    var lat: Double?
    var lon: Double?
    var elev_ft: Double?

    var id: String { (name ?? "") + "\(lat ?? 0)" }

    var elevation: Double? { elev_ft }
}

struct RouteSummary: Codable, Sendable {
    var name: String?
    var elev_ft: Double?
    var score: Double?
    var activeAlerts: Int?
    var weather: RouteSummaryWeather?
    var avalanche: RouteSummaryAvalanche?
    var snowDepthIn: Double?
}

struct RouteSummaryWeather: Codable, Sendable {
    var temp: Double?
    var feelsLike: Double?
    var windSpeed: Double?
    var windGust: Double?
    var description: String?
    var precipChance: Double?
}

struct RouteSummaryAvalanche: Codable, Sendable {
    var risk: String?
    var dangerLevel: Int?
    var bottomLine: String?
}
