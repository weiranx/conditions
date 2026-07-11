import Foundation

enum DecisionEngine {
    static func evaluate(data: SafetyData, preferences: UserPreferences, ignoreAvalanche: Bool = false) -> SummitDecision {
        var blockers: [String] = []
        var cautions: [String] = []
        var checks: [SummitDecision.Check] = []

        // Avalanche danger
        let avyLevel = data.avalanche.dangerLevel
        let avyRelevant = data.avalanche.relevant ?? true
        if avyRelevant && !ignoreAvalanche {
            let avalancheUnknown = data.avalanche.dangerUnknown == true || (data.avalanche.coverageStatus != nil && data.avalanche.coverageStatus != "reported")
            if avalancheUnknown {
                cautions.append("Avalanche forecast coverage is unavailable — treat terrain as unrated")
            } else if avyLevel >= 3 {
                blockers.append("Avalanche danger: \(data.avalanche.risk)")
            }
            checks.append(.init(
                key: "avalanche",
                label: "Avalanche Danger",
                ok: !avalancheUnknown && avyLevel < 3,
                detail: data.avalanche.risk
            ))
        }

        // Wind
        let trend = Array((data.weather.trend ?? []).prefix(Int(preferences.travelWindowHours)))
        let gustMph = max(data.weather.windGust, trend.map(\.gust).max() ?? 0)
        let maxGust = preferences.maxWindGustMph
        if gustMph >= max(35, maxGust + 10) {
            blockers.append("Wind gusts extreme (\(Int(gustMph)) mph)")
        } else if gustMph >= maxGust {
            cautions.append("Wind gusts exceed threshold (\(Int(gustMph)) mph)")
        }
        checks.append(.init(
            key: "wind",
            label: "Wind Gusts",
            ok: gustMph <= maxGust,
            detail: "\(Int(gustMph)) mph gusts"
        ))

        // Precipitation
        let precipChance = max(data.weather.precipChance, trend.compactMap(\.precipChance).max() ?? 0)
        let maxPrecip = preferences.maxPrecipChance
        if precipChance >= max(85, maxPrecip + 25) {
            blockers.append("Precipitation chance very high (\(Int(precipChance))%)")
        } else if precipChance >= max(55, maxPrecip) {
            cautions.append("Precipitation chance \(Int(precipChance))%")
        }
        checks.append(.init(
            key: "precip",
            label: "Precipitation",
            ok: precipChance <= maxPrecip,
            detail: "\(Int(precipChance))% chance"
        ))

        // Feels like
        let trendFeelsLike = trend.map { TravelWindowEngine.computeFeelsLikeF($0.temp, windMph: $0.wind) }
        let currentFeelsLike = data.weather.feelsLike ?? data.weather.temp
        let feelsLike = min(currentFeelsLike, trendFeelsLike.min() ?? currentFeelsLike)
        let hottestFeelsLike = max(currentFeelsLike, trendFeelsLike.max() ?? currentFeelsLike)
        let minFeelsLike = preferences.minFeelsLikeF
        if feelsLike < minFeelsLike - 15 {
            blockers.append("Feels like \(Int(feelsLike))°F — extreme cold")
        } else if feelsLike < minFeelsLike {
            cautions.append("Feels like \(Int(feelsLike))°F — below threshold")
        }
        checks.append(.init(
            key: "temp",
            label: "Feels Like Temperature",
            ok: feelsLike >= minFeelsLike,
            detail: "\(Int(feelsLike))°F"
        ))

        let maxFeelsLike = preferences.maxFeelsLikeF
        if hottestFeelsLike >= maxFeelsLike {
            blockers.append("Feels like \(Int(hottestFeelsLike))°F — heat ceiling reached")
        }
        checks.append(.init(
            key: "heat-threshold",
            label: "Heat Ceiling",
            ok: hottestFeelsLike < maxFeelsLike,
            detail: "\(Int(hottestFeelsLike))°F"
        ))

        if data.weather.description.localizedCaseInsensitiveContains("weather data unavailable") {
            blockers.append("Weather data is unavailable — conditions are unknown")
        }

        if trend.contains(where: { point in
            let value = point.condition.lowercased()
            return value.contains("thunder") || value.contains("lightning") || value.contains("hail") || value.contains("blizzard")
        }) {
            cautions.append("Storm or thunder signal appears inside the travel window")
        }

        let travelRows = TravelWindowEngine.buildRows(trend: trend, preferences: preferences)
        if !travelRows.isEmpty && !travelRows.contains(where: \.pass) {
            cautions.append("No clean travel hours under current thresholds")
        }

        // Active NWS alerts
        let alertCount = data.alerts?.activeCount ?? 0
        if alertCount > 0 {
            let severity = data.alerts?.highestSeverity ?? "Unknown"
            if severity == "Extreme" || severity == "Severe" {
                blockers.append("\(alertCount) active alert(s) — \(severity) severity")
            } else {
                cautions.append("\(alertCount) active NWS alert(s)")
            }
        }
        checks.append(.init(
            key: "alerts",
            label: "NWS Alerts",
            ok: alertCount == 0,
            detail: alertCount == 0 ? "None" : "\(alertCount) active"
        ))

        // Fire risk
        if let fireLevel = data.fireRisk?.level {
            if fireLevel >= 4 {
                blockers.append("Fire risk: \(data.fireRisk?.label ?? "High")")
            } else if fireLevel >= 3 {
                cautions.append("Fire risk: \(data.fireRisk?.label ?? "Elevated")")
            }
            checks.append(.init(
                key: "fire",
                label: "Fire Risk",
                ok: fireLevel < 3,
                detail: data.fireRisk?.label ?? "Level \(fireLevel)"
            ))
        }

        // Heat risk
        if let heatLevel = data.heatRisk?.level {
            if heatLevel >= 4 {
                blockers.append("Heat risk: \(data.heatRisk?.label ?? "High")")
            } else if heatLevel >= 3 {
                cautions.append("Heat risk: \(data.heatRisk?.label ?? "Elevated")")
            }
            checks.append(.init(
                key: "heat",
                label: "Heat Risk",
                ok: heatLevel < 3,
                detail: data.heatRisk?.label ?? "Level \(heatLevel)"
            ))
        }

        // Air quality
        if let aqi = data.airQuality?.usAqi {
            if aqi > 200 {
                blockers.append("Air quality very unhealthy (AQI \(aqi))")
            } else if aqi > 150 {
                cautions.append("Air quality unhealthy (AQI \(aqi))")
            } else if aqi > 100 {
                cautions.append("Air quality unhealthy for sensitive groups (AQI \(aqi))")
            }
            checks.append(.init(
                key: "aqi",
                label: "Air Quality",
                ok: aqi <= 100,
                detail: "AQI \(aqi)"
            ))
        }

        // Partial data warning
        if data.partialData == true {
            cautions.append("Some data sources unavailable — reduced confidence")
        }

        // Decision level
        let level: DecisionLevel
        let headline: String
        if !blockers.isEmpty {
            level = .noGo
            headline = "Conditions are dangerous — postpone or choose a safer objective"
        } else if !cautions.isEmpty {
            level = .caution
            headline = "Proceed with extra preparation and real-time monitoring"
        } else {
            level = .go
            headline = "Conditions look favorable — standard backcountry precautions apply"
        }

        return SummitDecision(
            level: level,
            headline: headline,
            blockers: blockers,
            cautions: cautions,
            checks: checks
        )
    }
}
