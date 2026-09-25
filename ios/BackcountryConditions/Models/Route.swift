import Foundation

/// A checkpoint along an imported route (the web's `GpxCheckpoint`).
struct GpxCheckpoint: Codable, Hashable, Sendable {
    var name: String
    var lat: Double
    var lon: Double
    var elevFt: Double?
    var distanceMiles: Double
    var progressPercent: Double

    var json: JSON {
        var object: [String: JSON] = ["name": .string(name), "lat": .number(lat), "lon": .number(lon),
                                      "distance_miles": .number(distanceMiles), "progress_percent": .number(progressPercent)]
        if let elevFt { object["elev_ft"] = .number(elevFt) }
        return .object(object)
    }

    init(name: String, lat: Double, lon: Double, elevFt: Double?, distanceMiles: Double, progressPercent: Double) {
        self.name = name
        self.lat = lat
        self.lon = lon
        self.elevFt = elevFt
        self.distanceMiles = distanceMiles
        self.progressPercent = progressPercent
    }

    init?(json: JSON) {
        guard let name = json["name"].string, let lat = json["lat"].double, let lon = json["lon"].double else { return nil }
        self.init(name: name, lat: lat, lon: lon, elevFt: json["elev_ft"].double,
                  distanceMiles: json["distance_miles"].double ?? 0, progressPercent: json["progress_percent"].double ?? 0)
    }
}

/// A point of a route's display track (the web's `GpxTrackPoint`).
struct TrackPoint: Codable, Hashable, Sendable {
    var lat: Double
    var lon: Double
    var elevFt: Double?
    var progressPercent: Double

    var json: JSON {
        var object: [String: JSON] = ["lat": .number(lat), "lon": .number(lon), "progress_percent": .number(progressPercent)]
        if let elevFt { object["elev_ft"] = .number(elevFt) }
        return .object(object)
    }
}

/// An imported GPX route, parsed the way `frontend/src/lib/gpx.ts` parses one.
struct GpxRoute: Codable, Hashable, Sendable {
    var name: String
    var fileName: String
    var pointCount: Int
    var distanceMiles: Double
    var elevationGainFt: Double?
    var minElevationFt: Double?
    var maxElevationFt: Double?
    var checkpoints: [GpxCheckpoint]
    var displayTrack: [TrackPoint]
    /// "closed route" or "point-to-point".
    var routeShape: String

    var isLoop: Bool { routeShape == "closed route" }

    /// The web's `ParsedGpxRoute`, as saved with reports.
    var json: JSON {
        .object([
            "name": .string(name), "fileName": .string(fileName), "pointCount": .number(Double(pointCount)),
            "distanceMiles": .number(distanceMiles),
            "elevationGainFt": elevationGainFt.map(JSON.number) ?? .null,
            "minElevationFt": minElevationFt.map(JSON.number) ?? .null,
            "maxElevationFt": maxElevationFt.map(JSON.number) ?? .null,
            "checkpoints": .array(checkpoints.map(\.json)),
            "displayTrack": .array(displayTrack.map(\.json)),
            "routeShape": .string(routeShape),
        ])
    }

    init?(json: JSON) {
        guard let name = json["name"].string, let distance = json["distanceMiles"].double else { return nil }
        self.name = name
        fileName = json["fileName"].string ?? "\(name).gpx"
        pointCount = json["pointCount"].int ?? 0
        distanceMiles = distance
        elevationGainFt = json["elevationGainFt"].double
        minElevationFt = json["minElevationFt"].double
        maxElevationFt = json["maxElevationFt"].double
        checkpoints = json["checkpoints"].array.compactMap(GpxCheckpoint.init(json:))
        displayTrack = json["displayTrack"].array.compactMap { point in
            guard let lat = point["lat"].double, let lon = point["lon"].double else { return nil }
            return TrackPoint(lat: lat, lon: lon, elevFt: point["elev_ft"].double, progressPercent: point["progress_percent"].double ?? 0)
        }
        routeShape = json["routeShape"].string ?? "point-to-point"
    }

