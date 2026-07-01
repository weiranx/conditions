import Foundation

struct BriefService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    func fetchAiBrief(request: AiBriefRequest) async throws -> AiBriefResponse {
        try await client.post("/api/ai-brief", body: request, type: AiBriefResponse.self)
    }
}
