import Foundation

struct ReportLogsService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) { self.client = client }

    func load(secret: String) async throws -> [ReportLogEntry] {
        try await client.fetch(
            "/api/report-logs",
            headers: ["Authorization": "Bearer \(secret)"],
            type: [ReportLogEntry].self
        )
    }
}
