import Foundation

struct SnowVisionResponse: Codable, Sendable {
    var analysis: String
    var zoom: Int
    var image: String?
    var generatedAt: String
}

struct SnowVisionRequest: Encodable, Sendable {
    var lat: Double
    var lon: Double
    var snowpack: Snowpack?
    var units: Units

    struct Units: Encodable, Sendable {
        var elevation: String
    }
}
