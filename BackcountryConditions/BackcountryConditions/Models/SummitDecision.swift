import Foundation

enum DecisionLevel: String, Codable, Sendable {
    case go = "GO"
    case caution = "CAUTION"
    case noGo = "NO-GO"
}

struct SummitDecision: Sendable {
    var level: DecisionLevel
    var headline: String
    var blockers: [String]
    var cautions: [String]
    var checks: [Check]

    struct Check: Identifiable, Sendable {
        var key: String?
        var label: String
        var ok: Bool
        var detail: String?
        var action: String?

        var id: String { key ?? label }
    }
}
