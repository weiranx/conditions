import Foundation

/// One planned hour, as the backend evaluated it against the plan's limits.
struct Hour: Identifiable, Hashable, Sendable {
    let id: Int
    /// "03:00"
    let clock: String
    let pass: Bool
    let complete: Bool
    let failedRules: [String]
    let condition: String?
    let temp: Double?
    let feelsLike: Double?
    let wind: Double?
    let gust: Double?
    let precipChance: Double?
    let elevationFt: Double?
    let approachAdjusted: Bool

    var minutes: Int { DateText.minutes(clock) ?? 0 }

    /// "3 AM"
    var shortLabel: String { Hour.shortLabel(minutes: minutes) }

    static func shortLabel(minutes: Int) -> String {
        let hour = minutes / 60 % 24
        if hour == 12 { return "Noon" }
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve) \(hour < 12 ? "AM" : "PM")"
    }

    var isOver: Bool { !pass && complete }
    var isMissing: Bool { !complete }
}

/// A named check from `evaluation.decision.checks`.
struct Check: Identifiable, Hashable, Sendable {
    let key: String
    let label: String
    let ok: Bool
    let detail: String?
    let action: String?
    var id: String { key }
}

/// A forecast band at one elevation for one hour.
struct ElevationBand: Hashable, Sendable {
    let label: String
    let elevationFt: Double
    let temp: Double?
    let feelsLike: Double?
    let wind: Double?
    let gust: Double?
}

/// Typed reading of a `/api/safety` payload. Everything shown is the backend's evaluation.
struct Report: Sendable {
    let json: JSON
    let data: Data

    init(data: Data) throws {
        self.data = data
        self.json = try JSON.parse(data)
    }

    init(json: JSON) {
        self.json = json
        self.data = json.data()
    }

    var evaluation: JSON { json["evaluation"] }
    var hasEvaluation: Bool { !evaluation.isNull }

    // MARK: Decision

    var level: DecisionLevel { DecisionLevel(evaluation.at("decision.level").string) }
    var headline: String { evaluation.at("decision.headline").string ?? "No decision was returned for this plan." }
    var reason: String? { evaluation.at("verdict.reason").string ?? evaluation.at("decisionSummary.primaryReason").string }
    var bridge: String? { evaluation.at("verdict.bridge").string }
    var limitingChecks: [String] { evaluation.at("verdict.limitingChecks").strings }
    var insufficientEvidence: Bool { evaluation.at("verdict.insufficient").bool ?? false }
    var score: Double? { json.at("safety.score").double }
    var actionLine: String? { evaluation.at("decisionSummary.actionLine").string }
    var warnings: [(title: String, detail: String)] {
        evaluation.at("verdict.warnings").array.map { ($0["title"].string ?? "", $0["detail"].string ?? "") }
    }
    var missingSignals: [String] { evaluation.at("verdict.missing").array.compactMap { $0["title"].string } }
    var fieldSignals: [(title: String, detail: String)] {
        evaluation["fieldSignals"].array.map { ($0["title"].string ?? "", $0["detail"].string ?? "") }
    }

    var checks: [Check] {
        evaluation.at("decision.checks").array.compactMap { check in
            guard let key = check["key"].string, let label = check["label"].string else { return nil }
            return Check(key: key, label: label, ok: check["ok"].bool ?? false, detail: check["detail"].string, action: check["action"].string)
        }
    }

    func check(_ key: String) -> Check? { checks.first { $0.key == key } }

    // MARK: Plan and place

    var generatedAt: Date? { json["generatedAt"].string.flatMap(ISO8601DateFormatter.parse) }
    var generatedAtText: String? { json["generatedAt"].string }
    var selectedDate: String? { json.at("forecast.selectedDate").string }
    var partialData: Bool { json["partialData"].bool ?? false }
    var apiWarning: String? { json["apiWarning"].string }
    /// The backend marks each source fresh or stale; this names the stale ones with when they were issued.
    var freshnessWarning: String? {
        let freshness = evaluation.at("interpretation.sourceFreshness")
        guard freshness["hasWarning"].bool ?? false else { return nil }
        let stale = freshness["rows"].array.filter { $0["state"].string == "stale" }
        guard !stale.isEmpty else { return freshness["warningSummary"].string }
        let parts = stale.map { row -> String in
            let label = row["label"].string ?? "A source"
            guard let issued = row["issued"].string.flatMap(ISO8601DateFormatter.parse) else { return label }
            let age = Date().timeIntervalSince(issued)
            let when = age < 48 * 3600 ? DateText.relative(issued) : issued.formatted(.dateTime.month(.abbreviated).day())
            return "\(label) (issued \(when))"
        }
        let names = parts.formatted(.list(type: .and))
        return stale.count == 1 ? "\(names) is out of date. Check the source before relying on it."
                                : "\(names) are out of date. Check the sources before relying on them."
    }
    var objectiveElevationFt: Double? { json.at("weather.elevation").double }
    var turnaround: String? { evaluation.at("plan.turnaroundTime").string }
    var limits: Limits? {
        let limits = evaluation.at("plan.limits")
        guard let gust = limits["maxWindGustMph"].int, let precip = limits["maxPrecipChance"].int,
              let cold = limits["minFeelsLikeF"].int, let heat = limits["maxFeelsLikeF"].int else { return nil }
        return Limits(maxGustMph: gust, maxPrecipChance: precip, minFeelsLikeF: cold, maxFeelsLikeF: heat)
    }

