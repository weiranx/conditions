import Foundation

struct RouteService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    func fetchSuggestions(peak: String, lat: Double, lon: Double) async throws -> [RouteSuggestion] {
        let encodedPeak = peak.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? peak
        return try await client.fetch(
            "/api/route-suggestions?peak=\(encodedPeak)&lat=\(lat)&lon=\(lon)",
            type: [RouteSuggestion].self
        )
    }

    func analyzeRoute(peak: String, route: String, lat: Double, lon: Double, date: String, start: String?) async throws -> RouteAnalysisResult {
        let body = RouteAnalysisRequest(
            peak: peak,
            route: route,
            lat: lat,
            lon: lon,
            date: date,
            start: start
        )
        return try await client.post("/api/route-analysis", body: body, type: RouteAnalysisResult.self)
    }

    private struct RouteAnalysisRequest: Codable {
        var peak: String
        var route: String
        var lat: Double
        var lon: Double
        var date: String
        var start: String?
    }
}
