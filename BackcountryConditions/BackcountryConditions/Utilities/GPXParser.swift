import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

struct ParsedGPXRoute: Sendable {
    let name: String
    let fileName: String
    let pointCount: Int
    let distanceMiles: Double
    let elevationGainFt: Double?
    let minElevationFt: Double?
    let maxElevationFt: Double?
    let checkpoints: [GPXCheckpoint]
}

struct GPXCheckpoint: Codable, Sendable, Identifiable {
    let name: String
    let lat: Double
    let lon: Double
    let elevationFt: Double?
    let distanceMiles: Double
    let progressPercent: Int

    var id: String { "\(name)|\(lat)|\(lon)" }

    enum CodingKeys: String, CodingKey {
        case name, lat, lon
        case elevationFt = "elev_ft"
        case distanceMiles = "distance_miles"
        case progressPercent = "progress_percent"
    }
}

enum GPXParserError: LocalizedError {
    case tooLarge
    case invalidXML
    case tooFewPoints
    case noDistance

    var errorDescription: String? {
        switch self {
        case .tooLarge: "GPX files are limited to 5 MB."
        case .invalidXML: "This file is not valid GPX XML."
        case .tooFewPoints: "The GPX file needs at least two valid track or route points."
        case .noDistance: "The GPX track does not contain a measurable route."
        }
    }
}

enum GPXParser {
    private static let maxBytes = 5 * 1024 * 1024
    private static let metersToFeet = 3.28084
    private static let metersPerMile = 1_609.344

    static func parse(data: Data, fileName: String) throws -> ParsedGPXRoute {
        guard data.count <= maxBytes else { throw GPXParserError.tooLarge }
        let delegate = GPXDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else { throw GPXParserError.invalidXML }
        let points = delegate.points
        guard points.count >= 2 else { throw GPXParserError.tooFewPoints }

        var cumulative = 0.0
        var measured = points
        for index in measured.indices.dropFirst() {
            if measured[index - 1].segment == measured[index].segment {
                cumulative += haversineMeters(measured[index - 1], measured[index])
            }
            measured[index].distanceMeters = cumulative
        }
        guard cumulative > 0 else { throw GPXParserError.noDistance }

        let elevations = measured.compactMap(\.elevationMeters)
        var gain = 0.0
        for index in measured.indices.dropFirst() {
            guard measured[index - 1].segment == measured[index].segment,
                  let previous = measured[index - 1].elevationMeters,
                  let current = measured[index].elevationMeters else { continue }
            let delta = current - previous
            if delta >= 1 { gain += delta }
        }

        return ParsedGPXRoute(
            name: (delegate.routeName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? delegate.routeName!
                : fileName.replacingOccurrences(of: ".gpx", with: "", options: .caseInsensitive)),
            fileName: fileName,
            pointCount: measured.count,
            distanceMiles: rounded(cumulative / metersPerMile, places: 2),
            elevationGainFt: elevations.count > 1 ? (gain * metersToFeet).rounded() : nil,
            minElevationFt: elevations.min().map { ($0 * metersToFeet).rounded() },
            maxElevationFt: elevations.max().map { ($0 * metersToFeet).rounded() },
            checkpoints: checkpoints(from: measured, totalDistance: cumulative)
        )
    }

    private static func checkpoints(from points: [TrackPoint], totalDistance: Double) -> [GPXCheckpoint] {
        let count = min(5, points.count)
        var indexes = [0]
        if count > 2 {
            for checkpoint in 1..<(count - 1) {
                let target = totalDistance * Double(checkpoint) / Double(count - 1)
                let lower = indexes.last! + 1
                let upper = points.count - (count - checkpoint)
                let selected = (lower...upper).min { abs(points[$0].distanceMeters - target) < abs(points[$1].distanceMeters - target) } ?? lower
                indexes.append(selected)
            }
        }
        if points.count > 1 { indexes.append(points.count - 1) }

        return indexes.enumerated().map { offset, pointIndex in
            let point = points[pointIndex]
            let progress = Int((point.distanceMeters / totalDistance * 100).rounded())
            let name = offset == 0 ? "Route start" : (offset == indexes.count - 1 ? "Route finish" : "\(progress)% checkpoint")
            return GPXCheckpoint(
                name: name,
                lat: rounded(point.lat, places: 6),
                lon: rounded(point.lon, places: 6),
                elevationFt: point.elevationMeters.map { ($0 * metersToFeet).rounded() },
                distanceMiles: rounded(point.distanceMeters / metersPerMile, places: 2),
                progressPercent: progress
            )
        }
    }

    private static func haversineMeters(_ a: TrackPoint, _ b: TrackPoint) -> Double {
        let radius = 6_371_000.0
        let lat1 = a.lat * .pi / 180
        let lat2 = b.lat * .pi / 180
        let dLat = lat2 - lat1
        let dLon = (b.lon - a.lon) * .pi / 180
        let h = pow(sin(dLat / 2), 2) + cos(lat1) * cos(lat2) * pow(sin(dLon / 2), 2)
        return radius * 2 * atan2(sqrt(h), sqrt(1 - h))
    }

    private static func rounded(_ value: Double, places: Int) -> Double {
        let scale = pow(10.0, Double(places))
        return (value * scale).rounded() / scale
    }
}

private struct TrackPoint {
    let lat: Double
    let lon: Double
    var elevationMeters: Double?
    let segment: Int
    var distanceMeters: Double = 0
}

private final class GPXDelegate: NSObject, XMLParserDelegate {
    var points: [TrackPoint] = []
    var routeName: String?
    private var segment = 0
    private var activePoint: TrackPoint?
    private var text = ""
    private var insideTrackOrRoute = false

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        let name = elementName.lowercased()
        text = ""
        if name == "trk" || name == "rte" { insideTrackOrRoute = true }
        if name == "trkseg" { segment += 1 }
        if name == "trkpt" || name == "rtept",
           let lat = Double(attributeDict["lat"] ?? ""), let lon = Double(attributeDict["lon"] ?? ""),
           (-90...90).contains(lat), (-180...180).contains(lon), points.count < 100_000 {
            activePoint = TrackPoint(lat: lat, lon: lon, elevationMeters: nil, segment: segment)
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let name = elementName.lowercased()
        if name == "ele", activePoint != nil { activePoint?.elevationMeters = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if name == "name", insideTrackOrRoute, routeName == nil { routeName = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)) }
        if (name == "trkpt" || name == "rtept"), let point = activePoint { points.append(point); activePoint = nil }
        if name == "trk" || name == "rte" { insideTrackOrRoute = false }
        text = ""
    }
}
