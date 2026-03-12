import Foundation

// MARK: - Types

enum TerrainAspect: String, CaseIterable, Sendable {
    case N, NE, E, SE, S, SW, W, NW
}

struct WindLoadingResult: Sendable {
    var level: WindLoadingLevel
    var confidence: WindLoadingConfidence
    var primaryAspects: [TerrainAspect]
    var secondaryAspects: [TerrainAspect]
    var windFromDeg: Double?
    var isCalm: Bool
    var windSlabOverlapNames: [String]
    var transportHours: Int
    var activeHoursDetail: String?
}

enum WindLoadingLevel: String, Sendable {
    case minimal = "Minimal"
    case localized = "Localized"
    case active = "Active"
    case severe = "Severe"
}

enum WindLoadingConfidence: String, Sendable {
    case high = "High"
    case moderate = "Moderate"
    case low = "Low"
}

// MARK: - Engine

enum WindLoadingEngine {

    static let aspectOrder: [TerrainAspect] = [.N, .NE, .E, .SE, .S, .SW, .W, .NW]

    // MARK: - Direction to Degrees

    static func windDirectionToDegrees(_ direction: String?) -> Double? {
        guard let dir = direction?.trimmingCharacters(in: .whitespaces).uppercased() else { return nil }
        if dir == "CALM" || dir == "VRB" || dir == "VARIABLE" { return nil }

        let map: [String: Double] = [
            "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
            "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
            "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
            "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
        ]
        return map[dir]
    }

    // MARK: - Leeward Aspects

    static func leewardAspects(from direction: String?) -> [TerrainAspect] {
        guard let windDeg = windDirectionToDegrees(direction) else { return [] }
        let leewardDeg = (windDeg + 180).truncatingRemainder(dividingBy: 360)
        let centerIndex = Int((leewardDeg / 45).rounded()) % 8
        var result: [TerrainAspect] = []
        let left = aspectOrder[(centerIndex + 7) % 8]
        let center = aspectOrder[centerIndex]
        let right = aspectOrder[(centerIndex + 1) % 8]
        for aspect in [left, center, right] where !result.contains(aspect) {
            result.append(aspect)
        }
        return result
    }

    // MARK: - Cross-Loading Aspects

    static func crossLoadingAspects(from direction: String?) -> [TerrainAspect] {
        guard let windDeg = windDirectionToDegrees(direction) else { return [] }
        let leewardDeg = (windDeg + 180).truncatingRemainder(dividingBy: 360)
        let centerIndex = Int((leewardDeg / 45).rounded()) % 8
        let left = aspectOrder[(centerIndex + 2) % 8]
        let right = aspectOrder[(centerIndex + 6) % 8]
        var result: [TerrainAspect] = []
        for aspect in [left, right] where !result.contains(aspect) {
            result.append(aspect)
        }
        return result
    }

    // MARK: - Parse Problem Location for Aspects

    static func parseAspectsFromLocation(_ location: AvalancheProblemLocation?) -> Set<TerrainAspect> {
        guard let location else { return [] }
        var texts: [String] = []
        switch location {
        case .array(let arr): texts = arr
        case .string(let str): texts = [str]
        case .dictionary: return []
        }

        var aspects = Set<TerrainAspect>()
        for text in texts {
            let lower = text.lowercased()
            // Match aspect keywords
            if lower.contains("north") && lower.contains("east") { aspects.insert(.NE) }
            else if lower.contains("north") && lower.contains("west") { aspects.insert(.NW) }
            else if lower.contains("south") && lower.contains("east") { aspects.insert(.SE) }
            else if lower.contains("south") && lower.contains("west") { aspects.insert(.SW) }
            else if lower.contains("north") { aspects.insert(.N) }
            else if lower.contains("south") { aspects.insert(.S) }
            else if lower.contains("east") { aspects.insert(.E) }
            else if lower.contains("west") { aspects.insert(.W) }

            // Also match abbreviations like "NE aspect"
            for aspect in TerrainAspect.allCases {
                if lower.contains(aspect.rawValue.lowercased() + " ") || lower.hasSuffix(aspect.rawValue.lowercased()) {
                    aspects.insert(aspect)
                }
            }
        }
        return aspects
    }

    // MARK: - Evaluate Wind Loading

