import Foundation

struct HealthCheckResponse: Codable, Sendable {
    var status: String?
    var version: String?
    var env: String?
    var uptime: Double?
    var nodeVersion: String?
    var heapUsedMb: Double?
    var rssMb: Double?
    var latencyMs: Double?
    var checks: [HealthCheckItem]?
}

struct HealthCheckItem: Codable, Sendable, Identifiable {
    var label: String
    var status: String
    var detail: String
    var meta: String?

    var id: String { label }

    var statusLevel: StatusLevel {
        switch status {
        case "ok": return .ok
        case "warn": return .warn
        default: return .down
        }
    }

    enum StatusLevel: String {
        case ok, warn, down
    }
}
