import SwiftUI

// Report sections the web app shows in its chapters, read from the backend's report and evaluation.
// Each one only presents: every rating, level and caption is the backend's.

// MARK: - Shared pieces

/// A labelled value in a two-column list (the web's `sky-list`).
struct FactRow: View {
    var label: String
    var value: String
    var over = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Palette.secondary)
            Spacer(minLength: 12)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(over ? Palette.caution : Palette.label)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// The source JSON behind a section, for readers who want every field (the web's `Details`).
struct RawDataDisclosure: View {
    var title: String
    var value: JSON
    @State private var open = false

    var body: some View {
        if !value.isNull {
            DisclosureGroup(isExpanded: $open) {
                ScrollView(.horizontal) {
                    Text(value.pretty)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Palette.label)
                        .textSelection(.enabled)
                        .padding(.vertical, 6)
                }
                .frame(maxHeight: 320)
            } label: {
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(Palette.secondary).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .tint(Palette.secondary)
        }
    }
}

extension JSON {
    /// Indented JSON text.
    var pretty: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// A 0–max scale with the value marked (the web's `ConditionScale`).
struct ValueScale: View {
    var value: Double?
    var maximum: Double
    var bands: [(from: Double, color: Color)]

    var body: some View {
        Canvas { context, size in
            let w = size.width
            for (index, band) in bands.enumerated() {
                let start = CGFloat(band.from / maximum) * w
                let end = index + 1 < bands.count ? CGFloat(bands[index + 1].from / maximum) * w : w
                context.fill(Path(CGRect(x: start, y: 7, width: max(0, end - start), height: 8)), with: .color(band.color))
            }
            if let value {
                let x = CGFloat(max(0, min(1, value / maximum))) * w
                let dot = CGRect(x: x - 6, y: 5, width: 12, height: 12)
                context.fill(Path(ellipseIn: dot), with: .color(Palette.label))
                context.stroke(Path(ellipseIn: dot), with: .color(Palette.surface), lineWidth: 2)
            }
        }
        .frame(height: 22)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

extension TagKind {
    /// A card status from the backend (`ok`, `over`, `missing`).
    init(status: String?) {
        switch status {
        case "over": self = .over
        case "ok": self = .ok
        default: self = .missing
        }
    }
}

// MARK: - Rain and snow

struct PrecipitationSection: View {
    var report: Report

    var body: some View {
        let rain = report.evaluation.at("interpretation.rainfall")
        if !rain.isNull {
            SectionHead("Rain and snow")
            Card(spacing: 8) {
                CardHead(title: "Recent totals") { if let mode = rain["modeLabel"].string { Text(mode).font(.footnote) } }
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    GridRow {
                        Text("").font(.caption)
                        Text("12 h").font(.caption).foregroundStyle(Palette.secondary)
                        Text("24 h").font(.caption).foregroundStyle(Palette.secondary)
                        Text("48 h").font(.caption).foregroundStyle(Palette.secondary)
                    }
                    GridRow {
                        Text("Rain").font(.subheadline)
                        ForEach(["past12h", "past24h", "past48h"], id: \.self) { key in
                            Text(rain["rainDisplay"][key].string ?? "—").font(.subheadline.weight(.semibold))
                        }
                    }
                    GridRow {
                        Text("Snow").font(.subheadline)
                        ForEach(["past12h", "past24h", "past48h"], id: \.self) { key in
                            Text(rain["snowDisplay"][key].string ?? "—").font(.subheadline.weight(.semibold))
                        }
                    }
                }
                if let note = rain["noteLine"].string { Caption(note) }
                Divider()
                CardHead("During your window")
                FactRow(label: "Rain expected", value: rain["expectedRainWindowDisplay"].string ?? "—")
                FactRow(label: "Snow expected", value: rain["expectedSnowWindowDisplay"].string ?? "—")
                if let note = rain["expectedNoteLine"].string { Caption(note) }
                if let insight = rain["insightLine"].string { Caption(insight, tone: Palette.label) }
                if let link = report.json.at("rainfall.link").string.flatMap(URL.init(string:)) ?? report.json.at("rainfall.sourceLink").string.flatMap(URL.init(string:)) {
                    Link("Precipitation source", destination: link).font(.footnote.weight(.semibold))
                }
                RawDataDisclosure(title: "Precipitation intervals and source data", value: report.json["rainfall"])
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Beyond the weather

struct BeyondWeatherSection: View {
    var report: Report

    var body: some View {
        let interpretation = report.evaluation["interpretation"]
        let heat = interpretation["heatRisk"], fire = interpretation["fireRisk"], visibility = interpretation["visibility"]
        SectionHead("Beyond the weather")
        VStack(spacing: 12) {
            if !heat.isNull {
                Card(spacing: 6) {
                    CardHead(title: "Heat") { StatusTag(kind: TagKind(status: heat["status"].string), text: heat["label"].string ?? "Unknown") }
                    if let guidance = heat["guidance"].string { Caption(guidance) }
                    RawDataDisclosure(title: "Heat-stress measurements", value: report.json["heatRisk"])
                }
            }
            if !fire.isNull {
                Card(spacing: 6) {
                    CardHead(title: "Fire") { StatusTag(kind: TagKind(status: fire["status"].string), text: fire["label"].string ?? "Unknown") }
                    if let explanation = report.json.at("fireRisk.guidance").string ?? report.json.at("fireRisk.explanation").string { Caption(explanation) }
                    RawDataDisclosure(title: "What sets the fire risk", value: report.json["fireRisk"])
                }
            }
            Card(missing: report.airQualityAQI == nil, spacing: 6) {
                CardHead(title: "Air quality") {
                    StatusTag(kind: report.airQualityAQI == nil ? .missing : (report.check("air-quality")?.ok ?? true) ? .ok : .over,
                              text: report.airQualityCategory ?? (report.airQualityAQI == nil ? "Unavailable" : "AQI"))
                }
                if let aqi = report.airQualityAQI {
                    BigValue(text: "AQI \(aqi)", small: true)
                    ValueScale(value: Double(aqi), maximum: 500, bands: [(0, Color(hex: 0x6DBB6D)), (51, Color(hex: 0xE8D44D)), (101, Color(hex: 0xF09A4A)),
                                                                          (151, Color(hex: 0xE0584F)), (201, Color(hex: 0x9B5BA5)), (301, Color(hex: 0x7E2B3A))])
                }
                Caption(report.check("air-quality")?.detail ?? "No air-quality reading was returned. Missing data doesn’t mean the air is clean.")
                RawDataDisclosure(title: "Air-quality sources, timing, and pollutants", value: report.json["airQuality"])
            }
            if !visibility.isNull {
                Card(spacing: 6) {
                    CardHead(title: "Visibility") { StatusTag(kind: TagKind(status: visibility["status"].string), text: visibility["level"].string ?? "Unknown") }
                    if let summary = visibility["summary"].string { Caption(summary) }
                    ForEach(visibility["factors"].strings, id: \.self) { factor in
                        Label(factor, systemImage: "eye").font(.footnote).foregroundStyle(Palette.secondary)
                    }
                    RawDataDisclosure(title: "Visibility risk and active hours", value: report.json.at("weather.visibilityRisk"))
                }
            }
            let atmosphere = report.json["atmosphere"]
            if !atmosphere.isNull {
                Card(spacing: 6) {
                    CardHead("Up high")
                    if let freezing = report.freezingLevelFt { FactRow(label: "Freezing level", value: Format.feet(freezing)) }
                    if let snow = report.snowLevelFt { FactRow(label: "Snow level", value: Format.feet(snow)) }
                    if let uv = atmosphere["uvIndex"].double ?? atmosphere["uvIndexMax"].double { FactRow(label: "UV index", value: String(Int(uv.rounded()))) }
                    if let trend = interpretation["pressureTrend"].string { FactRow(label: "Pressure", value: trend) }
                    if let bluebird = interpretation.at("bluebird.percent").double { FactRow(label: "Clear, dry daylight", value: "\(Int(bluebird.rounded()))%") }
                    RawDataDisclosure(title: "UV, freezing level, and atmospheric context", value: atmosphere)
                    RawDataDisclosure(title: "24-hour temperature context", value: report.json.at("weather.temperatureContext24h"))
                }
            }
            ComfortCard(report: report)
        }
        .padding(.horizontal, 16)
    }
}

/// Weather comfort (pleasantness): comfort only, never the safety decision.
struct ComfortCard: View {
    var report: Report

    var body: some View {
        let comfort = report.evaluation["pleasantness"].isNull ? report.json["pleasantness"] : report.evaluation["pleasantness"]
        if !comfort.isNull {
            Card(spacing: 6) {
                CardHead(title: "Weather comfort") { if let score = comfort["score"].int { Text("\(score)/100").font(.footnote.weight(.semibold)) } }
                BigValue(text: comfort["score"].isNull ? "Unknown" : comfort["label"].string ?? "—", small: true)
                ValueScale(value: comfort["score"].double, maximum: 100, bands: [(0, Palette.caution.opacity(0.5)), (40, Palette.caution.opacity(0.3)),
                                                                                  (60, Palette.okFill), (75, Palette.within), (90, Palette.accent.opacity(0.6))])
                Caption(comfort["summary"].string ?? "A weather-comfort outlook for this outing.")
                if let complete = comfort.at("coverage.completeHours").int, let requested = comfort.at("coverage.requestedHours").int {
                    FactRow(label: "Evidence coverage", value: "\(complete)/\(requested) hours")
                }
                let factors = comfort["factors"].array.filter { $0["score"].double != nil }
                if !factors.isEmpty {
                    DisclosureGroup("What shapes this score") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(factors.enumerated()), id: \.offset) { _, factor in
                                VStack(alignment: .leading, spacing: 2) {
                                    FactRow(label: factor["factor"].string ?? "Factor", value: "\(factor["score"].int ?? 0)/100")
                                    if let message = factor["message"].string { Caption(message) }
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.footnote.weight(.semibold))
                    .tint(Palette.secondary)
                }
                Caption(comfort["disclaimer"].string ?? "Weather comfort only; this score does not change the safety score or go/no-go decision.")
            }
        }
    }
}

// MARK: - Every hour

/// The hourly readings against the limits, as a table (the web's "Every hour against your limits").
struct HourlyTableSection: View {
    var report: Report

    var body: some View {
        let rows = report.evaluation.at("interpretation.weatherTrend").array
        if !rows.isEmpty {
            SectionHead("Every hour")
            Card(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 8) {
                        GridRow {
                            ForEach(["Time", "Temp", "Feels", "Wind", "Gust", "Dir", "Precip", "Humid", "Cloud"], id: \.self) { title in
                                Text(title).font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
                            }
                        }
                        Divider().gridCellUnsizedAxes(.horizontal)
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            GridRow {
                                Text(row["time"].string.map(DateText.clock) ?? row["label"].string ?? "—").font(.caption.weight(.semibold)).gridColumnAlignment(.leading)
                                Text(Format.tempNumber(row["temp"].double)).font(.caption)
                                Text(Format.tempNumber(row["feelsLike"].double)).font(.caption)
                                Text(Format.windNumber(row["wind"].double)).font(.caption)
                                Text(Format.windNumber(row["gust"].double)).font(.caption)
                                Text(row["windDirectionLabel"].string ?? "—").font(.caption)
                                Text(Format.percent(row["precipChance"].double)).font(.caption)
                                Text(Format.percent(row["humidity"].double)).font(.caption)
                                Text(Format.percent(row["cloudCover"].double)).font(.caption)
                            }
                            .monospacedDigit()
                        }
                    }
                    .padding(.vertical, 2)
                }
                Caption("Temperatures in \(Units.current.tempSymbol), wind in \(Units.current.windSymbol).").padding(.top, 10)
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Wind loading

struct WindLoadingSection: View {
    var report: Report

    var body: some View {
        let wind = report.evaluation["windLoading"]
        if !wind.isNull, wind["applies"].bool != false || wind["hintsRelevant"].bool == true {
            SectionHead("Wind loading")
            Card(spacing: 8) {
                CardHead(title: wind["level"].string ?? "Unknown") {
                    StatusTag(kind: ["caution", "nogo"].contains(wind["tone"].string ?? "") ? .over : .ok, text: "\(wind["confidence"].string ?? "Low") confidence")
                }
                HStack(alignment: .top, spacing: 16) {
                    AspectRose(aspects: Set(wind["leewardAspects"].strings)).frame(width: 100, height: 100)
                    if let summary = wind["summary"].string { Caption(summary, tone: Palette.label) }
                }
                if let action = wind["actionLine"].string { Caption(action, tone: Palette.label, emphasized: true) }
                if !wind["leewardAspects"].strings.isEmpty {
                    FactRow(label: "Leeward aspects", value: wind["leewardAspects"].strings.joined(separator: ", "))
                }
                if !wind["secondaryAspects"].strings.isEmpty {
                    FactRow(label: "Cross-loaded", value: wind["secondaryAspects"].strings.joined(separator: ", "))
                }
                if let window = wind["activeWindowLabel"].string { FactRow(label: "Transport", value: window) }
                if let detail = wind["activeHoursDetail"].string { FactRow(label: "When", value: detail) }
                if let focus = wind["elevationFocus"].string { Caption(focus) }
                RawDataDisclosure(title: "Wind loading notes and overlapping avalanche problems", value: wind)
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Terrain through the day

/// Elevation band and aspect lanes, one cell per planned hour (the web's terrain window).
struct TerrainWindowSection: View {
    var report: Report

    var body: some View {
        let grouped = report.evaluation.at("terrain.grouped")
        let lanes = grouped["lanes"].array
        if !lanes.isEmpty {
            let hours = report.hours
            SectionHead("Terrain through the day")
            Card(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 3) {
                            Text("").frame(width: 112, alignment: .leading)
                            ForEach(hours) { hour in
                                Text(hour.shortLabel).font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.secondary).frame(width: 26)
                            }
                        }
                        ForEach(Array(lanes.enumerated()), id: \.offset) { _, lane in
                            HStack(spacing: 3) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(lane["elevationLabel"].string ?? "").font(.caption2.weight(.semibold))
                                    Text(lane["aspectLabel"].string ?? "").font(.caption2).foregroundStyle(Palette.secondary)
                                }
                                .lineLimit(1)
                                .frame(width: 112, alignment: .leading)
                                ForEach(Array(lane["cells"].array.enumerated()), id: \.offset) { _, cell in
                                    RoundedRectangle(cornerRadius: 4).fill(Self.color(cell["level"].string)).frame(width: 26, height: 22)
                                        .accessibilityLabel(cell["level"].string ?? "unknown")
                                }
                            }
                        }
                    }
                }
                HStack(spacing: 12) {
                    ForEach([("lower", "Lower risk"), ("caution", "Caution"), ("avoid", "Avoid"), ("unknown", "Unknown")], id: \.0) { level, label in
                        HStack(spacing: 4) { RoundedRectangle(cornerRadius: 3).fill(Self.color(level)).frame(width: 12, height: 12); Text(label).font(.caption2) }
                    }
                }
                .foregroundStyle(Palette.secondary)
                // How the cells are rated reads as a footnote to the grid, not an introduction to it.
                if let explanation = grouped["explanation"].string { Caption(explanation) }
            }
            .padding(.horizontal, 16)
        }
    }

    static func color(_ level: String?) -> Color {
        switch level {
        case "lower": Palette.within
        case "caution": Color(hex: 0xF2B33D).opacity(0.75)
        case "avoid": Palette.caution.opacity(0.8)
        default: Palette.fill
        }
    }
}

// MARK: - Surface

struct SurfaceSection: View {
    var report: Report

    var body: some View {
        let surface = report.evaluation.at("interpretation.terrainCondition")
        if !surface.isNull {
            SectionHead("Surface and travel")
            Card(spacing: 6) {
                CardHead(title: surface["surfaceLabel"].string ?? report.terrainLabel ?? "Surface") {
                    StatusTag(kind: TagKind(status: surface["status"].string), text: surface["confidence"].string.map { "\($0.capitalized) confidence" } ?? "Not assessed")
                }
                if let summary = surface["summary"].string { Caption(summary, tone: Palette.label) }
                if let travel = surface["recommendedTravel"].string { Caption(travel) }
                let impact = surface["impact"].string
                let reasons = surface["reasons"].strings
                if impact != nil || !reasons.isEmpty {
                    DisclosureGroup("Why") {
                        VStack(alignment: .leading, spacing: 4) {
                            if let impact { Caption(impact) }
                            ForEach(reasons, id: \.self) { reason in
                                HStack(alignment: .firstTextBaseline, spacing: 6) { Circle().fill(Palette.secondary).frame(width: 4, height: 4); Caption(reason) }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.footnote.weight(.semibold))
                    .tint(Palette.secondary)
                }
                let profile = surface["snowProfile"]
                if !profile.isNull {
                    Divider()
                    CardHead(title: profile["label"].string.map { String($0.drop(while: { !$0.isLetter })) } ?? "Snow surface") { if let c = profile["confidence"].string { Text(c.capitalized).font(.footnote) } }
                    if let summary = profile["summary"].string { Caption(summary) }
                    let melt = profile["meltFreeze"]
                    if let line = melt["summary"].string ?? melt["label"].string { Caption(line) }
                }
                RawDataDisclosure(title: "Surface, freeze/thaw, and travel evidence", value: report.json["terrainCondition"])
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Snow observations

struct SnowObservationsSection: View {
    var report: Report

    var body: some View {
        let snow = report.evaluation.at("interpretation.snowpack")
        if !snow.isNull {
            SectionHead(title: "Snow observations") { if let status = snow["statusLabel"].string { Text(status).lineLimit(1) } }
            Card(spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Snow depth").font(.caption).foregroundStyle(Palette.secondary)
                        Text(snow["bestDepthDisplay"].string ?? "—").font(.title3.weight(.semibold))
                        if let source = snow["bestDepthSource"].string { Text(source).font(.caption2).foregroundStyle(Palette.secondary) }
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Water equivalent").font(.caption).foregroundStyle(Palette.secondary)
                        Text(snow["bestSweDisplay"].string ?? "—").font(.title3.weight(.semibold))
                        if let source = snow["bestSweSource"].string { Text(source).font(.caption2).foregroundStyle(Palette.secondary) }
                    }
                }
                if let conflict = snow["depthConflictCaption"].string { Caption(conflict, tone: Palette.caution) }
                Divider()
                ForEach([("snotel", "SNOTEL"), ("nohrsc", "NOHRSC"), ("cdec", "CDEC")], id: \.0) { key, label in
                    let source = snow["sources"][key]
                    if !source.isNull {
                        HStack {
                            Text(label).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text([source["depthDisplay"].string, source["sweDisplay"].string, source["distanceDisplay"].string].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                }
                if let freezing = report.freezingLevelFt { FactRow(label: "Freezing level", value: Format.feet(freezing)) }
                if let level = report.snowLevelFt { FactRow(label: "Snow level", value: Format.feet(level)) }
                if let history = snow["historicalComparisonLine"].string { Caption(history) }
                if let context = snow["observationContext"].string { Caption(context) }
                RawDataDisclosure(title: "Snowpack quality, history, and observation details", value: report.json["snowpack"])
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Score

/// What drives the safety score (the web's `ScoreExplanation`).
struct ScoreSection: View {
    var report: Report
    private static let groupLabels = ["avalanche": "Avalanche", "weather": "Weather & exposure", "alerts": "Official alerts",
                                      "airQuality": "Air quality", "fire": "Fire risk", "terrain": "Terrain"]

    var body: some View {
        let safety = report.json["safety"]
        let insufficient = safety["assessmentStatus"].string == "insufficient_evidence"
        let groups = safety["groupImpacts"].object.compactMap { key, group -> (String, Double, JSON)? in
            guard let deduction = group["effective"].double ?? group["capped"].double, deduction > 0 else { return nil }
            return (key, deduction, group)
        }.sorted { $0.1 > $1.1 }
        SectionHead(title: "What drives the score") {
            Text(insufficient ? "Insufficient evidence" : safety["score"].double.map { "\(Int($0.rounded()))/100" } ?? "—")
        }
        Card(spacing: 8) {
            if groups.isEmpty {
                Caption("No group deductions were supplied with this report.")
            }
            ForEach(groups, id: \.0) { key, deduction, group in
                VStack(alignment: .leading, spacing: 3) {
                    FactRow(label: Self.groupLabels[key] ?? key, value: "−\(deduction.formatted(.number.precision(.fractionLength(0...1)))) pts")
                    GeometryReader { proxy in
                        Capsule().fill(Palette.fill).overlay(alignment: .leading) {
                            Capsule().fill(Palette.caution.opacity(0.7)).frame(width: proxy.size.width * CGFloat(min(100, deduction) / 100))
                        }
                    }
                    .frame(height: 6)
                    if let floor = group["floor"].double, floor > 0, floor == deduction {
                        Caption("Hazard safeguard: \(group["floorReason"].string ?? "A decisive hazard sets a minimum deduction.")")
                    }
                }
            }
            Divider()
            FactRow(label: "Evidence quality", value: safety["evidenceQuality"].string ?? "Not assessed")
            ForEach(Array(Set(safety["evidenceReasons"].strings + safety["confidenceReasons"].strings)).sorted(), id: \.self) { reason in
                Caption("• \(reason)")
            }
            let factors = safety["factors"].array
            if !factors.isEmpty {
                DisclosureGroup("All contributing factors") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(factors.enumerated()), id: \.offset) { _, factor in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(factor["hazard"].string ?? "Condition").font(.footnote.weight(.semibold))
                                Caption(factor["message"].string ?? "Included in the assessment.")
                                if let source = factor["source"].string { Text(source).font(.caption2).foregroundStyle(Palette.secondary) }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                .font(.footnote.weight(.semibold))
                .tint(Palette.secondary)
            }
            DisclosureGroup("How the score works") {
                VStack(alignment: .leading, spacing: 4) {
                    Caption("Higher scores mean fewer modeled hazards. Trip checks and field warnings still apply.")
                    Caption("The score starts at 100. Related hazards are combined to limit double counting; severe hazards can enforce a minimum deduction.")
                    if let version = safety["scoreVersion"].string { Caption("Scoring model \(version) · Saved reports may use earlier rules.") }
                }
                .padding(.top, 6)
            }
            .font(.footnote.weight(.semibold))
            .tint(Palette.secondary)
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Additional sources

struct SupplementalSection: View {
    var report: Report

    private static let kinds = ["observation": "Current observations", "probabilistic_forecast": "Model probability guidance",
                                "regional_context": "Regional forecaster context", "modeled_forecast": "Smoke model snapshot"]

    var body: some View {
        let evidence = report.json["supplementalEvidence"].object.filter { !$0.value.isNull }
        if !evidence.isEmpty {
            let order = ["nbm", "discussion", "hrrrSmoke", "synoptic"]
            let available = evidence.filter { $0.value["available"].bool == true }.sorted { (order.firstIndex(of: $0.key) ?? 99) < (order.firstIndex(of: $1.key) ?? 99) }
            let missing = evidence.filter { $0.value["available"].bool != true }
            SectionHead("Additional sources")
            VStack(spacing: 12) {
                Caption("Use these to cross-check the report. They don’t change its safety score.").padding(.horizontal, 4)
                ForEach(available, id: \.key) { key, source in
                    Card(spacing: 6) {
                        CardHead(title: source["source"].string ?? key) { Text("Available").font(.footnote) }
                        Caption([Self.kinds[source["kind"].string ?? ""], DateText.stamp(source["issuedTime"].string).map { "Issued \($0)" }].compactMap { $0 }.joined(separator: " · "))
                        ForEach(Array(source["stations"].array.prefix(4).enumerated()), id: \.offset) { _, station in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(station["name"].string ?? "Station") (\(station["id"].string ?? ""))").font(.footnote.weight(.semibold))
                                ForEach(station["readings"].object.sorted(by: { $0.key < $1.key }), id: \.key) { name, reading in
                                    let value = reading["value"].double
                                    FactRow(label: name == "temperatureF" ? "Temperature" : name == "gustMph" ? "Wind gust" : "Wind speed",
                                            value: name == "temperatureF" ? Format.temp(value) : Format.mph(value))
                                }
                            }
                        }
                        if !source["points"].array.isEmpty {
                            Text("Wind speed percentiles (P10 · median · P90)").font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
                            ForEach(Array(source["points"].array.prefix(8).enumerated()), id: \.offset) { _, point in
                                FactRow(label: DateText.stamp(point["validTime"].string) ?? "—",
                                        value: [point.at("windMph.p10").double, point.at("windMph.p50").double, point.at("windMph.p90").double].map(Format.windNumber).joined(separator: " · "))
                            }
                        }
                        if let smoke = source["nearSurfaceUgM3"].double {
                            FactRow(label: "Near-surface smoke", value: "\(smoke.formatted()) µg/m³")
                        }
                        if key == "discussion", let text = source["text"].string {
                            let sections = source["sections"].array.filter { $0["kind"].string != "not_relevant" }
                            ForEach(Array(sections.prefix(4).enumerated()), id: \.offset) { _, section in
                                DisclosureGroup((section["title"].string ?? "Section") + (section["matchesTrip"].bool == true ? " · includes your date" : "")) {
                                    Text(section["text"].string ?? "").font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                                }
                                .font(.footnote.weight(.semibold)).tint(Palette.secondary)
                            }
                            DisclosureGroup("Full forecast discussion") {
                                Text(text).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                            }
                            .font(.footnote.weight(.semibold)).tint(Palette.secondary)
                        }
                        if let note = source["note"].string { Caption(note) }
                        if let link = source["sourceLink"].string.flatMap(URL.init(string:)) {
                            Link("View source", destination: link).font(.footnote.weight(.semibold))
                        }
                    }
                }
                if !missing.isEmpty {
                    Card(spacing: 4) {
                        CardHead("Not available for this report")
                        ForEach(missing.sorted { $0.key < $1.key }, id: \.key) { _, source in
                            Caption("\(source["source"].string ?? "Source") · \(Self.status(source))\(source["note"].string.map { " — \($0)" } ?? "")")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private static func status(_ source: JSON) -> String {
        switch source["status"].string {
        case "not_configured": "Not configured"
        case "out_of_range": "Outside coverage"
        case "no_data": "No matching data"
        default: "Unavailable"
        }
    }
}

// MARK: - Alerts

struct AlertsSection: View {
    var report: Report

    var body: some View {
        let alerts = report.json.at("alerts.alerts").array
        let count = report.alertsCount ?? alerts.count
        SectionHead(title: "Official alerts") { Text("\(count) for your time") }
        VStack(spacing: 10) {
            if alerts.isEmpty {
                Card { Caption(report.json.at("alerts.note").string ?? "No alerts were returned. That does not mean there are no hazards.") }
            }
            ForEach(Array(alerts.enumerated()), id: \.offset) { _, alert in
                Card(spacing: 6) {
                    CardHead(title: alert["event"].string ?? "Official alert") { StatusTag(kind: .over, text: alert["severity"].string ?? "Severity unavailable") }
                    if let headline = alert["headline"].string { Text(headline).font(.subheadline.weight(.semibold)) }
                    if let expires = DateText.stamp(alert["expires"].string ?? alert["ends"].string) { Caption("Until \(expires)") }
                    if let description = alert["description"].string {
                        DisclosureGroup("Details") { Text(description).font(.footnote).textSelection(.enabled) }
                            .font(.footnote.weight(.semibold)).tint(Palette.secondary)
                    }
                    if let instruction = alert["instruction"].string { Caption(instruction, tone: Palette.caution, emphasized: true) }
                    if let link = (alert["link"].string ?? alert["url"].string).flatMap(URL.init(string:)) {
                        Link("Open the alert", destination: link).font(.footnote.weight(.semibold))
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - If you're delayed

struct ContingencySection: View {
    var report: Report
    var plan: Plan

    var body: some View {
        let contingency = report.json["contingency"]
        let buffer = contingency["delayBuffer"]
        let night = contingency.at("overnight.status").string == "ok" ? contingency["overnight"] : .null
        if contingency["status"].string == "ok", !buffer.isNull || !night.isNull {
            SectionHead("If you’re delayed")
            Card(spacing: 8) {
                if !buffer.isNull {
                    let hazards = buffer["onsetHazards"].array.compactMap { hazard -> String? in
                        guard let label = hazard["label"].string else { return nil }
                        return "\(label) from \(eventTime(hazard["onsetIso"].string, hoursAfterReturn: hazard["hoursAfterReturn"].double))"
                    } + (buffer["nightfall"].isNull ? [] : ["Dark by \(eventTime(buffer.at("nightfall.onsetIso").string, hoursAfterReturn: buffer.at("nightfall.hoursAfterReturn").double))"])
                    let hours = buffer["hours"].double ?? 0
                    Text("Running up to \(Self.duration(hours)) late" + ((buffer["coveredHours"].double ?? 0) <= 0 ? ": no forecast covers those hours."
                        : hazards.isEmpty ? ": the forecast adds no new hazards." : ": \(hazards.joined(separator: " · ")).")).font(.subheadline)
                        .foregroundStyle(hazards.isEmpty ? Palette.label : Palette.caution)
                    if (buffer["coveredHours"].double ?? 0) > 0 {
                        FactRow(label: "Coldest feels-like", value: Format.temp(buffer["minFeelsLikeF"].double))
                        FactRow(label: "Peak gust", value: Format.mph(buffer["peakGustMph"].double))
                        FactRow(label: "Peak rain chance", value: Format.percent(buffer["peakPrecipChance"].double))
                    }
                }
                if !night.isNull {
                    Divider()
                    CardHead(title: "Unplanned night") {
                        if let severity = night["severity"].string {
                            StatusTag(kind: severity == "low" ? .ok : .over, text: ["high": "Serious", "moderate": "Cold or wet", "low": "Manageable"][severity] ?? severity)
                        }
                    }
                    Caption("Coldest it feels overnight: \(Format.temp(night["minFeelsLikeF"].double))" +
                            ((night["peakGustMph"].double ?? 0) >= 20 ? ", gusts to \(Format.mph(night["peakGustMph"].double))" : "") + ".", tone: Palette.label)
                    FactRow(label: "Air temperature low", value: Format.temp(night["lowTempF"].double))
                    FactRow(label: "Peak wind", value: Format.mph(night["peakWindMph"].double))
                    if night["complete"].bool == false { Caption("The forecast ends before sunrise; the rest of the night is not covered.") }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func eventTime(_ iso: String?, hoursAfterReturn: Double?) -> String {
        if let iso, let date = ISO8601DateFormatter.parse(iso) {
            var calendar = Calendar(identifier: .gregorian)
            if let zone = report.timeZone { calendar.timeZone = zone }
            let parts = calendar.dateComponents([.hour, .minute], from: date)
            return DateText.clock(minutes: (parts.hour ?? 0) * 60 + (parts.minute ?? 0))
        }
        return "\(Self.duration(hoursAfterReturn ?? 0)) after return"
    }

    static func duration(_ hours: Double) -> String {
        let minutes = Int((hours * 60).rounded())
        if minutes < 60 { return "\(minutes) min" }
        return minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes / 60) h \(minutes % 60) min"
    }
}

// MARK: - Field reports

/// A field report to check: a warning symbol, its title and a line or two of detail.
struct SignalRow: View {
    var title: String
    var detail: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").font(.footnote.weight(.semibold)).foregroundStyle(Palette.caution)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                if !detail.isEmpty { Caption(detail).lineLimit(2) }
            }
            Spacer(minLength: 0)
        }
    }
}

/// The feeds that returned nothing, on one line (the web's `sky-missing-line`).
struct MissingFeedsLine: View {
    var titles: [String]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "questionmark.circle").font(.footnote.weight(.semibold)).foregroundStyle(Palette.missing)
            // The backend titles each "Radar unavailable"; the line says "unavailable" once.
            (Text("\(titles.count) \(titles.count == 1 ? "feed" : "feeds") unavailable: ").fontWeight(.semibold)
                + Text(titles.map { $0.replacingOccurrences(of: " unavailable", with: "") }.joined(separator: " · ")))
                .font(.footnote).foregroundStyle(Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

/// Every nearby field report and feed (the web's "Field reports and access").
struct FieldReportsSection: View {
    var report: Report

    var body: some View {
        let signals = report.fieldSignals
        let attention = signals.filter { $0.tone == "attention" }
        let missing = signals.filter { $0.tone == "unavailable" }.map(\.title)
        if report.showsFieldObservations, !signals.isEmpty {
            SectionHead(title: "Field reports and access") {
                Text(attention.isEmpty ? "Nothing unusual" : "\(attention.count) to check")
            }
            Card(spacing: 12) {
                ForEach(Array(attention.enumerated()), id: \.offset) { _, signal in
                    SignalRow(title: signal.title, detail: signal.detail)
                }
                if !missing.isEmpty { MissingFeedsLine(titles: missing) }
                Caption("Nearby stations and reports may not describe your exact route.")
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Before you commit

/// Field, access and forecast insights the backend flagged (the web's `ReportInsights`).
struct InsightsSection: View {
    var report: Report

    var body: some View {
        let flags = report.json["featureFlags"]
        let items = report.json.at("reportInsights.items").array.filter { item in
            item["features"].strings.allSatisfy { flags[$0].bool != false }
        }
        let cautions = items.filter { $0["decisionRelevant"].bool == true }
        let background = items.filter { item in
            item["decisionRelevant"].bool != true && item["tone"].string != "gap"
                && !(item["tone"].string == "context" && ["access", "station-wind", "water"].contains(item["id"].string ?? ""))
        }
        // One view, or none, so a stack spaces it as a single section.
        if !cautions.isEmpty || !background.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(title: cautions.isEmpty ? "Field and access" : "Before you commit") {
                    Text(cautions.isEmpty ? "No flags" : cautions.count == 1 ? "1 check to resolve" : "\(cautions.count) checks to resolve")
                }
                VStack(spacing: 10) {
                    ForEach(Array(cautions.enumerated()), id: \.offset) { _, item in InsightCard(item: item) }
                    if !background.isEmpty {
                        DisclosureGroup("\(background.count) background note\(background.count == 1 ? "" : "s")") {
                            VStack(spacing: 10) { ForEach(Array(background.enumerated()), id: \.offset) { _, item in InsightCard(item: item) } }
                                .padding(.top, 8)
                        }
                        .font(.subheadline.weight(.semibold))
                        .tint(Palette.secondary)
                        .padding(.horizontal, 4)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

/// An insight leads with what to do; what the report found, and its sources, open on request.
struct InsightCard: View {
    var item: JSON

    var body: some View {
        let action = item["action"].string
        // Without an action, the finding is the card's line.
        let meaning = action == nil ? nil : item["meaning"].string
        let evidence = item["evidence"].array
        Card(spacing: 6) {
            if item["decisionRelevant"].bool != true {
                Text(item["tone"].string == "support" ? "Limited agreement" : "Background").font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
            }
            Text(item["title"].string ?? "").font(.headline).foregroundStyle(Palette.label)
            if let line = action ?? item["meaning"].string { Caption(line, tone: Palette.label) }
            if meaning != nil || !evidence.isEmpty {
                DisclosureGroup("Why the report says this") {
                    VStack(alignment: .leading, spacing: 6) {
                        if let meaning { Caption(meaning) }
                        ForEach(Array(evidence.enumerated()), id: \.offset) { _, source in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(source["source"].string ?? "Source").font(.footnote.weight(.semibold))
                                if let detail = source["detail"].string { Caption(detail) }
                                if let time = DateText.stamp(source["time"].string) { Text(time).font(.caption2).foregroundStyle(Palette.secondary) }
                                if let url = source["url"].string.flatMap(URL.init(string:)) { Link("Open source", destination: url).font(.caption.weight(.semibold)) }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                .font(.footnote.weight(.semibold))
                .tint(Palette.secondary)
            }
        }
    }
}

// MARK: - Change from the prior day

struct DayOverDaySection: View {
    var plan: Plan
    var report: Report
    var snapshot: Bool
    @State private var comparison: JSON?
    @State private var loading = false

    var body: some View {
        Group {
            if let comparison, !comparison.isNull {
                SectionHead(title: "Change from the prior day") {
                    if comparison["scoreComparable"].bool == true, let delta = comparison["deltaLabel"].string { Text("\(delta) pts") }
                }
                Card(spacing: 6) {
                    let previous = comparison["previousDate"].string.map(DateText.short) ?? "the day before"
                    Caption(comparison["scoreComparable"].bool == true
                        ? "\(comparison["deltaLabel"].string ?? "0") score points compared with \(previous)."
                        : "Compared with \(previous). One of the two days lacks the evidence for a score, so only the forecast changes are listed.", tone: Palette.label)
                    ForEach(comparison["changes"].strings, id: \.self) { change in
                        HStack(alignment: .firstTextBaseline, spacing: 6) { Circle().fill(Palette.secondary).frame(width: 4, height: 4); Caption(change) }
                    }
                    Caption("Both days use a \(DateText.clock(comparison["startTime"].string ?? plan.start)) start and a \(comparison["travelWindowHours"].int ?? plan.travelHours)-hour window.")
                }
                .padding(.horizontal, 16)
            } else if loading {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Caption("Comparing with the day before…") }.padding(.horizontal, 20)
            }
        }
        .task(id: loadKey) { await load() }
    }

    /// The plan and report generation the comparison is for; a new check or a changed plan compares again.
    private var loadKey: String { "\(plan.checkKey)|\(report.generatedAtText ?? "")" }

    @State private var loadedFor: String?

    private func load() async {
        guard !snapshot, !plan.isSample, loadedFor != loadKey else { return }
        let key = loadKey
        comparison = nil
        loading = true
        defer { loading = false }
        let next = try? await APIClient().dayOverDay(place: plan.objective, params: plan.planParams)
        guard !Task.isCancelled else { return }
        comparison = next
        // A failed request is tried again the next time the section appears.
        if next != nil { loadedFor = key }
    }
}

// MARK: - Gear and field actions

/// Before you leave and the packing list (the web's `GearActions`): the decision's blockers and
/// cautions, the checks that need attention, and the backend's gear, grouped by why it's there.
struct GearActionsSection: View {
    var report: Report
    /// Whose packing list this is (a plan's id): each plan keeps its own.
    var scope: String
    @AppStorage("packedGear.v2") private var packedRaw = ""

    private var allPacked: Set<String> { Set(packedRaw.split(separator: "\n").map(String.init)) }
    private var packed: Set<String> { allPacked.filter { $0.hasPrefix("\(scope)|") } }

    var body: some View {
        let decision = report.evaluation["decision"]
        let blockers = Array(NSOrderedSet(array: decision["blockers"].strings)) as? [String] ?? []
        let cautions = (Array(NSOrderedSet(array: decision["cautions"].strings + decision["advisories"].strings)) as? [String] ?? [])
            .filter { !blockers.contains($0) }
        let actions = report.checks.filter { !$0.ok && !($0.action ?? "").isEmpty }
        let headline = report.level == .noGo ? "Change the plan before packing" : report.level == .go ? "Plan looks workable. Pack for the conditions." : "Settle the plan, then pack"
        VStack(alignment: .leading, spacing: 0) {
            Notice(tone: report.level == .noGo ? .caution : .info, text: [headline, report.actionLine].compactMap { $0 }.joined(separator: ". "))
            Spacer().frame(height: 22)
            SectionHead("Before you leave")
            Card(spacing: 8) {
                if !blockers.isEmpty {
                    Text("Must resolve").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.caution)
                    ForEach(Array(blockers.enumerated()), id: \.offset) { index, item in Caption("\(index + 1). \(item)", tone: Palette.label) }
                }
                if !cautions.isEmpty {
                    Text("Plan around").font(.subheadline.weight(.semibold))
                    ForEach(Array(cautions.enumerated()), id: \.offset) { index, item in Caption("\(blockers.count + index + 1). \(item)", tone: Palette.label) }
                }
                if !actions.isEmpty {
                    DisclosureGroup("\(actions.count) \(actions.count == 1 ? "check needs" : "checks need") attention") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(actions) { check in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(check.label).font(.footnote.weight(.semibold))
                                    Caption(check.action ?? "")
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.footnote.weight(.semibold)).tint(Palette.secondary)
                }
                if blockers.isEmpty && cautions.isEmpty && actions.isEmpty {
                    Caption("Nothing in this report calls for a plan change. Check current sources and agree on a turnaround time with your group.")
                }
            }
            .padding(.horizontal, 16)
            Spacer().frame(height: 26)
            packingList
        }
    }

    @ViewBuilder
    private var packingList: some View {
        let items = report.gear
        let groups: [(id: String, label: String, note: String)] = [
            ("priority", "Don’t leave without", "Required for the hazards in this report."),
            ("conditions", "For today’s conditions", "Added because of this forecast. Each item says why."),
            ("other", "Standard kit", "Bring these on every trip like this one."),
        ]
        SectionHead(title: "Packing list") {
            if !items.isEmpty { Text("\(items.filter { packed.contains(key($0)) }.count) of \(items.count) packed") }
        }
        if items.isEmpty {
            Notice(tone: .missing, text: "No gear suggestions came with this report.")
        }
        ForEach(groups, id: \.id) { group in
            let members = items.filter { Self.group($0.tone) == group.id }
            if !members.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.label).font(.headline).padding(.horizontal, 20)
                    Caption(group.note).padding(.horizontal, 20)
                    VStack(spacing: 8) {
                        ForEach(Array(members.enumerated()), id: \.offset) { _, item in
                            Button { toggle(item) } label: {
                                Card(spacing: 3) {
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: packed.contains(key(item)) ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(packed.contains(key(item)) ? Palette.accent : Palette.secondary)
                                            .font(.title3)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                                                .strikethrough(packed.contains(key(item)))
                                            if !item.detail.isEmpty { Caption(item.detail) }
                                            if let reason = item.reason { Caption("Why: \(reason)") }
                                        }
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 20)
            }
        }
        if !packed.isEmpty {
            Button("Clear packed items", systemImage: "arrow.counterclockwise") { packedRaw = allPacked.subtracting(packed).sorted().joined(separator: "\n") }
                .buttonStyle(.glass).padding(.horizontal, 20)
        }
    }

    private static func group(_ tone: String) -> String {
        tone == "nogo" ? "priority" : tone == "caution" || tone == "watch" ? "conditions" : "other"
    }

    private func key(_ item: Report.GearItem) -> String { "\(scope)|\(item.title)|\(item.category)" }

    private func toggle(_ item: Report.GearItem) {
        var next = allPacked
        if next.contains(key(item)) { next.remove(key(item)) } else { next.insert(key(item)) }
        packedRaw = next.sorted().joined(separator: "\n")
    }
}
