import Foundation

struct SnowVisionService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    func analyze(data: SafetyData, preferences: UserPreferences) async throws -> SnowVisionResponse {
        let request = SnowVisionRequest(
            lat: data.location.lat,
            lon: data.location.lon,
            snowpack: data.snowpack,
            units: .init(elevation: preferences.elevationUnit.rawValue)
        )
        return try await client.post("/api/snow-vision", body: request, type: SnowVisionResponse.self)
    }
}
