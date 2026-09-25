import MapKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Route chapter

/// The route a plan follows: import a GPX track or pick a named route, then check the forecast at
/// checkpoints along it (`/api/route-analysis`). The server works out arrivals and the briefing.
struct RouteChapter: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var plan: Plan
    var report: Report
    var snapshot: Bool

    @State private var suggestions: [JSON] = []
    @State private var loadingSuggestions = false
    @State private var customName = ""
    @State private var analyzing = false
    @State private var progress: String?
    @State private var progressCheckpoints: [JSON] = []
    @State private var error: String?
    @State private var importing = false

    private var current: Plan { store.plan(plan.id) ?? plan }
    private var route: PlanRoute? { current.route }
    private var editable: Bool { !snapshot && !plan.isSample && store.plan(plan.id) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let route {
                routeCard(route)
                Spacer().frame(height: 24)
                if let analysis = route.analysis {
                    AnalysisView(plan: current, analysis: analysis, stale: route.analyzedFor != nil && route.analyzedFor != current.timingKey)
                } else if !editable {
                    Notice(tone: .info, text: "This route wasn’t analyzed when the report was saved.")
                }
            } else if !editable {
                Notice(tone: .info, text: "No route was chosen for this report.")
            }
            if editable {
                Spacer().frame(height: 24)
                chooser
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "gpx") ?? .xml, .xml]) { result in
            importGPX(result)
        }
    }

    private func routeCard(_ route: PlanRoute) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(title: route.name) { Text(route.gpx == nil ? "Named route" : "GPX track") }
            Card(spacing: 8) {
                RouteMapView(route: route, objective: current.objective)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                if let gpx = route.gpx {
                    HStack {
                        FactColumn(label: "Distance", value: Format.miles(gpx.distanceMiles))
                        FactColumn(label: "Gain", value: gpx.elevationGainFt.map(Format.feet) ?? "—")
                        FactColumn(label: "High point", value: gpx.maxElevationFt.map(Format.feet) ?? "—")
                    }
                    let timing = PreferencesStore.shared.preferences.routeTiming(for: current.activityKey)
                    Caption("About \(gpx.estimatedHours(timing)) hours at your pace (\(timing.paceMinutesPerMile) min/mi, \(timing.ascentMinutesPer1000Ft) min per 1,000 ft climbed, \(timing.stopMinutes) min of stops). Your plan is \(current.travelHours) hours.")
                } else if let miles = route.distanceRtMiles {
                    HStack {
                        FactColumn(label: "Round trip", value: Format.miles(miles))
                        FactColumn(label: "Gain", value: route.elevationGainFt.map(Format.feet) ?? "—")
                    }
                }
                if editable {
                    Picker("Route shape", selection: Binding(get: { route.shape }, set: { setShape($0) })) {
                        Text("As drawn").tag("auto")
                        Text("Out and back").tag("out-and-back")
                        Text("Loop").tag("loop")
                        Text("One way").tag("point-to-point")
                    }
                    .pickerStyle(.segmented)
                    HStack(spacing: 10) {
                        Button {
                            Task { await analyze() }
                        } label: {
                            Label(analyzing ? "Checking the route…" : route.analysis == nil ? "Check this route" : "Check again", systemImage: "sparkles")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent).tint(Palette.prominent)
                        .disabled(analyzing || !account.flags.routeAnalysis)
                        Button("Remove", systemImage: "trash", role: .destructive) { removeRoute() }
                            .buttonStyle(.glass).labelStyle(.iconOnly)
                    }
                    if analyzing {
                        HStack(spacing: 8) { ProgressView().controlSize(.small); Caption(progress ?? "Starting…") }
                        ForEach(Array(progressCheckpoints.enumerated()), id: \.offset) { index, checkpoint in
                            Caption("Checkpoint \(index + 1): \(checkpoint["dataAvailable"].bool == true ? "forecast loaded" : "no forecast")")
                        }
                    }
                    if !account.signedIn {
                        Caption("Route checks use AI and need an account. Sign in from Settings.")
                    } else if account.ai.known && !account.ai.routeAnalysis {
                        Caption("Route checks are unavailable on this server right now.")
                    }
                }
                if let error { Caption(error, tone: Palette.caution) }
            }
            .padding(.horizontal, 16)
        }
    }

    private var chooser: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(route == nil ? "Choose a route" : "Another route")
            Card(spacing: 10) {
                if account.flags.gpxImport {
                    Button { importing = true } label: {
                        Label("Import a GPX track", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    Caption("Your GPX’s track sets the checkpoints, and its climb sets where you are each hour.")
                    Divider()
                }
                HStack {
                    TextField("Route name, e.g. Avalanche Gulch", text: $customName)
                        .textInputAutocapitalization(.words)
                    Button("Use") { useRoute(name: customName, miles: nil, gain: nil) }
                        .buttonStyle(.glass).disabled(customName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Button {
                    Task { await loadSuggestions() }
                } label: {
                    Label(loadingSuggestions ? "Finding routes…" : "Suggest routes", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .disabled(loadingSuggestions || !account.signedIn)
                ForEach(Array(suggestions.enumerated()), id: \.offset) { _, option in
                    Button {
                        useRoute(name: option["name"].string ?? "Route", miles: option["distance_rt_miles"].double, gain: option["elev_gain_ft"].double)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(option["name"].string ?? "Route").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                                Spacer()
                                if let grade = option["class"].string { Text(grade).font(.caption).foregroundStyle(Palette.secondary) }
                            }
                            Text([option["distance_rt_miles"].double.map { "\(Format.miles($0)) round trip" }, option["elev_gain_ft"].double.map { "\(Format.feet($0)) gain" }]
                                .compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Palette.secondary)
                            if let description = option["description"].string { Caption(description) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
                if !account.signedIn { Caption("Suggestions use AI and need an account.") }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: Actions

    private func setRoute(_ route: PlanRoute?) {
        var next = current
        next.route = route
        store.update(next)
        Task { await store.reevaluate(next) }
    }

    private func setShape(_ shape: String) {
        guard var route else { return }
        route.shape = shape
        setRoute(route)
    }

    private func removeRoute() { setRoute(nil) }

    private func useRoute(name: String, miles: Double?, gain: Double?) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return }
        customName = ""
        setRoute(PlanRoute(name: String(clean.prefix(200)), gpx: nil, distanceRtMiles: miles, elevationGainFt: gain))
    }

    private func importGPX(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let gpx = try GpxParser.parse(data: Data(contentsOf: url), fileName: url.lastPathComponent)
            error = nil
            setRoute(PlanRoute(name: gpx.name, gpx: gpx, elevationGainFt: gpx.elevationGainFt, shape: gpx.isLoop ? "loop" : "auto"))
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadSuggestions() async {
        loadingSuggestions = true
        defer { loadingSuggestions = false }
        do {
            suggestions = try await APIClient().routeSuggestions(peak: current.objective.shortName, lat: current.objective.lat, lon: current.objective.lon).array
            error = suggestions.isEmpty ? "No routes were suggested for this objective." : nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func analyze() async {
        guard var route else { return }
        let plan = current
        analyzing = true
        progress = "Finding the route…"
        progressCheckpoints = []
        error = nil
        defer { analyzing = false }
        let timing = PreferencesStore.shared.preferences.routeTiming(for: plan.activityKey)
        let units = Units.current
        var body: [String: JSON] = [
            "peak": .string(plan.objective.shortName),
            "route": .string(route.name),
            "lat": .number(plan.objective.lat),
            "lon": .number(plan.objective.lon),
            "date": .string(plan.date),
            "start": .string(plan.start),
            "travel_window_hours": .number(Double(plan.travelHours)),
            "units": .object(["temperature": .string(units.temperature.rawValue), "wind": .string(units.wind.rawValue), "elevation": .string(units.elevation.rawValue)]),
            "pace": .object(["minutesPerMile": .number(Double(timing.paceMinutesPerMile)), "ascentMinutesPer1000Ft": .number(Double(timing.ascentMinutesPer1000Ft)),
                             "stopBufferMinutes": .number(Double(timing.stopMinutes))]),
        ]
        if let gpx = route.gpx {
            body["waypoints"] = .array(gpx.checkpoints.map(\.json))
            body["route_metadata"] = gpx.metadata
            if let track = gpx.analysisTrack { body["track"] = track }
        }
        if let miles = route.distanceRtMiles { body["route_distance_rt_miles"] = .number(miles) }
        if route.shape != "auto" { body["route_shape"] = .string(route.shape) }
        do {
            let result = try await APIClient().routeAnalysis(body: .object(body)) { event in
                Task { @MainActor in
                    switch event["type"].string {
                    case "stage":
                        switch event["stage"].string {
                        case "locating": progress = "Locating \(event["checkpointCount"].int.map { "\($0) checkpoints" } ?? "checkpoints")…"
                        case "forecasts": progress = "Loading forecasts at each checkpoint…"
                        case "briefing": progress = "Writing the route briefing…"
                        default: progress = "Finding the route…"
                        }
                    case "checkpoint": progressCheckpoints.append(event)
                    default: break
                    }
                }
            }
            route.analysis = result
            route.analyzedFor = plan.timingKey
            var next = store.plan(plan.id) ?? plan
            next.route = route
            store.update(next)
            await store.reevaluate(next)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct FactColumn: View {
    var label: String
    var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(Palette.secondary)
            Text(value).font(.subheadline.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A route analysis: the briefing, the turnaround and each checkpoint's forecast.
struct AnalysisView: View {
    var plan: Plan
    var analysis: JSON
    var stale: Bool

    var body: some View {
        let summaries = analysis["summaries"].array
        VStack(alignment: .leading, spacing: 0) {
            if stale {
                Notice(tone: .caution, text: "The plan changed since this route was checked. Check it again for this date and start.")
                Spacer().frame(height: 12)
            }
            if analysis["partialData"].bool == true {
                Notice(tone: .missing, text: "Some checkpoints had no forecast. Missing data doesn’t mean conditions are clear.")
                Spacer().frame(height: 12)
            }
            let turnaround = analysis.at("timing.turnaround")
            if !turnaround.isNull {
                SectionHead("Turnaround")
                Card(spacing: 6) {
                    if let eta = turnaround["objectiveEta"].string { FactRow(label: "Reach \(turnaround["objectiveName"].string ?? "the objective")", value: DateText.clock(eta)) }
                    if let byEnd = turnaround["byPlanEnd"].string {
                        FactRow(label: "Turn around by (plan end)", value: DateText.clock(byEnd), over: (turnaround["marginToPlanEndMinutes"].double ?? 0) < 0)
                    }
                    if let byDark = turnaround["byDark"].string {
                        FactRow(label: "Turn around by (dark)", value: DateText.clock(byDark), over: (turnaround["marginToDarkMinutes"].double ?? 0) < 0)
                    }
                    if let fit = analysis.at("timing.windowFit").string {
                        Caption(fit == "fits" ? "Your pace fits the planned window." : fit == "longer" ? "At your pace the route takes longer than your plan." : "At your pace the route is shorter than your plan.",
                                tone: fit == "longer" ? Palette.caution : Palette.secondary)
                    }
                }
                .padding(.horizontal, 16)
                Spacer().frame(height: 24)
            }
            SectionHead(title: "Checkpoints") { Text("\(summaries.count)") }
            VStack(spacing: 10) {
                ForEach(Array(summaries.enumerated()), id: \.offset) { _, summary in
                    Card(spacing: 4) {
                        HStack {
                            Text(summary["name"].string ?? "Checkpoint").font(.headline).lineLimit(2)
                            Spacer()
                            if let eta = summary["etaTime"].string { Text(DateText.clock(eta)).font(.subheadline.weight(.semibold)).monospacedDigit() }
                        }
                        Text([summary["elev_ft"].double.map(Format.feet), summary["distance_miles"].double.map(Format.miles),
                              summary["leg"].string == "return" ? "return" : nil, summary["daylight"].string == "dark" ? "in the dark" : nil,
                              summary["locationEstimated"].bool == true ? "location estimated" : nil]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                        if summary["dataAvailable"].bool == false {
                            Caption("No forecast for this checkpoint.", tone: Palette.missing)
                        } else {
                            let weather = summary["weather"]
                            HStack {
                                FactColumn(label: "Temp", value: Format.temp(weather["temp"].double))
                                FactColumn(label: "Feels", value: Format.temp(weather["feelsLike"].double))
                                FactColumn(label: "Gust", value: Format.mph(weather["windGust"].double))
                                FactColumn(label: "Precip", value: Format.percent(weather["precipChance"].double))
                            }
                            if let description = weather["description"].string { Caption(description) }
                            if let risk = summary.at("avalanche.risk").string { Caption("Avalanche: \(risk)") }
                            if let alerts = summary["activeAlerts"].int, alerts > 0 { Caption("\(alerts) active alert\(alerts == 1 ? "" : "s")", tone: Palette.caution) }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            if let text = analysis["analysis"].string {
                Spacer().frame(height: 24)
                SectionHead(title: "Route briefing") { Text(analysis["analysisSource"].string == "ai" ? "Written by AI" : "From the data") }
                Card {
                    MarkdownText(text: text)
                    Caption("Planning support that can be wrong. It never changes the decision.")
                }
                .padding(.horizontal, 16)
            }
            if let source = analysis.at("routeSourceDetails.sourceLabel").string ?? analysis["routeSource"].string {
                Caption("Route from \(source).").padding(.horizontal, 20).padding(.top, 10)
            }
        }
    }
}

/// A route on a map: the track or mapped line, checkpoints, and the objective.
struct RouteMapView: View {
    var route: PlanRoute
    var objective: Place

    private var line: [CLLocationCoordinate2D] {
        if let gpx = route.gpx { return gpx.displayTrack.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) } }
        return (route.analysis?["routeGeometry"].array ?? []).compactMap { point in
            guard let lat = point["lat"].double, let lon = point["lon"].double else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lon)
        }
    }

    private var checkpoints: [(name: String, coordinate: CLLocationCoordinate2D)] {
        let analyzed = (route.analysis?["waypoints"].array ?? []).compactMap { point -> (String, CLLocationCoordinate2D)? in
            guard let lat = point["lat"].double, let lon = point["lon"].double else { return nil }
            return (point["name"].string ?? "Checkpoint", CLLocationCoordinate2D(latitude: lat, longitude: lon))
        }
        if !analyzed.isEmpty { return analyzed }
        return (route.gpx?.checkpoints ?? []).map { ($0.name, CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)) }
    }

    var body: some View {
        Map(initialPosition: .automatic) {
            if line.count >= 2 {
                MapPolyline(coordinates: line).stroke(Palette.accent, lineWidth: 4)
            }
            ForEach(Array(checkpoints.enumerated()), id: \.offset) { _, checkpoint in
                Annotation(checkpoint.name, coordinate: checkpoint.coordinate) {
                    Circle().fill(Palette.surface).frame(width: 12, height: 12).overlay(Circle().stroke(Palette.accent, lineWidth: 3))
                }
            }
            Marker(objective.shortName, systemImage: "mountain.2", coordinate: CLLocationCoordinate2D(latitude: objective.lat, longitude: objective.lon))
                .tint(Palette.accent)
        }
        .mapStyle(.hybrid(elevation: .realistic))
    }
}

// MARK: - Approach

/// Where the party starts and how the backend checked the approach hours.
struct ApproachSection: View {
    @Environment(PlanStore.self) private var store
    var plan: Plan
    var report: Report
    var snapshot: Bool
    @State private var trailhead: Int = 0

    var body: some View {
        let approach = report.evaluation.at("plan.approach")
        let summary = report.evaluation.at("travelWindow.planned.approachSummary")
        let editable = !snapshot && !plan.isSample && store.plan(plan.id) != nil
        SectionHead(title: "Your approach") {
            if let source = approach["source"].string { Text(Self.sourceLabel(source)) }
        }
        Card(spacing: 8) {
            if approach.isNull {
                Caption(PreferencesStore.shared.preferences.approachElevationAdjustment
                        ? "Every hour is checked at the objective."
                        : "Approach adjustment is off in Settings, so every hour is checked at the objective.")
            } else {
                FactRow(label: "Trailhead", value: approach["trailheadElevationFt"].double.map(Format.feet) ?? "—")
                FactRow(label: "Objective", value: approach["objectiveElevationFt"].double.map(Format.feet) ?? "—")
                if let hours = summary["adjustedHours"].int, hours > 0, let low = summary["lowFt"].double, let high = summary["highFt"].double {
                    Caption("\(hours) h checked below the objective, around \(Format.roundFeet(low))–\(Format.roundFeet(high)).")
                }
                if !summary["inversionRuns"].array.isEmpty {
                    Caption("Clear, calm air makes a colder valley likely early on; those hours are checked colder, not warmer.")
                }
            }
            if editable {
                Divider()
                Stepper(value: $trailhead, in: 0...20000, step: 100) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Your trailhead").font(.subheadline.weight(.semibold))
                        Text(trailhead == 0 ? "Estimated by the server" : Format.feet(Double(trailhead))).font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
                HStack {
                    Button("Use this trailhead") { save(trailhead == 0 ? nil : Double(trailhead)) }.buttonStyle(.glass)
                        .disabled(Double(trailhead) == (plan.trailheadFt ?? 0))
                    if plan.trailheadFt != nil { Button("Let the server estimate") { trailhead = 0; save(nil) }.buttonStyle(.glass) }
                }
                .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)
        .onAppear { trailhead = Int(plan.trailheadFt ?? approach["trailheadElevationFt"].double ?? 0) }
    }

    private func save(_ feet: Double?) {
        guard var next = store.plan(plan.id) else { return }
        next.trailheadFt = feet
        store.update(next)
        Task { await store.reevaluate(next) }
    }

    static func sourceLabel(_ source: String) -> String {
        switch source {
        case "gpx": "From your GPX"
        case "route": "From the route"
        case "manual": "Your trailhead"
        default: "Estimated"
        }
    }
}

// MARK: - Satellite snow

/// An AI read of recent satellite imagery around the objective (`/api/snow-vision`).
struct SnowVisionSection: View {
    @Environment(AccountStore.self) private var account
    var plan: Plan
    var report: Report
    var snapshot: Bool
    @State private var analysis: String?
    @State private var image: UIImage?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        if account.flags.satelliteImagery, !snapshot, !plan.isSample {
            SectionHead(title: "Satellite snow") { Text("AI") }
            Card(spacing: 8) {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if let analysis {
                    MarkdownText(text: analysis)
                    Caption("Written by AI from satellite imagery and can be wrong.")
                } else {
                    Caption("A read of recent satellite imagery for snow cover around the objective.")
                }
                if let error { Caption(error, tone: Palette.caution) }
                Button {
                    Task { await load() }
                } label: {
                    Label(loading ? "Reading imagery…" : analysis == nil ? "Read satellite snow" : "Read again", systemImage: "sparkles")
                }
                .buttonStyle(.glass)
                .disabled(loading || !account.signedIn || (account.ai.known && !account.ai.snowVision))
                if !account.signedIn { Caption("Uses AI and needs an account.") }
            }
            .padding(.horizontal, 16)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let result = try await APIClient().snowVision(lat: plan.objective.lat, lon: plan.objective.lon, snowpack: report.json["snowpack"], units: Units.current)
            analysis = result["analysis"].string
            if let raw = result["image"].string, let comma = raw.firstIndex(of: ","), let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])) {
                image = UIImage(data: data)
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Markdown

/// Markdown from the AI features, rendered with the system's Markdown support.
struct MarkdownText: View {
    var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                if block.hasPrefix("#") {
                    Text(block.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)).font(.headline)
                } else {
                    Text(Self.attributed(block)).font(.subheadline).foregroundStyle(Palette.label)
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var blocks: [String] {
        text.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    static func attributed(_ block: String) -> AttributedString {
        let lines = block.components(separatedBy: "\n").map { line -> String in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") { return "• " + trimmed.dropFirst(2) }
            return line
        }
        let joined = lines.joined(separator: "\n")
        return (try? AttributedString(markdown: joined, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(joined)
    }
}