    init(name: String, fileName: String, pointCount: Int, distanceMiles: Double, elevationGainFt: Double?, minElevationFt: Double?,
         maxElevationFt: Double?, checkpoints: [GpxCheckpoint], displayTrack: [TrackPoint], routeShape: String) {
        self.name = name
        self.fileName = fileName
        self.pointCount = pointCount
        self.distanceMiles = distanceMiles
        self.elevationGainFt = elevationGainFt
        self.minElevationFt = minElevationFt
        self.maxElevationFt = maxElevationFt
        self.checkpoints = checkpoints
        self.displayTrack = displayTrack
        self.routeShape = routeShape
    }

    /// Route metadata as `/api/route-analysis` reads it.
    var metadata: JSON {
        .object([
            "fileName": .string(fileName), "pointCount": .number(Double(pointCount)), "distanceMiles": .number(distanceMiles),
            "elevationGainFt": elevationGainFt.map(JSON.number) ?? .null,
            "minElevationFt": minElevationFt.map(JSON.number) ?? .null,
            "maxElevationFt": maxElevationFt.map(JSON.number) ?? .null,
        ])
    }

    /// [miles, feet | null] per display point, for route analysis to time every climb.
    var analysisTrack: JSON? {
        guard displayTrack.count >= 2, distanceMiles > 0 else { return nil }
        return .array(displayTrack.map { point in
            .array([.number(((point.progressPercent / 100) * distanceMiles * 1000).rounded() / 1000), point.elevFt.map(JSON.number) ?? .null])
        })
    }

    /// Hours at a pace: distance, climbing, a third of the climbing rate for descent, and stops
    /// (the backend's route timing model, as the web's `estimateRouteDurationHours`).
    func estimatedHours(_ timing: RouteTiming) -> Int {
        var loss = 0.0
        for (index, point) in displayTrack.enumerated() where index > 0 {
            if let a = displayTrack[index - 1].elevFt, let b = point.elevFt { loss += max(0, a - b) }
        }
        let minutes = distanceMiles * Double(max(5, timing.paceMinutesPerMile))
            + (elevationGainFt ?? 0) / 1000 * Double(timing.ascentMinutesPer1000Ft)
            + loss / 1000 * Double(timing.ascentMinutesPer1000Ft) / 3
            + Double(timing.stopMinutes)
        return max(1, min(24, Int((minutes / 60).rounded())))
    }
}

/// The route a plan follows: an imported GPX track or a named route to the objective, and its analysis.
struct PlanRoute: Codable, Hashable, Sendable {
    var name: String
    var gpx: GpxRoute?
    /// Round-trip length of a suggested route, to scale checkpoint distances.
    var distanceRtMiles: Double?
    var elevationGainFt: Double?
    /// "auto", "out-and-back", "loop" or "point-to-point".
    var shape: String = "auto"
    /// The last `/api/route-analysis` result for this route and plan.
    var analysis: JSON?
    /// The plan the analysis was run for ("date|start|hours"), to tell when it's out of date.
    var analyzedFor: String?
}


// MARK: - GPX parsing

enum GpxParser {
    static let maxBytes = 5 * 1024 * 1024
    private static let metersToFeet = 3.28084
    private static let metersPerMile = 1609.344
    private static let maxTrackPoints = 100_000
    private static let targetCheckpoints = 6
    private static let maxCheckpoints = 7
    private static let waypointSnapMeters = 150.0
    private static let lowPointDropMeters = 150.0
    private static let minCheckpointGapShare = 0.03
    static let maxDisplayTrackPoints = 500

    struct Point {
        var lat: Double
        var lon: Double
        var elevation: Double?
        var segment: Int
        var distance: Double = 0
    }

