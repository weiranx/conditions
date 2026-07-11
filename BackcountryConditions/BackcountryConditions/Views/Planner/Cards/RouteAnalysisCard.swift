import SwiftUI
import UniformTypeIdentifiers

struct RouteAnalysisCard: View {
    @Environment(AppState.self) private var appState
    let data: SafetyData
    let lat: Double
    let lon: Double
    let objectiveName: String
    let forecastDate: String
    let startTime: String?
    var onRouteAnalysisLoaded: ((RouteAnalysisResult) -> Void)?

    @State private var suggestions: [RouteSuggestion] = []
    @State private var selectedRoute: String?
    @State private var analysis: RouteAnalysisResult?
    @State private var isLoadingSuggestions = false
    @State private var isLoadingAnalysis = false
    @State private var error: String?
    @State private var analysisTask: Task<Void, Never>?
    @State private var showingGPXImporter = false
    @State private var importedGPX: ParsedGPXRoute?
    @State private var customRouteName = ""

    private let routeService = RouteService()

    var body: some View {
        CollapsibleSection(title: "Route Analysis", systemImage: "point.topleft.down.to.point.bottomright.curvepath.fill", headerColor: .purple, initiallyExpanded: false) {
            VStack(alignment: .leading, spacing: 12) {
                routeSuggestionsSection
                importedGPXSection
                errorSection
                analysisSection
            }
            .fileImporter(
                isPresented: $showingGPXImporter,
                allowedContentTypes: [UTType(filenameExtension: "gpx") ?? .xml],
                allowsMultipleSelection: false,
                onCompletion: importGPX
            )
        }
    }

    // MARK: - Route Suggestions