    static func evaluate(data: SafetyData) -> WindLoadingResult {
        let windDir = data.weather.windDirection
        let windSpeed = data.weather.windSpeed
        let windGust = data.weather.windGust
        let trend = data.weather.trend ?? []

        let normalized = windDir?.trimmingCharacters(in: .whitespaces).uppercased() ?? ""
        let isCalm = normalized == "CALM" || normalized == "VRB" || normalized == "VARIABLE" || windDir == nil

        let windFromDeg = windDirectionToDegrees(windDir)
        let primary = leewardAspects(from: windDir)
        let showSecondary = windGust.isFinite && windGust >= 20
        let secondary = showSecondary ? crossLoadingAspects(from: windDir) : []

        // Transport hours from trend
        let transportHours = trend.filter { point in
            let w = point.wind
            let g = point.gust
            return (w.isFinite && w >= 12) || (g.isFinite && g >= 18)
        }.count

        let activeTransportHours = trend.filter { point in
            let w = point.wind
            let g = point.gust
            return (w.isFinite && w >= 20) || (g.isFinite && g >= 30)
        }.count

        let severeTransportHours = trend.filter { point in
            let w = point.wind
            let g = point.gust
            return (w.isFinite && w >= 25) || (g.isFinite && g >= 38)
        }.count

        let lightWind = windSpeed.isFinite && windGust.isFinite && windSpeed <= 5 && windGust <= 10

        // Loading level
        let level: WindLoadingLevel
        if isCalm || lightWind {
            level = .minimal
        } else if (windSpeed.isFinite && windSpeed >= 28) || (windGust.isFinite && windGust >= 40) || severeTransportHours >= 2 {
            level = .severe
        } else if (windSpeed.isFinite && windSpeed >= 20) || (windGust.isFinite && windGust >= 30) || activeTransportHours >= 2 {
            level = .active
        } else if (windSpeed.isFinite && windSpeed >= 12) || (windGust.isFinite && windGust >= 18) || transportHours >= 1 {
            level = .localized
        } else {
            level = .minimal
        }

        // Confidence from trend agreement
        let trendDirections = trend.compactMap { $0.windDirection }
        let directionalDirections = trendDirections.filter { dir in
            let up = dir.trimmingCharacters(in: .whitespaces).uppercased()
            return up != "CALM" && up != "VRB" && up != "VARIABLE"
        }
        let trendCoverage: Double? = trendDirections.isEmpty ? nil : Double(directionalDirections.count) / Double(trendDirections.count)
        let trendAgreement: Double? = {
            guard let resolvedDir = windDir, !directionalDirections.isEmpty else { return nil }
            guard let resolvedDeg = windDirectionToDegrees(resolvedDir) else { return nil }
            let matching = directionalDirections.filter { dir in
                guard let deg = windDirectionToDegrees(dir) else { return false }
                let delta = abs(deg - resolvedDeg)
                let wrapped = min(delta, 360 - delta)
                return wrapped <= 45
            }
            return Double(matching.count) / Double(directionalDirections.count)
        }()

        let confidence: WindLoadingConfidence
        if level == .minimal || windDir == nil {
            confidence = .low
        } else if let agreement = trendAgreement, agreement >= 0.7,
                  let coverage = trendCoverage, coverage >= 0.5,
                  ((windSpeed.isFinite && windSpeed >= 14) || (windGust.isFinite && windGust >= 22)) {
            confidence = .high
        } else if (trendAgreement != nil && trendAgreement! >= 0.45) ||
                    (windSpeed.isFinite && windSpeed >= 10) ||
                    (windGust.isFinite && windGust >= 16) {
            confidence = .moderate
        } else {
            confidence = .low
        }

        // Wind slab overlap
        let primarySet = Set(primary)
        let overlapNames = (data.avalanche.problems ?? []).compactMap { problem -> String? in
            guard let name = problem.name, name.lowercased().contains("wind slab") else { return nil }
            let problemAspects = parseAspectsFromLocation(problem.location)
            guard !problemAspects.isEmpty else { return nil }
            let hasOverlap = problemAspects.contains(where: { primarySet.contains($0) })
            return hasOverlap ? name : nil
        }

        return WindLoadingResult(
            level: level,
            confidence: confidence,
            primaryAspects: primary,
            secondaryAspects: secondary,
            windFromDeg: windFromDeg,
            isCalm: isCalm,
            windSlabOverlapNames: overlapNames,
            transportHours: transportHours,
            activeHoursDetail: nil
        )
    }
}
