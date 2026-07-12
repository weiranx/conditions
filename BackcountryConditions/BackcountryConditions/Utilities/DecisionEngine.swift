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
                cautions.append("No current avalanche bulletin covers this objective. Use low-angle, low-consequence terrain, avoid terrain traps, and increase spacing.")
            } else if avyLevel >= 3 {
                blockers.append("Avalanche danger is \(data.avalanche.risk). Choose non-avalanche terrain or another day.")
            }
            checks.append(.init(
                key: "avalanche",
                label: "Avalanche Danger",
                ok: !avalancheUnknown && avyLevel < 3,
                detail: data.avalanche.risk,
                action: avalancheUnknown
                    ? "Treat terrain as unrated until a current bulletin is available."
                    : avyLevel >= 3 ? "Choose non-avalanche terrain or another day." : nil
            ))
        }

        // Wind
        let trend = Array((data.weather.trend ?? []).prefix(Int(preferences.travelWindowHours)))
        let gustMph = max(data.weather.windGust, trend.map(\.gust).max() ?? 0)
        let maxGust = preferences.maxWindGustMph
        if gustMph >= max(35, maxGust + 10) {
            blockers.append("Wind gusts reach \(Int(gustMph)) mph. Choose a sheltered, lower objective or delay.")
        } else if gustMph >= maxGust {
            cautions.append("Wind gusts reach \(Int(gustMph)) mph. Shorten ridge exposure and turn around if balance or communication becomes difficult.")
        }
        checks.append(.init(
            key: "wind",
            label: "Wind Gusts",
            ok: gustMph <= maxGust,
            detail: "\(Int(gustMph)) mph gusts",
            action: gustMph > maxGust ? "Use sheltered terrain, secure loose gear, and shorten exposed segments." : nil
        ))

        // Precipitation
        let precipChance = max(data.weather.precipChance, trend.compactMap(\.precipChance).max() ?? 0)
        let maxPrecip = preferences.maxPrecipChance
        if precipChance >= max(85, maxPrecip + 25) {
            blockers.append("Precipitation chance reaches \(Int(precipChance))%. Delay or choose a lower-consequence route with reliable footing and visibility.")
        } else if precipChance >= max(55, maxPrecip) {
            cautions.append("Precipitation chance reaches \(Int(precipChance))%. Allow extra time, carry traction and weather protection, and turn around if footing or visibility deteriorates.")
        }
        checks.append(.init(
            key: "precip",
            label: "Precipitation",
            ok: precipChance <= maxPrecip,
            detail: "\(Int(precipChance))% chance",
            action: precipChance > maxPrecip ? "Allow extra time and turn around if footing or visibility deteriorates." : nil
        ))

        // Feels like
        let trendFeelsLike = trend.map { TravelWindowEngine.computeFeelsLikeF($0.temp, windMph: $0.wind) }
        let currentFeelsLike = data.weather.feelsLike ?? data.weather.temp
        let feelsLike = min(currentFeelsLike, trendFeelsLike.min() ?? currentFeelsLike)
        let hottestFeelsLike = max(currentFeelsLike, trendFeelsLike.max() ?? currentFeelsLike)
        let minFeelsLike = preferences.minFeelsLikeF
        if feelsLike < minFeelsLike - 15 {
            blockers.append("Apparent temperature falls to \(Int(feelsLike))°F. Delay or choose a shorter, sheltered objective with a reliable warming option.")
        } else if feelsLike < minFeelsLike {
            cautions.append("Apparent temperature falls to \(Int(feelsLike))°F. Add insulation and hand protection, reduce exposed time, and set a warming checkpoint.")
        }
        checks.append(.init(
            key: "temp",
            label: "Feels Like Temperature",
            ok: feelsLike >= minFeelsLike,
            detail: "\(Int(feelsLike))°F",
            action: feelsLike < minFeelsLike ? "Add insulation, reduce exposed time, and set a warming checkpoint." : nil
        ))

        let maxFeelsLike = preferences.maxFeelsLikeF
        if hottestFeelsLike >= maxFeelsLike {
            blockers.append("Apparent temperature reaches \(Int(hottestFeelsLike))°F. Move to cooler hours or a cooler objective with reliable water and shade.")
        }
        checks.append(.init(
            key: "heat-threshold",
            label: "Heat Ceiling",
            ok: hottestFeelsLike < maxFeelsLike,
            detail: "\(Int(hottestFeelsLike))°F",
            action: hottestFeelsLike >= maxFeelsLike ? "Choose cooler hours or a cooler objective and shorten exposed travel." : nil
        ))

        if data.weather.description.localizedCaseInsensitiveContains("weather data unavailable") {
            blockers.append("Weather data is unavailable, so wind, precipitation, and temperature are unknown. Do not make a go/no-go decision from this report.")
        }

        if trend.contains(where: { point in
            let value = point.condition.lowercased()
            return value.contains("thunder") || value.contains("lightning") || value.contains("hail") || value.contains("blizzard")
        }) {
            cautions.append("A storm or thunder signal appears in the travel window. Stay off exposed ridges and descend at the first thunder, lightning, or rapid cloud growth.")
        }

        let travelRows = TravelWindowEngine.buildRows(trend: trend, preferences: preferences)
        if !travelRows.isEmpty && !travelRows.contains(where: \.pass) {
            cautions.append("No hour in the travel window meets every threshold. Re-time the start, shorten the objective, or choose another day.")
        }

        // Active NWS alerts
        let alertCount = data.alerts?.activeCount ?? 0
        if alertCount > 0 {
            let severity = data.alerts?.highestSeverity ?? "Unknown"
            let alertNoun = alertCount == 1 ? "alert" : "alerts"
            let alertVerb = alertCount == 1 ? "includes" : "include"
            let overlapVerb = alertCount == 1 ? "overlaps" : "overlap"
            if severity == "Extreme" || severity == "Severe" {
                blockers.append("\(alertCount) active NWS \(alertNoun) \(alertVerb) \(severity.lowercased())-severity products. Open the alert details and move outside the affected area and time.")
            } else {
                cautions.append("\(alertCount) active NWS \(alertNoun) \(overlapVerb) the plan. Read each alert's area, timing, and instructions before choosing the route.")
            }
        }
        checks.append(.init(
            key: "alerts",
            label: "NWS Alerts",
            ok: alertCount == 0,
            detail: alertCount == 0 ? "None" : "\(alertCount) active",
            action: alertCount > 0 ? "Open every alert and verify the route is outside the affected area and time." : nil
        ))

        // Fire risk
        if let fireLevel = data.fireRisk?.level {
            if fireLevel >= 4 {
                blockers.append("Fire risk is \(data.fireRisk?.label ?? "Extreme"). Choose another area or time, verify closures, and do not enter fire-affected terrain.")
            } else if fireLevel >= 3 {
                cautions.append("Fire risk is \(data.fireRisk?.label ?? "High"). Use a short objective with multiple exits, avoid ignition sources, and turn around for increasing smoke or wind.")
            }
            checks.append(.init(
                key: "fire",
                label: "Fire Risk",
                ok: fireLevel < 3,
                detail: data.fireRisk?.label ?? "Level \(fireLevel)",
                action: fireLevel >= 3 ? "Verify closures, avoid ignition sources, and keep multiple exits." : nil
            ))
        }

        // Heat risk
        if let heatLevel = data.heatRisk?.level {
            if heatLevel >= 4 {
                blockers.append("Heat risk is \(data.heatRisk?.label ?? "Extreme"). Choose a cooler time or objective and avoid long exposed travel.")
            } else if heatLevel >= 3 {
                cautions.append("Heat risk is \(data.heatRisk?.label ?? "High"). Move in cooler hours, shorten exposed segments, and set water and cooling checkpoints.")
            }
            checks.append(.init(
                key: "heat",
                label: "Heat Risk",
                ok: heatLevel < 3,
                detail: data.heatRisk?.label ?? "Level \(heatLevel)",
                action: heatLevel >= 3 ? "Shift to cooler hours, shorten exposed segments, and set cooling checkpoints." : nil
            ))
        }

        // Air quality
        if let aqi = data.airQuality?.usAqi {
            if aqi > 200 {
                blockers.append("Air quality is very unhealthy (AQI \(aqi)). Choose a cleaner-air objective or postpone strenuous travel.")
            } else if aqi > 150 {
                cautions.append("Air quality is unhealthy (AQI \(aqi)). Reduce exertion, shorten the plan, and leave if anyone develops symptoms.")
            } else if aqi > 100 {
                cautions.append("Air quality is unhealthy for sensitive groups (AQI \(aqi)). Reduce sustained exertion and use a cleaner-air alternative if symptoms appear.")
            }
            checks.append(.init(
                key: "aqi",
                label: "Air Quality",
                ok: aqi <= 100,
                detail: "AQI \(aqi)",
                action: aqi > 100 ? "Reduce exertion and choose cleaner air if symptoms appear." : nil
            ))
        }

        // Partial data warning
        if data.partialData == true {
            cautions.append("Some data sources are unavailable, so confidence is reduced. Open current official products and verify the missing conditions before committing.")
        }

        // Decision level
        let level: DecisionLevel
        let headline: String
        if !blockers.isEmpty {
            level = .noGo
            headline = "Do not commit to this plan — change the objective, timing, or day"
        } else if !cautions.isEmpty {
            level = .caution
            headline = "Adjust terrain, timing, or pace before committing"
        } else {
            level = .go
            headline = "No current threshold is tripped — keep normal precautions"
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