    @ViewBuilder
    private var routeSuggestionsSection: some View {
        if analysis != nil {
            EmptyView()
        } else if isLoadingSuggestions {
            HStack {
                ProgressView().controlSize(.small)
                Text("Loading routes...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if suggestions.isEmpty {
            HStack {
                Button {
                    Task { await loadSuggestions() }
                } label: {
                    Label("Suggested Routes", systemImage: "arrow.triangle.branch")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.bordered)
                .tint(.purple)
                .controlSize(.small)

                Button {
                    showingGPXImporter = true
                } label: {
                    Label("Import GPX", systemImage: "square.and.arrow.down")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.bordered)
                .tint(.purple)
                .controlSize(.small)
            }
        } else {
            routeList
        }
    }

    @ViewBuilder
    private var importedGPXSection: some View {
        if let route = importedGPX, analysis == nil {
            VStack(alignment: .leading, spacing: 8) {
                Label(route.name, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    .font(.subheadline.weight(.semibold))
                Text("\(String(format: "%.2f", route.distanceMiles)) mi · \(route.pointCount) points" + (route.elevationGainFt.map { " · +\(Int($0)) ft" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Five evenly spaced checkpoints will use the uploaded coordinates instead of estimated waypoints.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                HStack {
                    Button("Analyze This Track") {
                        Task { await analyzeImportedGPX(route) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.purple)
                    .controlSize(.small)
                    Button("Remove", role: .destructive) { importedGPX = nil }
                        .controlSize(.small)
                }
            }
            .padding(10)
            .background(.purple.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var routeList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Suggested Routes")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            ForEach(suggestions) { route in
                routeButton(route)
            }

            HStack {
                TextField("Other route name", text: $customRouteName)
                    .textFieldStyle(.roundedBorder)
                Button("Analyze") {
                    let name = customRouteName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    selectedRoute = name
                    Task { await analyzeRoute(name) }
                }
                .disabled(customRouteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func routeButton(_ route: RouteSuggestion) -> some View {
        Button {
            selectedRoute = route.name
            Task { await analyzeRoute(route.name) }
        } label: {
            HStack {
                routeInfo(route)
                Spacer()
                routeTrailing(route)
            }
            .padding(10)
            .background(
                selectedRoute == route.name
                    ? AnyShapeStyle(Color.purple.opacity(0.06))
                    : AnyShapeStyle(.quaternary.opacity(0.15)),
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
    }

    private func routeInfo(_ route: RouteSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(route.name)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
            HStack(spacing: 8) {
                if let dist = route.distance {
                    Text(dist).font(.caption).foregroundStyle(.secondary)
                }
                if let elev = route.elevation {
                    Text(elev).font(.caption).foregroundStyle(.secondary)
                }
                if let difficulty = route.difficulty {
                    Text(difficulty).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let desc = route.description {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }
        }
    }

    @ViewBuilder
    private func routeTrailing(_ route: RouteSuggestion) -> some View {
        if selectedRoute == route.name && isLoadingAnalysis {
            ProgressView().controlSize(.small)
        } else if selectedRoute == route.name {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.purple)
        } else {
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.quaternary)
        }
    }

    // MARK: - Error

    @ViewBuilder
    private var errorSection: some View {
        if let error {
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    // MARK: - Analysis Result

    @ViewBuilder
    private var analysisSection: some View {
        if let analysis {
            if analysis.partialData == true {
                Label("Some route checkpoints could not be checked.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            routeProfileChart(analysis)
            analysisText(analysis)
            waypointsList(analysis)
            Button("Analyze Another Route") {
                self.analysis = nil
                selectedRoute = nil
                importedGPX = nil
            }
            .font(.caption)
        }
    }

    @ViewBuilder
    private func routeProfileChart(_ result: RouteAnalysisResult) -> some View {
        if let waypoints = result.waypoints, waypoints.count >= 2 {
            RouteConditionsProfile(
                waypoints: waypoints,
                summaries: result.summaries ?? [],
                preferences: UserPreferences.load()
            )
        }
    }

    @ViewBuilder
    private func analysisText(_ result: RouteAnalysisResult) -> some View {
        if let text = result.analysis {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                    Text("Route Analysis")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Text(LocalizedStringKey(MarkdownStrip.inlineOnly(text)))
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(.purple.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.purple.opacity(0.12), lineWidth: 0.5)
            )
        }
    }

    @ViewBuilder
    private func waypointsList(_ result: RouteAnalysisResult) -> some View {
        if let waypoints = result.waypoints, !waypoints.isEmpty {
            let summaries = result.summaries ?? []
            VStack(alignment: .leading, spacing: 6) {
                Text("Waypoints")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                VStack(spacing: 0) {
                    ForEach(Array(waypoints.enumerated()), id: \.offset) { index, wp in
                        let summary = summaries.count > index ? summaries[index] : nil
                        waypointRow(index: index, wp: wp, summary: summary, total: waypoints.count)
                    }
                }
                .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    @ViewBuilder
    private func waypointRow(index: Int, wp: RouteWaypoint, summary: RouteSummary?, total: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                HStack(spacing: 6) {
                    Text("\(index + 1)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(waypointScoreColor(summary?.score).opacity(0.7), in: Circle())
                    Text(wp.name ?? "—")
                        .font(.caption.weight(.medium))
                }
                Spacer()
                if let score = summary?.score {
                    Text("\(Int(score))")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(Color.scoreColor(score))
                }
                if let elev = wp.elevation {
                    Text(formatElevation(elev, unit: appState.preferences.elevationUnit))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            // Waypoint conditions summary
            if let s = summary {
                HStack(spacing: 10) {
                    if let w = s.weather {
                        if let temp = w.temp {
                            Label(formatTemperature(temp, unit: appState.preferences.temperatureUnit), systemImage: "thermometer.medium")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let wind = w.windGust ?? w.windSpeed {
                            Label(formatWind(wind, unit: appState.preferences.windSpeedUnit), systemImage: "wind")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let precip = w.precipChance, precip > 0 {
                            Label("\(Int(precip))%", systemImage: "drop.fill")
                                .font(.caption2)
                                .foregroundStyle(precip > 40 ? .blue : .secondary)
                        }
                    }
                    if let alerts = s.activeAlerts, alerts > 0 {
                        Label("\(alerts)", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                    if let avy = s.avalanche, let risk = avy.risk, risk.lowercased() != "none" {
                        Text(risk)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.orange)
                    }
                }
                .padding(.leading, 24)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)

        if index < total - 1 {
            Divider().padding(.horizontal, 10)
        }
    }

    private func waypointScoreColor(_ score: Double?) -> Color {
        guard let score else { return .purple }
        return Color.scoreColor(score)
    }

    // MARK: - Actions

    private func loadSuggestions() async {
        isLoadingSuggestions = true
        error = nil
        do {
            suggestions = try await routeService.fetchSuggestions(peak: objectiveName, lat: lat, lon: lon)
        } catch {
            self.error = "Failed to load routes: \(error.localizedDescription)"
        }
        isLoadingSuggestions = false
    }

    private func analyzeRoute(_ route: String) async {
        analysisTask?.cancel()
        error = nil
        let task = Task { @MainActor in
            isLoadingAnalysis = true
            defer { isLoadingAnalysis = false }
            guard !Task.isCancelled else { return }
            do {
                let result = try await routeService.analyzeRoute(
                    peak: objectiveName,
                    route: route,
                    lat: lat,
                    lon: lon,
                    date: forecastDate,
                    start: startTime,
                    travelWindowHours: Int(appState.preferences.travelWindowHours),
                    preferences: appState.preferences
                )
                guard !Task.isCancelled else { return }
                analysis = result
                onRouteAnalysisLoaded?(result)
            } catch {
                guard !Task.isCancelled else { return }
                self.error = "Analysis failed: \(error.localizedDescription)"
            }
        }
        analysisTask = task
        await task.value
    }

    private func importGPX(_ result: Result<[URL], Error>) {
        do {
            guard let url = try result.get().first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            importedGPX = try GPXParser.parse(data: data, fileName: url.lastPathComponent)
            suggestions = []
            analysis = nil
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func analyzeImportedGPX(_ route: ParsedGPXRoute) async {
        analysisTask?.cancel()
        error = nil
        isLoadingAnalysis = true
        defer { isLoadingAnalysis = false }
        do {
            let metadata = GPXRouteMetadata(
                fileName: route.fileName,
                pointCount: route.pointCount,
                distanceMiles: route.distanceMiles,
                elevationGainFt: route.elevationGainFt,
                minElevationFt: route.minElevationFt,
                maxElevationFt: route.maxElevationFt
            )
            let result = try await routeService.analyzeRoute(
                peak: objectiveName,
                route: route.name,
                lat: lat,
                lon: lon,
                date: forecastDate,
                start: startTime,
                travelWindowHours: Int(appState.preferences.travelWindowHours),
                preferences: appState.preferences,
                waypoints: route.checkpoints,
                routeMetadata: metadata
            )
            analysis = result
            onRouteAnalysisLoaded?(result)
        } catch {
            self.error = "Analysis failed: \(error.localizedDescription)"
        }
    }
}
