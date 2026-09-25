import Foundation

/// The backend's decision. The app never computes one; it reads `evaluation.decision.level`.
enum DecisionLevel: String, Codable, Sendable, Hashable {
    case go = "GO"
    case caution = "CAUTION"
    case noGo = "NO-GO"
    /// Evidence that did not load, or an itinerary that could not be fully checked.
    case unknown = "UNKNOWN"

    init(_ raw: String?) {
        switch raw?.uppercased() {
        case "GO": self = .go
        case "CAUTION": self = .caution
        case "NO-GO", "NOGO": self = .noGo
        default: self = .unknown
        }
    }

    var label: String {
        switch self {
        case .go: "Go"
        case .caution: "Caution"
        case .noGo: "No-go"
        case .unknown: "Not checked"
        }
    }

    /// How serious, for "risk increased" wording only (not for any decision).
    var severity: Int {
        switch self {
        case .go: 0
        case .unknown: 1
        case .caution: 2
        case .noGo: 3
        }
    }
}
