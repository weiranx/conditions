import Foundation

enum TravelWindowEngine {

    // MARK: - Feels Like (Wind Chill)

    static func computeFeelsLikeF(_ tempF: Double, windMph: Double) -> Double {
        guard tempF.isFinite else { return tempF }
        if tempF <= 50 && windMph >= 3 {
            let wc = 35.74 + 0.6215 * tempF - 35.75 * pow(windMph, 0.16) + 0.4275 * tempF * pow(windMph, 0.16)
            return wc.rounded()
        }
        return tempF.rounded()
    }

    // MARK: - Build Rows

    static func buildRows(trend: [WeatherTrendPoint], preferences: UserPreferences) -> [TravelWindowRow] {
        let maxGust = preferences.maxWindGustMph
        let maxPrecip = preferences.maxPrecipChance
        let minFeelsLike = preferences.minFeelsLikeF

        return trend.map { point in
            let gust = point.gust.isFinite ? point.gust : 0
            let wind = point.wind.isFinite ? point.wind : 0
            let temp = point.temp.isFinite ? point.temp : 0
            let feelsLike = computeFeelsLikeF(temp, windMph: wind)
            let precipChance = point.precipChance ?? 0

            var failedRules: [String] = []
            var failedRuleLabels: [String] = []

            if gust > maxGust {
                failedRules.append("gust \(Int(gust))>\(Int(maxGust)) mph")
                failedRuleLabels.append("Gust above limit")
            }
            if precipChance > maxPrecip {
                failedRules.append("precip \(Int(precipChance))%>\(Int(maxPrecip))%")
                failedRuleLabels.append("Precip above limit")
            }
            if feelsLike < minFeelsLike {
                failedRules.append("feels \(Int(feelsLike))<\(Int(minFeelsLike))°F")
                failedRuleLabels.append("Feels-like below limit")
            }

            let condLower = point.condition.lowercased()
            if condLower.contains("thunder") || condLower.contains("lightning") ||
                condLower.contains("hail") || condLower.contains("blizzard") {
                failedRules.append("condition: \(point.condition)")
                failedRuleLabels.append("Severe weather risk")
            }

            return TravelWindowRow(
                time: point.time,
                pass: failedRules.isEmpty,
                condition: point.condition.isEmpty ? "Unknown" : point.condition,
                reasonSummary: failedRules.isEmpty ? "Meets thresholds" : failedRules.joined(separator: " • "),
                failedRules: failedRules,
                failedRuleLabels: failedRuleLabels,
                temp: temp,
                feelsLike: feelsLike,
                wind: wind,
                gust: gust,
                precipChance: precipChance
            )
        }
    }

    // MARK: - Derive Spans

    static func deriveSpans(rows: [TravelWindowRow]) -> [TravelWindowSpan] {
        var spans: [TravelWindowSpan] = []
        var startIndex = -1

        for (idx, row) in rows.enumerated() {
            if row.pass && startIndex == -1 {
                startIndex = idx
            }
            let isLast = idx == rows.count - 1
            let spanEnded = startIndex != -1 && (!row.pass || isLast)
            if spanEnded {
                let endIndex = row.pass ? idx : idx - 1
                let length = endIndex - startIndex + 1
                if length > 0 {
                    spans.append(TravelWindowSpan(
                        start: rows[startIndex].time,
                        end: rows[endIndex].time,
                        length: length
                    ))
                }
                startIndex = -1
            }
        }

        return spans
    }

    // MARK: - Build Insights

    static func buildInsights(rows: [TravelWindowRow]) -> TravelWindowInsights {
        let passHours = rows.filter(\.pass).count
        let failHours = rows.count - passHours
        let spans = deriveSpans(rows: rows)
        let bestWindow = spans.max(by: { $0.length < $1.length })
        let nextCleanWindow = spans.first

        // Top failure labels
        var labelCounts: [String: Int] = [:]
        for row in rows {
            for label in row.failedRuleLabels {
                labelCounts[label, default: 0] += 1
            }
        }
        let topFailureLabels = labelCounts
            .sorted { $0.value > $1.value }
            .prefix(3)
            .map { "\($0.key) (\($0.value)h)" }

        // Trend analysis
        let (direction, strength, delta) = computeTrend(rows: rows)

        let trendLabel: String = {
            if direction == .steady { return "Steady" }
            return "\(direction.rawValue.capitalized) (\(strength.rawValue))"
        }()

        let trendSummary: String = {
            switch direction {
            case .improving: return "Conditions are getting better through the window"
            case .worsening: return "Conditions are deteriorating through the window"
            case .steady: return "Conditions remain relatively stable"
            }
        }()

        // Summary
        let summary: String = {
            if rows.isEmpty { return "No hourly data available" }
            if passHours == rows.count { return "All \(passHours) hours meet your thresholds" }
            if passHours == 0 { return "No hours meet your thresholds" }
            var s = "\(passHours) of \(rows.count) hours pass"
            if let best = bestWindow {
                s += ". Best window: \(best.start)–\(best.end) (\(best.length)h)"
            }
            return s
        }()

        return TravelWindowInsights(
            passHours: passHours,
            failHours: failHours,
            bestWindow: bestWindow,
            nextCleanWindow: nextCleanWindow,
            topFailureLabels: topFailureLabels,
            trendDirection: direction,
            trendStrength: strength,
            trendDelta: delta,
            trendLabel: trendLabel,
            trendSummary: trendSummary,
            conditionTrendLabel: trendLabel,
            conditionTrendSummary: trendSummary,
            summary: summary
        )
    }

    // MARK: - Trend Computation

    private static func computeTrend(rows: [TravelWindowRow]) -> (TravelWindowInsights.TrendDirection, TravelWindowInsights.TrendStrength, Double) {
        guard rows.count >= 3 else { return (.steady, .slight, 0) }

        let thirdLen = max(1, rows.count / 3)
        let firstThird = Array(rows.prefix(thirdLen))
        let lastThird = Array(rows.suffix(thirdLen))

        func riskScore(_ row: TravelWindowRow) -> Double {
            var score = 0.0
            score += row.gust / 10.0
            score += row.precipChance / 20.0
            score += max(0, (32 - row.feelsLike)) / 10.0
            if !row.pass { score += 2.0 }
            return score
        }

        let firstAvg = firstThird.map(riskScore).reduce(0, +) / Double(firstThird.count)
        let lastAvg = lastThird.map(riskScore).reduce(0, +) / Double(lastThird.count)
        let delta = lastAvg - firstAvg

        let direction: TravelWindowInsights.TrendDirection
        let strength: TravelWindowInsights.TrendStrength

        if abs(delta) < 0.5 {
            direction = .steady
            strength = .slight
        } else if delta > 0 {
            direction = .worsening
            strength = delta > 2.0 ? .strong : (delta > 1.0 ? .moderate : .slight)
        } else {
            direction = .improving
            strength = abs(delta) > 2.0 ? .strong : (abs(delta) > 1.0 ? .moderate : .slight)
        }

        return (direction, strength, delta)
    }
}
