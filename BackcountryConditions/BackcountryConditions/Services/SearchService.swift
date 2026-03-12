import Foundation

struct SearchService: Sendable {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    // MARK: - Backend Search

    func search(query: String) async throws -> [SearchResult] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let response = try await client.fetch("/api/search?q=\(encoded)", type: [BackendSearchResult].self)
        return response.map { item in
            SearchResult(
                name: item.display_name ?? item.name ?? "Unknown",
                lat: item.lat,
                lon: item.lon,
                resultClass: item.resultClass,
                type: item.type
            )
        }
    }

    private struct BackendSearchResult: Codable {
        var name: String?
        var display_name: String?
        var lat: Double
        var lon: Double
        var resultClass: String?
        var type: String?

        enum CodingKeys: String, CodingKey {
            case name, display_name, lat, lon
            case resultClass = "class"
            case type
        }
    }
}

// MARK: - Local Peak Catalog

enum PeakCatalog {
    static let popularPeaks: [SearchResult] = [
        SearchResult(name: "Mount Rainier, Washington", lat: 46.8523, lon: -121.7603, resultClass: "popular", type: "peak"),
        SearchResult(name: "Mount Shasta, California", lat: 41.4091, lon: -122.1946, resultClass: "popular", type: "peak"),
        SearchResult(name: "Mount Whitney, California", lat: 36.5786, lon: -118.2923, resultClass: "popular", type: "peak"),
        SearchResult(name: "Grand Teton, Wyoming", lat: 43.7417, lon: -110.8024, resultClass: "popular", type: "peak"),
        SearchResult(name: "Longs Peak, Colorado", lat: 40.2549, lon: -105.615, resultClass: "popular", type: "peak"),
        SearchResult(name: "Mount Elbert, Colorado", lat: 39.1178, lon: -106.4454, resultClass: "popular", type: "peak"),
        SearchResult(name: "Mount Hood, Oregon", lat: 45.3735, lon: -121.6959, resultClass: "popular", type: "peak"),
        SearchResult(name: "Mount Washington, New Hampshire", lat: 44.2706, lon: -71.3033, resultClass: "popular", type: "peak"),
        SearchResult(name: "Kings Peak, Utah", lat: 40.7764, lon: -110.3726, resultClass: "popular", type: "peak"),
        SearchResult(name: "San Jacinto Peak, California", lat: 33.8147, lon: -116.6794, resultClass: "popular", type: "peak"),
    ]

    static func localResults(for query: String) -> [SearchResult] {
        let normalized = normalizeText(query)
        if normalized.isEmpty {
            return Array(popularPeaks.prefix(8))
        }
        return popularPeaks
            .filter { normalizeText($0.name).contains(normalized) }
            .sorted { rankScore($0.name, query: query) < rankScore($1.name, query: query) }
    }

    private static func normalizeText(_ text: String) -> String {
        text.lowercased()
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: ".", with: " ")
            .replacingOccurrences(of: "mt ", with: "mount ")
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private static func rankScore(_ name: String, query: String) -> Int {
        let normalizedName = normalizeText(name)
        let normalizedQuery = normalizeText(query)
        if normalizedName == normalizedQuery { return 0 }
        if normalizedName.hasPrefix(normalizedQuery) { return 1 }
        if normalizedName.contains(normalizedQuery) { return 3 }
        return 5
    }
}
