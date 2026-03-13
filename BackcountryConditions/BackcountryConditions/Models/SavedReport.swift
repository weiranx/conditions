import Foundation

struct SavedReport: Codable, Sendable, Identifiable {
    var id: String
    var objectiveName: String
    var lat: Double
    var lon: Double
    var forecastDate: String
    var startTime: String
    var savedAt: Date
    var safetyScore: Double
    var decisionLevel: String
    var headline: String
    var data: SafetyData
    var aiBrief: String?
    var routeAnalysis: RouteAnalysisResult?

    init(
        objectiveName: String,
        lat: Double,
        lon: Double,
        forecastDate: String,
        startTime: String,
        data: SafetyData,
        decisionLevel: DecisionLevel,
        headline: String
    ) {
        self.id = "\(objectiveName)|\(forecastDate)|\(startTime)|\(Date().timeIntervalSince1970)"
        self.objectiveName = objectiveName
        self.lat = lat
        self.lon = lon
        self.forecastDate = forecastDate
        self.startTime = startTime
        self.savedAt = Date()
        self.safetyScore = data.safety.score
        self.decisionLevel = decisionLevel.rawValue
        self.headline = headline
        self.data = data
    }
}
