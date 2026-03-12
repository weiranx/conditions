import Foundation

struct TravelWindowRow: Identifiable, Sendable {
    var time: String
    var pass: Bool
    var condition: String
    var reasonSummary: String
    var failedRules: [String]
    var failedRuleLabels: [String]
    var temp: Double
    var feelsLike: Double
    var wind: Double
    var gust: Double
    var precipChance: Double

    var id: String { time }
}

struct TravelWindowSpan: Sendable {
    var start: String
    var end: String
    var length: Int
}

struct TravelWindowInsights: Sendable {
    var passHours: Int
    var failHours: Int
    var bestWindow: TravelWindowSpan?
    var nextCleanWindow: TravelWindowSpan?
    var topFailureLabels: [String]
    var trendDirection: TrendDirection
    var trendStrength: TrendStrength
    var trendDelta: Double
    var trendLabel: String
    var trendSummary: String
    var conditionTrendLabel: String
    var conditionTrendSummary: String
    var summary: String

    enum TrendDirection: String, Sendable {
        case improving, worsening, steady
    }

    enum TrendStrength: String, Sendable {
        case slight, moderate, strong
    }
}
