import Foundation

struct AiBriefRequest: Codable, Sendable {
    var score: Double
    var confidence: Double?
    var primaryHazard: String
    var decisionLevel: String
    var factors: [BriefFactor]
    var context: String?

    struct BriefFactor: Codable, Sendable {
        var hazard: String?
        var name: String?
        var impact: Double
    }
}

struct AiBriefResponse: Codable, Sendable {
    var narrative: String
    var cached: Bool
}

struct SatOnelinerResponse: Codable, Sendable {
    var oneliner: String
    var cached: Bool
}
