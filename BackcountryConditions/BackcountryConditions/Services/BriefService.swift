import Foundation

struct BriefService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    func fetchAiBrief(request: AiBriefRequest) async throws -> AiBriefResponse {
        try await client.post("/api/ai-brief", body: request, type: AiBriefResponse.self)
    }

    func fetchSatOneliner(lat: Double, lon: Double, date: String, startTime: String) async throws -> SatOnelinerResponse {
        try await client.fetch(
            "/api/sat-oneliner?lat=\(lat)&lon=\(lon)&date=\(date)&start=\(startTime)",
            type: SatOnelinerResponse.self
        )
    }
}
