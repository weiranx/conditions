import Foundation

struct ReportLogEntry: Decodable, Sendable, Identifiable {
    var timestamp: String
    var lat: Double?
    var lon: Double?
    var date: String?
    var startTime: String?
    var statusCode: Int
    var safetyScore: Double?
    var partialData: Bool?
    var durationMs: Double
    var name: String?
    var ip: String?
    var userAgent: String?

    var id: String { "\(timestamp)|\(name ?? "")|\(lat ?? 0)|\(lon ?? 0)" }
}