    // MARK: Hours

    var hours: [Hour] {
        evaluation.at("travelWindow.planned.rows").array.enumerated().map { index, row in
            Hour(
                id: index,
                clock: row["time"].string ?? "00:00",
                pass: row["pass"].bool ?? false,
                complete: row["complete"].bool ?? true,
                failedRules: row["failedRules"].strings,
                condition: row["condition"].string,
                temp: row["temp"].double,
                feelsLike: row["feelsLike"].double,
                wind: row["wind"].double,
                gust: row["gust"].double,
                precipChance: row["precipChance"].double,
                elevationFt: row["elevationFt"].double,
                approachAdjusted: row["approachAdjusted"].bool ?? false
            )
        }
    }

    var windowSummary: String? { evaluation.at("travelWindow.readings.insights.summary").string }
    var windDirection: String? { json.at("weather.windDirection").string }

    // MARK: Sun and snow

    var sunriseMinutes: Int? { DateText.minutesFromSolar(json.at("solar.sunrise").string) }
    var sunsetMinutes: Int? { DateText.minutesFromSolar(json.at("solar.sunset").string) }
    var sunriseText: String? { sunriseMinutes.map { DateText.clock(minutes: $0) } }
    var sunsetText: String? { sunsetMinutes.map { DateText.clock(minutes: $0) } }
    var daylightFromStart: String? { evaluation.at("interpretation.daylightFromStart.label").string }
    var freezingLevelFt: Double? { json.at("atmosphere.freezingLevelFt").double }
    var snowLevelFt: Double? { json.at("atmosphere.snowLevelFt").double }

    // MARK: Elevation

    /// Bands for each planned hour, low to high.
    var bandsByHour: [[ElevationBand]] {
        evaluation.at("elevation.bandsByHour").array.map { hour in
            hour.array.compactMap { band in
                guard let ft = band["elevationFt"].double else { return nil }
                return ElevationBand(label: band["label"].string ?? "", elevationFt: ft, temp: band["temp"].double,
                                     feelsLike: band["feelsLike"].double, wind: band["windSpeed"].double, gust: band["windGust"].double)
            }.sorted { $0.elevationFt < $1.elevationFt }
        }
    }

    var elevationTarget: (elevationFt: Double, byHour: [ElevationBand])? {
        let target = evaluation.at("elevation.target")
        guard let ft = target["elevationFt"].double else { return nil }
        let rows = target["byHour"].array.map { row in
            ElevationBand(label: "Target", elevationFt: ft, temp: row["temp"].double, feelsLike: row["feelsLike"].double,
                          wind: row["windSpeed"].double, gust: row["windGust"].double)
        }
        return (ft, rows)
    }

    var elevationNote: String? { json.at("weather.elevationForecastNote").string }

    // MARK: Avalanche

