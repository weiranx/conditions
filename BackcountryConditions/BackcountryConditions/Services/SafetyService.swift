import Foundation

struct SafetyService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    func loadReport(
        lat: Double,
        lon: Double,
        date: String,
        startTime: String,
        endTime: String? = nil,
        elevation: Int? = nil,
        travelWindowHours: Int = 12
    ) async throws -> SafetyData {
        let encodedStart = startTime.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? startTime
        var params = "lat=\(lat)&lon=\(lon)&date=\(date)&start=\(encodedStart)&travelWindowHours=\(travelWindowHours)"
        if let endTime {
            params += "&end=\(endTime)"
        }
        if let elevation {
            params += "&elevation=\(elevation)"
        }
        return try await client.fetch("/api/safety?\(params)", type: SafetyData.self)
    }
}
