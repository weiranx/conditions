import Foundation

struct SearchResult: Identifiable, Codable, Sendable, Hashable {
    var name: String
    var lat: Double
    var lon: Double
    var resultClass: String?
    var type: String?

    var id: String { "\(name)|\(lat)|\(lon)" }
}