    static func parse(data: Data, fileName: String) throws -> GpxRoute {
        guard data.count <= maxBytes else { throw APIError(message: "GPX files are limited to 5 MB.") }
        let delegate = Delegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse(), delegate.sawRoot else { throw APIError(message: delegate.sawRoot ? "This file is not valid GPX XML." : "Choose a GPX file containing a track or route.") }
        if delegate.tooMany { throw APIError(message: "GPX files are limited to 100,000 track points.") }
        var points = delegate.trackPoints.isEmpty ? delegate.routePoints : delegate.trackPoints
        guard points.count >= 2 else { throw APIError(message: "The GPX file needs at least two valid track or route points.") }
        var total = 0.0
        for index in points.indices {
            if index > 0, points[index - 1].segment == points[index].segment { total += meters(points[index - 1], points[index]) }
            points[index].distance = total
        }
        guard total > 0 else { throw APIError(message: "The GPX track does not contain a measurable route.") }
        let elevations = points.compactMap(\.elevation)
        var gain = 0.0
        for index in points.indices.dropFirst() {
            if let a = points[index - 1].elevation, let b = points[index].elevation, points[index - 1].segment == points[index].segment, b - a >= 1 { gain += b - a }
        }
        let fallbackName = fileName.replacingOccurrences(of: ".gpx", with: "", options: [.caseInsensitive]).trimmingCharacters(in: .whitespaces)
        let name = delegate.trackName ?? delegate.routeName ?? delegate.metadataName ?? (fallbackName.isEmpty ? "Imported GPX route" : fallbackName)
        return GpxRoute(
            name: String(name.prefix(200)), fileName: fileName, pointCount: points.count,
            distanceMiles: (total / metersPerMile * 100).rounded() / 100,
            elevationGainFt: elevations.count > 1 ? (gain * metersToFeet).rounded() : nil,
            minElevationFt: elevations.min().map { ($0 * metersToFeet).rounded() },
            maxElevationFt: elevations.max().map { ($0 * metersToFeet).rounded() },
            checkpoints: chooseCheckpoints(points, total: total, waypoints: delegate.waypoints),
            displayTrack: displayTrack(points, total: total),
            routeShape: meters(points[0], points[points.count - 1]) <= 250 ? "closed route" : "point-to-point")
    }

