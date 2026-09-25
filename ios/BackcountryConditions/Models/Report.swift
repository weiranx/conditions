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
        if Units.current.timeStyle == .twentyFour { return String(format: "%02d", hour) }
        if hour == 12 { return "Noon" }
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve) \(hour < 12 ? "AM" : "PM")"
    }

    var isOver: Bool { !pass && complete }
    var isMissing: Bool { !complete }
}

/// One hour of the objective's forecast, before any approach adjustment.
struct ForecastPoint: Identifiable, Hashable, Sendable {
    let id: Int
    let minutes: Int
    let condition: String?
    let isDaytime: Bool?
    let temp: Double?
    let wind: Double?
    let gust: Double?
    let windDirection: String?
    let precipChance: Double?
    let cloudCover: Double?

    /// "3 AM", matching `Hour.shortLabel`.
    var shortLabel: String { Hour.shortLabel(minutes: minutes) }

    /// Degrees the wind blows from, for a 16-point compass direction ("NNE" → 22.5).
    var windFromDegrees: Double? {
        let points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        return windDirection.flatMap { points.firstIndex(of: $0.uppercased()) }.map { Double($0) * 22.5 }
    }
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
    /// The objective's time zone, which the forecast's clock times are in.
    var timeZone: TimeZone? {
        (json.at("weather.timezone").string ?? json.at("safety.weatherProvenance.timezone").string).flatMap(TimeZone.init(identifier:))
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

    /// The hourly forecast at the objective (`weather.trend`), for the mountain weather graph.
    var forecast: [ForecastPoint] {
        json.at("weather.trend").array.enumerated().compactMap { index, row in
            // "2026-09-26T03:00:00-07:00" carries the objective's local clock.
            let clock = row["timeIso"].string.flatMap { $0.firstMatch(of: /T(\d{2}:\d{2})/).map { String($0.1) } }
            guard let minutes = clock.flatMap(DateText.minutes) else { return nil }
            return ForecastPoint(
                id: index, minutes: minutes, condition: row["condition"].string, isDaytime: row["isDaytime"].bool,
                temp: row["temp"].double, wind: row["wind"].double, gust: row["gust"].double,
                windDirection: row["windDirection"].string, precipChance: row["precipChance"].double,
                cloudCover: row["cloudCover"].double)
        }
    }

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
    struct GearItem: Hashable, Sendable {
        var title: String
        var detail: String
        var category: String
        var tone: String
        var reason: String?
    }

    /// The backend's gear suggestions, one per title and category, keeping the most urgent tone.
    var gear: [GearItem] {
        var seen: [String: Int] = [:]
        var items: [GearItem] = []
        let rank: (String) -> Int = { $0 == "nogo" ? 0 : $0 == "caution" ? 1 : 2 }
        for item in json["gear"].array {
            guard let title = item["title"].string?.trimmingCharacters(in: .whitespaces), !title.isEmpty else { continue }
            let next = GearItem(title: title, detail: item["detail"].string ?? "", category: item["category"].string ?? "Other",
                                tone: item["tone"].string ?? "go", reason: item["reason"].string?.trimmingCharacters(in: .whitespaces).nilIfEmpty)
            let key = "\(title)|\(next.detail)|\(next.category)"
            if let index = seen[key] {
                if rank(next.tone) < rank(items[index].tone) { items[index] = next }
            } else {
                seen[key] = items.count
                items.append(next)
            }
        }
        return items
    }
    var sources: [(label: String, state: String, issued: String?)] {
        evaluation.at("interpretation.sourceFreshness.rows").array.map {
            ($0["label"].string ?? "", $0["state"].string ?? "unknown", $0["issued"].string ?? $0["displayValue"].string)
        }
    }
    var weatherProvider: String? { json.at("safety.weatherProvenance.provider").string }

    /// Links to each source the report read, when it carried one.
    var sourceLinks: [(label: String, url: URL)] {
        let candidates: [(String, String?)] = [
            ("Weather forecast", json.at("weather.forecastLink").string),
            ("Avalanche center", json.at("avalanche.link").string),
            ("Precipitation source", json.at("rainfall.link").string ?? json.at("rainfall.sourceLink").string),
            ("SNOTEL", json.at("snowpack.snotel.link").string),
            ("NOHRSC", json.at("snowpack.nohrsc.link").string),
            ("CDEC", json.at("snowpack.cdec.link").string),
            ("Air quality", json.at("airQuality.link").string ?? json.at("airQuality.sourceLink").string),
        ]
        return candidates.compactMap { label, raw in
            guard let raw, let url = URL(string: raw), url.scheme == "https" || url.scheme == "http" else { return nil }
            return (label, url)
        }
    }
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

/// Presentation of numbers the report carries in imperial units, in the traveler's display units.
enum Format {
    static var units: Units { Units.current }

    static func feet(_ value: Double) -> String {
        "\(Int(units.elevation(value).rounded()).formatted(.number.grouping(.automatic))) \(units.elevationSymbol)"
    }

    /// Feet rounded to the nearest 100 (or 50 m), for "near 7,200 ft".
    static func roundFeet(_ value: Double) -> String {
        let display = units.elevation(value)
        let step: Double = units.elevation == .m ? 50 : 100
        return "\(Int((display / step).rounded() * step).formatted(.number.grouping(.automatic))) \(units.elevationSymbol)"
    }

    static func miles(_ value: Double?) -> String {
        guard let value else { return "—" }
        let display = units.distance(value)
        return "\(display < 10 ? String(format: "%.1f", display) : String(Int(display.rounded()))) \(units.distanceSymbol)"
    }

    static func temp(_ value: Double?) -> String {
        guard let value else { return "—" }
        let rounded = Int(units.temp(value).rounded())
        return rounded < 0 ? "−\(-rounded)\(units.tempSymbol)" : "\(rounded)\(units.tempSymbol)"
    }

    /// A temperature without its unit, for tight labels.
    static func tempNumber(_ value: Double?) -> String {
        guard let value else { return "—" }
        let rounded = Int(units.temp(value).rounded())
        return rounded < 0 ? "−\(-rounded)°" : "\(rounded)°"
    }

    static func mph(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(units.wind(value).rounded())) \(units.windSymbol)"
    }

    /// A wind speed without its unit.
    static func windNumber(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(units.wind(value).rounded()))"
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded()))%"
    }

    static func inches(_ value: Double?) -> String {
        guard let value else { return "—" }
        if units.elevation == .m { return String(format: "%.1f cm", value * 2.54) }
        return String(format: value < 10 ? "%.1f in" : "%.0f in", value)
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

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