    var avalanche: JSON { json["avalanche"] }
    var avalancheDisplay: JSON { evaluation.at("interpretation.avalanche") }
    var avalancheRelevant: Bool { avalancheDisplay["relevant"].bool ?? false }
    var avalancheUnknown: Bool { avalancheDisplay["unknown"].bool ?? true }
    var avalancheLevel: Int? { avalancheDisplay["overallLevel"].int }
    var avalancheCaption: String? { avalancheDisplay["briefCaption"].string }
    var avalancheCenter: String? { avalanche["center"].string }
    var avalancheBottomLine: String? {
        avalanche["bottomLine"].string.map { $0.replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&ndash;", with: "–") }
    }
    var avalancheRows: [(label: String, rating: Int?)] {
        avalancheDisplay["elevationRows"].array.map { ($0["label"].string ?? "", $0["rating"].int) }
    }
    var avalancheProblems: [(name: String, aspects: [String], description: String)] {
        avalancheDisplay["problemTerrain"].array.map { ($0["name"].string ?? "Avalanche problem", $0["aspects"].strings, $0["description"].string ?? "") }
    }
    var avalancheLink: URL? { avalanche["link"].string.flatMap(URL.init(string:)) }

    // MARK: Other evidence

    var snowpackSummary: String? { json.at("snowpack.summary").string }
    var snowDepthIn: Double? { json.at("snowpack.snotel.snowDepthIn").double }
    var sweIn: Double? { json.at("snowpack.snotel.sweIn").double }
    var snowStation: String? {
        let snotel = json.at("snowpack.snotel")
        guard let name = snotel["stationName"].string else { return nil }
        if let ft = snotel["elevationFt"].double { return "\(name) · \(Format.feet(ft))" }
        return name
    }
    var terrainLabel: String? {
        // The backend prefixes the label with an emoji ("🌲 Variable Surface"); the app shows the words.
        json.at("terrainCondition.label").string.map { String($0.drop(while: { !$0.isLetter })) }
    }
    var terrainAdvice: String? { json.at("terrainCondition.recommendedTravel").string }
    var alertsCount: Int? { json.at("alerts.activeCount").int }
    var alertTitles: [String] { json.at("alerts.alerts").array.compactMap { $0["event"].string ?? $0["headline"].string } }
    var airQualityAQI: Int? { json.at("airQuality.usAqi").int }
    var airQualityCategory: String? { json.at("airQuality.category").string }
    var gear: [(title: String, detail: String, category: String)] {
        json["gear"].array.compactMap { item in
            guard let title = item["title"].string else { return nil }
            return (title, item["detail"].string ?? "", item["category"].string ?? "Other")
        }
    }
    var sources: [(label: String, state: String, issued: String?)] {
        evaluation.at("interpretation.sourceFreshness.rows").array.map {
            ($0["label"].string ?? "", $0["state"].string ?? "unknown", $0["issued"].string ?? $0["displayValue"].string)
        }
    }
    var weatherProvider: String? { json.at("safety.weatherProvenance.provider").string }
    var forecastLink: URL? { json.at("weather.forecastLink").string.flatMap(URL.init(string:)) }

    /// Night at camp, present on itinerary stage reports (`camp_night=1`).
    var campNight: JSON { json["campNight"] }
}

extension ISO8601DateFormatter {
    static let flexible: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let plain = ISO8601DateFormatter()

    /// Upstream sources stamp times with and without fractional seconds, and some without seconds at all.
    static func parse(_ text: String) -> Date? {
        if let date = flexible.date(from: text) ?? plain.date(from: text) { return date }
        // "2026-09-26T10:00Z": add the missing seconds.
        if let range = text.range(of: #"T\d{2}:\d{2}(?=Z|[+-])"#, options: .regularExpression) {
            return plain.date(from: text.replacingCharacters(in: range, with: text[range] + ":00"))
        }
        return nil
    }
}

/// Presentation of numbers the report carries in imperial units.
enum Format {
    static func feet(_ value: Double) -> String {
        "\(Int(value.rounded()).formatted(.number.grouping(.automatic))) ft"
    }

    static func temp(_ value: Double?) -> String {
        guard let value else { return "—" }
        let rounded = Int(value.rounded())
        return rounded < 0 ? "−\(-rounded)°F" : "\(rounded)°F"
    }

    static func mph(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded())) mph"
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded()))%"
    }

    /// Plain wording for a travel-window rule, as `frontend/src/field/sky/status.ts` does:
    /// "gust 31>25 mph" → "Gusts 31 mph, over your 25 mph limit".
    static func plainRule(_ rule: String) -> String {
        let text = rule.trimmingCharacters(in: .whitespaces)
        if let match = text.wholeMatch(of: /gust (\d+(?:\.\d+)?)>(\d+(?:\.\d+)?) ?(\S*)/) {
            let unit = match.3.isEmpty ? "" : " \(match.3)"
            return "Gusts \(match.1)\(unit), over your \(match.2)\(unit) limit"
        }
        if let match = text.wholeMatch(of: /precip (\d+)%>(\d+)%/) { return "Rain chance \(match.1)%, over your \(match.2)% limit" }
        if let match = text.wholeMatch(of: /feels (.+?)<(.+)/) { return "Feels like \(match.1), below your \(match.2) floor" }
        if let match = text.wholeMatch(of: /feels (.+?)>(.+)/) { return "Feels like \(match.1), above your \(match.2) ceiling" }
        if let match = text.wholeMatch(of: /condition: (.+)/) { return "\(match.1) forecast" }
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}