    static func meters(_ a: Point, _ b: Point) -> Double {
        let r = 6_371_000.0
        let lat1 = a.lat * .pi / 180, lat2 = b.lat * .pi / 180
        let dLat = lat2 - lat1, dLon = (b.lon - a.lon) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(h), sqrt(1 - h))
    }

    private enum Role: Int { case even = 1, low = 2, high = 3, waypoint = 4, end = 5 }

    private static func chooseCheckpoints(_ points: [Point], total: Double, waypoints: [(name: String, lat: Double, lon: Double)]) -> [GpxCheckpoint] {
        struct Pick { var index: Int; var role: Role; var name: String?; var start = false }
        var picks = [Pick(index: 0, role: .end, start: true), Pick(index: points.count - 1, role: .end)]
        let withElevation = points.enumerated().compactMap { index, point in point.elevation.map { (index, $0) } }
        if withElevation.count >= 2, let high = withElevation.max(by: { $0.1 < $1.1 }) {
            picks.append(Pick(index: high.0, role: .high))
            let ends = [points[0].elevation, points[points.count - 1].elevation].compactMap { $0 }
            let interior = withElevation.filter { $0.0 > 0 && $0.0 < points.count - 1 }
            if let low = interior.min(by: { $0.1 < $1.1 }), let lowest = ends.min(), low.1 <= lowest - lowPointDropMeters {
                picks.append(Pick(index: low.0, role: .low))
            }
        }
        for waypoint in waypoints {
            let target = Point(lat: waypoint.lat, lon: waypoint.lon, elevation: nil, segment: 0)
            var nearest = -1, nearestMeters = waypointSnapMeters
            for (index, point) in points.enumerated() {
                let m = meters(point, target)
                if m <= nearestMeters { nearest = index; nearestMeters = m }
            }
            if nearest >= 0 { picks.append(Pick(index: nearest, role: .waypoint, name: waypoint.name)) }
        }
        let minGap = total * minCheckpointGapShare
        var merged: [Pick] = []
        for pick in picks.sorted(by: { points[$0.index].distance < points[$1.index].distance }) {
            if let previous = merged.last, points[pick.index].distance - points[previous.index].distance < minGap {
                var keep = pick.role.rawValue > previous.role.rawValue ? pick : previous
                let drop = pick.role.rawValue > previous.role.rawValue ? previous : pick
                keep.name = keep.name ?? drop.name
                merged[merged.count - 1] = keep
                continue
            }
            merged.append(pick)
        }
        var chosen = merged
        if chosen.count > maxCheckpoints {
            let ends = chosen.filter { $0.role == .end }
            let middle = chosen.filter { $0.role != .end }.sorted { $0.role.rawValue > $1.role.rawValue }.prefix(maxCheckpoints - ends.count)
            chosen = (ends + middle).sorted { $0.index < $1.index }
        }
        while chosen.count < min(targetCheckpoints, points.count) {
            var widest = -1, widestGap = 0.0
            for i in 1..<chosen.count {
                let gap = points[chosen[i].index].distance - points[chosen[i - 1].index].distance
                if gap > widestGap && chosen[i].index - chosen[i - 1].index > 1 { widest = i; widestGap = gap }
            }
            if widest < 0 { break }
            let from = chosen[widest - 1].index, to = chosen[widest].index
            let middle = (points[from].distance + points[to].distance) / 2
            var best = from + 1
            for index in (from + 1)..<to where abs(points[index].distance - middle) < abs(points[best].distance - middle) { best = index }
            chosen.insert(Pick(index: best, role: .even), at: widest)
        }
        return chosen.map { pick in
            let point = points[pick.index]
            let progress = total > 0 ? (point.distance / total * 100).rounded() : (Double(pick.index) / Double(max(1, points.count - 1)) * 100).rounded()
            let fallback: String
            switch pick.role {
            case .end: fallback = pick.start ? "Route start" : "Route finish"
            case .high: fallback = "High point"
            case .low: fallback = "Low point"
            default: fallback = "\(Int(progress))% checkpoint"
            }
            return GpxCheckpoint(name: pick.name ?? fallback, lat: (point.lat * 1e6).rounded() / 1e6, lon: (point.lon * 1e6).rounded() / 1e6,
                                 elevFt: point.elevation.map { ($0 * metersToFeet).rounded() },
                                 distanceMiles: (point.distance / metersPerMile * 100).rounded() / 100, progressPercent: progress)
        }
    }

    private static func displayTrack(_ points: [Point], total: Double) -> [TrackPoint] {
        let stride = max(1, Int((Double(points.count) / Double(maxDisplayTrackPoints)).rounded(.up)))
        var selected = points.enumerated().filter { index, _ in index == 0 || index == points.count - 1 || index % stride == 0 }.map(\.element)
        if selected.count > maxDisplayTrackPoints { selected.remove(at: selected.count - 2) }
        return selected.enumerated().map { index, point in
            TrackPoint(lat: (point.lat * 1e6).rounded() / 1e6, lon: (point.lon * 1e6).rounded() / 1e6,
                       elevFt: point.elevation.map { ($0 * metersToFeet).rounded() },
                       progressPercent: total > 0 ? (point.distance / total * 1000).rounded() / 10
                                                  : (Double(index) / Double(max(1, selected.count - 1)) * 1000).rounded() / 10)
        }
    }

    private final class Delegate: NSObject, XMLParserDelegate {
        var sawRoot = false
        var tooMany = false
        var trackPoints: [Point] = []
        var routePoints: [Point] = []
        var waypoints: [(name: String, lat: Double, lon: Double)] = []
        var trackName: String?
        var routeName: String?
        var metadataName: String?

        private var stack: [String] = []
        private var text = ""
        private var current: Point?
        private var currentWaypoint: (lat: Double, lon: Double, name: String?)?
        private var trackSegment = -1
        private var routeIndex = -1

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
            let local = name.split(separator: ":").last.map(String.init) ?? name
            if stack.isEmpty { sawRoot = local == "gpx" }
            stack.append(local)
            text = ""
            switch local {
            case "trkseg": trackSegment += 1
            case "rte": routeIndex += 1
            case "trkpt", "rtept":
                if let lat = attributes["lat"].flatMap(Double.init), let lon = attributes["lon"].flatMap(Double.init),
                   (-90...90).contains(lat), (-180...180).contains(lon) {
                    current = Point(lat: lat, lon: lon, elevation: nil, segment: local == "trkpt" ? max(0, trackSegment) : max(0, routeIndex))
                }
            case "wpt":
                if waypoints.count < 200, let lat = attributes["lat"].flatMap(Double.init), let lon = attributes["lon"].flatMap(Double.init) {
                    currentWaypoint = (lat, lon, nil)
                }
            default: break
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            let local = name.split(separator: ":").last.map(String.init) ?? name
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let parent = stack.count >= 2 ? stack[stack.count - 2] : ""
            switch local {
            case "ele": if current != nil { current?.elevation = Double(value) }
            case "name":
                if parent == "trk", trackName == nil, !value.isEmpty { trackName = value }
                if parent == "rte", routeName == nil, !value.isEmpty { routeName = value }
                if parent == "metadata", metadataName == nil, !value.isEmpty { metadataName = value }
                if parent == "wpt", !value.isEmpty { currentWaypoint?.name = String(value.prefix(100)) }
            case "trkpt":
                if let current { if trackPoints.count >= GpxParser.maxTrackPoints { tooMany = true } else { trackPoints.append(current) } }
                current = nil
            case "rtept":
                if let current { if routePoints.count >= GpxParser.maxTrackPoints { tooMany = true } else { routePoints.append(current) } }
                current = nil
            case "wpt":
                if let waypoint = currentWaypoint, let name = waypoint.name { waypoints.append((name, waypoint.lat, waypoint.lon)) }
                currentWaypoint = nil
            default: break
            }
            stack.removeLast()
            text = ""
        }
    }
}

// MARK: - Approach

enum Approach {
    static let maxPoints = 64

    /// Evenly thin a timeline, always keeping both ends and the high point.
    static func thin<T>(_ items: [T], elevation: (T) -> Double, limit: Int = maxPoints) -> [T] {
        guard items.count > limit else { return items }
        let high = items.indices.max { elevation(items[$0]) < elevation(items[$1]) } ?? 0
        var keep: Set<Int> = [0, items.count - 1, high]
        let slots = limit - keep.count
        if slots > 0 {
            for i in 1...slots { keep.insert(Int((Double(i * (items.count - 1)) / Double(slots + 1)).rounded())) }
        }
        return keep.sorted().prefix(limit).map { items[$0] }
    }

    /// The approach plan params (the web's `buildApproachRequestParams`): a GPX track timed by pace,
    /// else an analyzed route's checkpoints, else a typed trailhead. The backend does the rest.
    static func params(enabled: Bool, trailheadFt: Double?, route: PlanRoute?, timing: RouteTiming) -> [String: String] {
        guard enabled else { return ["approach": "off"] }
        var params: [String: String] = [:]
        // An out-and-back analysis of a GPX track covers both ways; the track only the way out.
        let retraces = route?.analysis?["routeSource"].string == "gpx" && route?.analysis?.at("timing.roundTrip").bool == true
        if let gpx = route?.gpx, !retraces, gpx.distanceMiles > 0 {
            let track = gpx.displayTrack.compactMap { point in point.elevFt.map { (miles: point.progressPercent / 100 * gpx.distanceMiles, ft: $0) } }
            if track.count >= 2 {
                params["approach_track"] = thin(track, elevation: \.ft)
                    .map { "\(String(format: "%.2f", $0.miles).replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)):\(Int($0.ft.rounded()))" }
                    .joined(separator: ",")
                params["pace_min_per_mi"] = String(timing.paceMinutesPerMile)
                params["stop_min"] = String(max(0, timing.stopMinutes))
            }
        }
        if params["approach_track"] == nil {
            let checkpoints = (route?.analysis?["waypoints"].array ?? []).compactMap { waypoint -> (minute: Double, ft: Double)? in
                guard let ft = waypoint["elev_ft"].double, let minute = waypoint["offset_minutes"].double else { return nil }
                return (minute, ft)
            }
            if checkpoints.count >= 2 {
                params["approach_checkpoints"] = thin(checkpoints, elevation: \.ft).map { "\(Int($0.minute.rounded())):\(Int($0.ft.rounded()))" }.joined(separator: ",")
            }
            if let trailheadFt, trailheadFt >= 0 { params["trailhead_ft"] = String(Int(trailheadFt.rounded())) }
        }
        if timing.ascentMinutesPer1000Ft > 0 { params["ascent_min_per_kft"] = String(timing.ascentMinutesPer1000Ft) }
        return params
    }
}
