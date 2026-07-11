import SwiftUI

struct PlannerView: View {
    @Environment(AppState.self) private var appState
    @State private var plannerVM = PlannerViewModel()
    @State private var searchVM = SearchViewModel()
    @State private var isSearchActive = false
    @State private var recentReports: [SavedReport] = []
    @State private var locationService = LocationService()
    @State private var locationError: String?
    @State private var travelWindowHours = UserPreferences.load().travelWindowHours

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 16) {
                        plannerHeader
                        savedObjectivesSection
                        recentSearches
                        recentReportsSection
                        mapView
                        controls
                        status
                        cards(proxy: proxy)
                        emptyState
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 18)
                }
                .background(Color.webBackground)
            }
            .toolbar(.hidden, for: .navigationBar)
            .task {
                recentReports = (try? await ReportStore.shared.loadAll()) ?? []
                applyPendingPlannerState()
            }
            .onChange(of: plannerVM.currentReportId) { _, _ in
                Task {
                    recentReports = (try? await ReportStore.shared.loadAll()) ?? []
                }
            }
            .refreshable {
                if plannerVM.hasObjective {
                    await plannerVM.loadReport(preferences: effectivePreferences)
                }
            }
            .onChange(of: appState.selectedObjective?.id) { _, _ in applyPendingPlannerState() }
            .onChange(of: plannerVM.lat) { _, _ in syncSelectedObjective() }
            .onChange(of: locationService.currentLocation?.latitude) { _, _ in
                guard let coordinate = locationService.currentLocation else { return }
                selectCoordinate(name: "Current Location", lat: coordinate.latitude, lon: coordinate.longitude)
            }
            .onChange(of: locationService.locationError?.localizedDescription) { _, message in
                locationError = message
            }
        }
    }

    private var effectivePreferences: UserPreferences {
        var preferences = appState.preferences
        preferences.travelWindowHours = travelWindowHours
        return preferences
    }

    private var plannerHeader: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 7) {
                    WebKicker(text: "Decision workspace", systemImage: "safari")
                    Text("Plan with the\nwhole picture.")
                        .font(.webDisplay(34, weight: .semibold))
                        .tracking(-1.1)
                        .foregroundStyle(Color.webInk)
                    Text("Set an objective and timing. We’ll organize the signals that shape the call.")
                        .font(.webSans(13))
                        .foregroundStyle(Color.webInkSecondary)
                        .lineSpacing(3)
                }
                Spacer(minLength: 4)
                VStack(spacing: 9) {
                    NavigationLink {
                        ReportHistoryView()
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .frame(width: 36, height: 36)
                            .background(Color.webSurfaceSubtle, in: RoundedRectangle(cornerRadius: 9))
                    }
                    if let data = plannerVM.safetyData, let decision = plannerVM.decision {
                        ShareLink(item: shareSummary(data: data, decision: decision)) {
                            Image(systemName: "square.and.arrow.up")
                                .frame(width: 36, height: 36)
                                .background(Color.webSurfaceSubtle, in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                }
                .foregroundStyle(Color.webPineDeep)
            }

            if !plannerVM.hasReport {
                searchBar
            } else {
                HStack {
                    Label(plannerVM.objectiveName, systemImage: "mappin.and.ellipse")
                        .font(.webSans(14, weight: .semibold))
                        .foregroundStyle(Color.webPineDeep)
                    Spacer()
                    Button("New objective") {
                        plannerVM.clear()
                        appState.selectedObjective = nil
                        isSearchActive = true
                    }
                    .font(.webSans(12, weight: .semibold))
                    .foregroundStyle(Color.webPineDeep)
                }
                .padding(12)
                .background(Color.webPineSoft, in: RoundedRectangle(cornerRadius: 9))
            }
        }
        .webCard(padding: 18)
    }

    private func shareSummary(data: SafetyData, decision: SummitDecision) -> String {
        [
            "Backcountry Conditions — \(plannerVM.objectiveName)",
            "\(plannerVM.forecastDate) at \(plannerVM.startTime)",
            "Decision: \(decision.level.rawValue)",
            "Safety score: \(Int(data.safety.score))/100",
            decision.headline,
            "Coordinates: \(String(format: "%.5f", data.location.lat)), \(String(format: "%.5f", data.location.lon))",
            "",
            Configuration.appDisclaimer
        ].joined(separator: "\n")
    }

    private var searchBar: some View {
        VStack(spacing: 8) {
            SearchBarView(searchVM: searchVM, isSearchActive: $isSearchActive) { result in
                Haptics.selection()
                isSearchActive = false
                plannerVM.setObjective(result: result)
                searchVM.addToRecent(result)
            }
            HStack {
                Button {
                    locationError = nil
                    if locationService.authorizationStatus == .notDetermined {
                        locationService.requestPermission()
                    } else {
                        locationService.requestLocation()
                    }
                } label: {
                    Label("Use My Location", systemImage: "location.fill")
                }
                .font(.caption.weight(.medium))
                Spacer()
                if let locationError {
                    Text(locationError).font(.caption2).foregroundStyle(.red).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder
    private var bookmarkButton: some View {
        if plannerVM.hasObjective, let lat = plannerVM.lat, let lon = plannerVM.lon {
            let result = SearchResult(
                name: plannerVM.objectiveName,
                lat: lat,
                lon: lon,
                resultClass: nil,
                type: nil
            )
            let saved = searchVM.isSaved(result)

            Button {
                Haptics.selection()
                searchVM.toggleSavedObjective(result)
            } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(saved ? .orange : .secondary)
            }
        }
    }

    @ViewBuilder
    private var recentSearches: some View {
        if (isSearchActive || !plannerVM.hasObjective) && !plannerVM.isLoading && !searchVM.recentSearches.isEmpty && searchVM.suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Recent", systemImage: "clock")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Clear") {
                        searchVM.clearRecentSearches()
                    }
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 14)

                let items = Array(searchVM.recentSearches.prefix(plannerVM.hasObjective ? 3 : 8))
                ForEach(Array(items.enumerated()), id: \.element.id) { index, result in
                    Button {
                        isSearchActive = false
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        plannerVM.setObjective(result: result)
                        searchVM.addToRecent(result)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "mountain.2")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.blue.opacity(0.7))
                                .frame(width: 26, height: 26)
                                .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(result.name)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(String(format: "%.3f°%@, %.3f°%@", abs(result.lat), result.lat >= 0 ? "N" : "S", abs(result.lon), result.lon >= 0 ? "E" : "W"))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.quaternary)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                    }

                    if index < items.count - 1 {
                        Divider()
                            .padding(.leading, 50)
                    }
                }
            }
            .padding(.vertical, 12)
            .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.webLine, lineWidth: 1)
            )
            .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
        }
    }

    @ViewBuilder
    private var recentReportsSection: some View {
        if !plannerVM.hasObjective && !plannerVM.isLoading && !recentReports.isEmpty && searchVM.suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Recent Reports", systemImage: "clock.arrow.circlepath")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)

                let items = Array(recentReports.prefix(5))
                ForEach(Array(items.enumerated()), id: \.element.id) { index, report in
                    Button {
                        isSearchActive = false
                        let result = SearchResult(
                            name: report.objectiveName,
                            lat: report.lat,
                            lon: report.lon,
                            resultClass: nil,
                            type: nil
                        )
                        plannerVM.setObjective(result: result)
                        plannerVM.forecastDate = report.forecastDate
                        plannerVM.startTime = report.startTime
                    } label: {
                        HStack(spacing: 10) {
                            decisionDot(report.decisionLevel)
                                .frame(width: 26, height: 26)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(report.objectiveName)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                HStack(spacing: 6) {
                                    Text(report.forecastDate)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                    Text("Score: \(Int(report.safetyScore))")
                                        .font(.caption2)
                                        .foregroundStyle(Color.scoreColor(report.safetyScore))
                                }
                            }

                            Spacer()

                            Text(report.decisionLevel)
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(decisionBadgeColor(report.decisionLevel), in: Capsule())
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                    }

                    if index < items.count - 1 {
                        Divider()
                            .padding(.leading, 50)
                    }
                }
            }
            .padding(.vertical, 12)
            .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.webLine, lineWidth: 1)
            )
            .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
        }
    }

    private func decisionDot(_ level: String) -> some View {
        Circle()
            .fill(decisionBadgeColor(level).opacity(0.15))
            .overlay(
                Image(systemName: level == "GO" ? "checkmark" : level == "CAUTION" ? "exclamationmark" : "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(decisionBadgeColor(level))
            )
    }

    private func decisionBadgeColor(_ level: String) -> Color {
        switch level {
        case "GO": return .green
        case "CAUTION": return .orange
        case "NO-GO": return .red
        default: return .gray
        }
    }

    @ViewBuilder
    private var controls: some View {
        if plannerVM.hasObjective {
            VStack(spacing: 0) {
                PlannerControlsView(
                    forecastDate: $plannerVM.forecastDate,
                    startTime: $plannerVM.startTime,
                    travelWindowHours: $travelWindowHours,
                    objectiveName: plannerVM.objectiveName,
                    isLocked: plannerVM.hasReport,
                    onReload: {
                        Task {
                            await plannerVM.loadReport(preferences: effectivePreferences)
                        }
                    },
                    trailingContent: { bookmarkButton }
                )
            }

            if !plannerVM.hasReport && !plannerVM.isLoading {
                Button {
                    Task { await plannerVM.loadReport(preferences: effectivePreferences) }
                } label: {
                    Label("Get Conditions", systemImage: "checkmark.shield.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(WebPrimaryButtonStyle())
                .accessibilityHint("Generates the safety report for the selected date and start time")
            }
        }
    }

    @ViewBuilder
    private var mapView: some View {
        if let lat = plannerVM.lat, let lon = plannerVM.lon {
            MapCard(
                lat: lat,
                lon: lon,
                objectiveName: plannerVM.objectiveName,
                elevationFt: plannerVM.safetyData?.weather.elevation,
                elevationUnit: appState.preferences.elevationUnit
            )
        } else if !isSearchActive {
            MapCard(
                lat: Configuration.defaultCenter.lat,
                lon: Configuration.defaultCenter.lon,
                objectiveName: "Drop a pin",
                onTapLocation: { lat, lon in selectCoordinate(name: "Dropped Pin", lat: lat, lon: lon) }
            )
        }
    }

    private func selectCoordinate(name: String, lat: Double, lon: Double) {
        let result = SearchResult(name: name, lat: lat, lon: lon, resultClass: "coordinate", type: "location")
        plannerVM.setObjective(result: result)
        searchVM.addToRecent(result)
        isSearchActive = false
        Haptics.selection()
    }

    private func syncSelectedObjective() {
        guard let lat = plannerVM.lat, let lon = plannerVM.lon else { return }
        appState.selectedObjective = SearchResult(
            name: plannerVM.objectiveName,
            lat: lat,
            lon: lon,
            resultClass: "selected",
            type: "location"
        )
    }

    private func applyPendingPlannerState() {
        if let objective = appState.selectedObjective {
            let currentId = plannerVM.lat.flatMap { lat in
                plannerVM.lon.map { lon in SearchResult(name: plannerVM.objectiveName, lat: lat, lon: lon, resultClass: nil, type: nil).id }
            }
            if currentId != objective.id {
                plannerVM.clear()
                plannerVM.setObjective(result: objective)
                searchVM.query = objective.name
            }
        }
        if let date = appState.plannerForecastDate { plannerVM.forecastDate = date }
        if let start = appState.plannerStartTime { plannerVM.startTime = start }
        if let hours = appState.plannerTravelWindowHours { travelWindowHours = hours }
        if appState.shouldGeneratePlannerReport, plannerVM.hasObjective {
            appState.shouldGeneratePlannerReport = false
            Task { await plannerVM.loadReport(preferences: effectivePreferences) }
        }
    }

    @ViewBuilder
    private var status: some View {
        if plannerVM.isLoading {
            ForecastLoadingView()
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
        } else if let error = plannerVM.error {
            ErrorBannerView(message: error) {
                Task {
                    await plannerVM.loadReport(preferences: effectivePreferences)
                }
            }
        }

        if plannerVM.safetyData?.partialData == true {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(.orange)
                Text(plannerVM.safetyData?.apiWarning ?? "Some data sources are unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(.orange.opacity(0.15), lineWidth: 0.5)
            )
        }
    }

    @ViewBuilder
    private func cards(proxy: ScrollViewProxy) -> some View {
        if let data = plannerVM.safetyData, let decision = plannerVM.decision {
            let prefs = effectivePreferences
            let visibleCards = PlannerCardType.allCases.filter { $0.isVisible(for: data) }
            LazyVStack(spacing: 12) {
                ForEach(visibleCards) { cardType in
                    PlannerCardFactory.view(
                        for: cardType,
                        data: data,
                        decision: decision,
                        preferences: prefs,
                        aiBrief: plannerVM.aiBrief,
                        isLoadingBrief: plannerVM.isLoadingBrief,
                        onRequestBrief: { Task { await plannerVM.loadAiBrief(preferences: prefs) } },
                        objectiveName: plannerVM.objectiveName,
                        forecastDate: plannerVM.forecastDate,
                        startTime: plannerVM.startTime,
                        onScrollToCard: { target in
                            withAnimation {
                                proxy.scrollTo(target, anchor: .top)
                            }
                        },
                        onRouteAnalysisLoaded: { result in
                            plannerVM.saveRouteAnalysis(result)
                        }
                    )
                    .id(cardType)
                }
            }
            .opacity(plannerVM.isLoading ? 0.4 : 1)
            .allowsHitTesting(!plannerVM.isLoading)
            .animation(.easeInOut(duration: 0.2), value: plannerVM.isLoading)
        }
    }

    @ViewBuilder
    private var savedObjectivesSection: some View {
        if (isSearchActive || !plannerVM.hasObjective) && !searchVM.savedObjectives.isEmpty && searchVM.suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Saved Objectives", systemImage: "bookmark.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)

                let items = Array(searchVM.savedObjectives.prefix(6))
                ForEach(Array(items.enumerated()), id: \.element.id) { index, result in
                    Button {
                        isSearchActive = false
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        plannerVM.setObjective(result: result)
                        searchVM.addToRecent(result)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "bookmark.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.orange.opacity(0.8))
                                .frame(width: 26, height: 26)
                                .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(result.name)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(String(format: "%.3f°%@, %.3f°%@", abs(result.lat), result.lat >= 0 ? "N" : "S", abs(result.lon), result.lon >= 0 ? "E" : "W"))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }

                            Spacer()

                            Button {
                                searchVM.toggleSavedObjective(result)
                            } label: {
                                Image(systemName: "bookmark.slash")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                    }

                    if index < items.count - 1 {
                        Divider()
                            .padding(.leading, 50)
                    }
                }
            }
            .padding(.vertical, 12)
            .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.webLine, lineWidth: 1)
            )
            .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !plannerVM.hasObjective && !plannerVM.isLoading {
            VStack(alignment: .leading, spacing: 14) {
                WebSectionHeader(
                    "Select a location to start planning",
                    number: "01",
                    subtitle: "Search for a peak, trail area, zone, or tap the map to place a pin."
                )
                Divider().overlay(Color.webLine)
                Label("Your date, start time, and travel window unlock after selecting an objective.", systemImage: "arrow.up")
                    .font(.webSans(12))
                    .foregroundStyle(Color.webInkTertiary)
            }
            .webCard(padding: 18)
        }
    }
}

// MARK: - Card Type Enum

enum PlannerCardType: Int, CaseIterable, Identifiable {
    case decision, safetyScore, travelWindow, weather, windLoading, visibilityRisk
    case avalanche, alerts
    case terrain, snowpack, gear, fireRisk, heatRisk
    case airQuality, rainfall, sourceFreshness, routeAnalysis, usefulLinks

    var id: Int { rawValue }

    /// Whether this card should be visible given the current data.
    func isVisible(for data: SafetyData) -> Bool {
        switch self {
        case .decision, .safetyScore, .travelWindow, .weather, .usefulLinks, .sourceFreshness:
            return true
        case .windLoading:
            return true // always show — relevance handled inline
        case .visibilityRisk:
            let level = data.weather.visibilityRisk?.level?.lowercased() ?? "none"
            return level != "none" && level != "minimal" && level != "low"
        case .avalanche:
            return true // always show — relevance is displayed inline
        case .alerts:
            return true // shows "no active alerts" which is reassuring
        case .terrain:
            return data.terrainCondition != nil
        case .snowpack:
            return data.snowpack != nil
        case .gear:
            return data.gear != nil && !(data.gear?.isEmpty ?? true)
        case .fireRisk:
            return data.fireRisk != nil
        case .heatRisk:
            return data.heatRisk != nil
        case .airQuality:
            return data.airQuality != nil
        case .rainfall:
            return data.rainfall != nil
        case .routeAnalysis:
            return true
        }
    }

    /// Maps a DecisionEngine check key to the card the user should scroll to.
    static func cardForCheckKey(_ key: String) -> PlannerCardType? {
        switch key {
        case "safety-score": return .safetyScore
        case "avalanche":    return .avalanche
        case "wind":         return .windLoading
        case "precip":       return .weather
        case "temp":         return .weather
        case "alerts":       return .alerts
        case "fire":         return .fireRisk
        case "heat":         return .heatRisk
        case "aqi":          return .airQuality
        default:             return nil
        }
    }
}

// MARK: - Card Factory

enum PlannerCardFactory {
    @MainActor
    static func view(
        for card: PlannerCardType,
        data: SafetyData,
        decision: SummitDecision,
        preferences: UserPreferences,
        aiBrief: String?,
        isLoadingBrief: Bool,
        onRequestBrief: (() -> Void)?,
        objectiveName: String = "",
        forecastDate: String = "",
        startTime: String? = nil,
        onScrollToCard: ((PlannerCardType) -> Void)? = nil,
        onRouteAnalysisLoaded: ((RouteAnalysisResult) -> Void)? = nil
    ) -> AnyView {
        switch card {
        case .decision:
            AnyView(DecisionGateCard(decision: decision, onScrollToCard: onScrollToCard))
        case .travelWindow:
            AnyView(TravelWindowCard(data: data, preferences: preferences))
        case .weather:
            AnyView(WeatherCard(data: data, preferences: preferences))
        case .windLoading:
            AnyView(WindLoadingCard(data: data))
        case .visibilityRisk:
            AnyView(VisibilityRiskCard(data: data))
        case .avalanche:
            AnyView(AvalancheCard(data: data))
        case .alerts:
            AnyView(AlertsCard(data: data))
        case .gear:
            AnyView(GearCard(data: data))
        case .safetyScore:
            AnyView(SafetyScoreCard(
                data: data,
                aiBrief: aiBrief,
                isLoadingBrief: isLoadingBrief,
                onRequestBrief: onRequestBrief
            ))
        case .terrain:
            AnyView(TerrainCard(data: data, preferences: preferences))
        case .snowpack:
            AnyView(SnowpackCard(data: data, preferences: preferences))
        case .fireRisk:
            AnyView(FireRiskCard(data: data))
        case .heatRisk:
            AnyView(HeatRiskCard(data: data, preferences: preferences))
        case .airQuality:
            AnyView(AirQualityCard(data: data))
        case .rainfall:
            AnyView(RainfallCard(data: data, preferences: preferences))
        case .sourceFreshness:
            AnyView(SourceFreshnessCard(data: data))
        case .routeAnalysis:
            AnyView(RouteAnalysisCard(
                data: data,
                lat: data.location.lat,
                lon: data.location.lon,
                objectiveName: objectiveName,
                forecastDate: forecastDate,
                startTime: startTime,
                onRouteAnalysisLoaded: onRouteAnalysisLoaded
            ).id(objectiveName))
        case .usefulLinks:
            AnyView(UsefulLinksCard(lat: data.location.lat, lon: data.location.lon))
        }
    }
}

// MARK: - Planner Controls

struct PlannerControlsView<Trailing: View>: View {
    @Binding var forecastDate: String
    @Binding var startTime: String
    @Binding var travelWindowHours: Double
    var objectiveName: String
    var isLocked: Bool
    var onReload: () -> Void
    @ViewBuilder var trailingContent: () -> Trailing

    @State private var datePickerDate = Date()
    @State private var timePickerDate = Date()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Color.webPineDeep)
                Text(objectiveName)
                    .font(.webSans(14, weight: .semibold))
                    .foregroundStyle(Color.webInk)
                    .lineLimit(1)
                Spacer()
                trailingContent()
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("DATE")
                        .font(.webMono(9))
                        .foregroundStyle(Color.webInkTertiary)
                    DatePicker("", selection: $datePickerDate, in: forecastDateRange, displayedComponents: .date)
                        .labelsHidden()
                        .disabled(isLocked)
                        .onChange(of: datePickerDate) { _, newValue in
                            forecastDate = DateFormatting.formatDateInput(newValue)
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("START TIME")
                        .font(.webMono(9))
                        .foregroundStyle(Color.webInkTertiary)
                    DatePicker("", selection: $timePickerDate, displayedComponents: .hourAndMinute)
                        .labelsHidden()
                        .disabled(isLocked)
                        .onChange(of: timePickerDate) { _, newValue in
                            let formatter = DateFormatter()
                            formatter.dateFormat = "HH:mm"
                            startTime = formatter.string(from: newValue)
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("TRIP HOURS")
                        .font(.webMono(9))
                        .foregroundStyle(Color.webInkTertiary)
                    HStack(spacing: 3) {
                        Text("\(Int(travelWindowHours))")
                            .font(.webMono(13))
                        Stepper("", value: $travelWindowHours, in: 1...24, step: 1)
                            .labelsHidden()
                            .disabled(isLocked)
                    }
                }

                Spacer()

                if isLocked {
                    Button(action: onReload) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(
                            LinearGradient(colors: [.webPine, .webPineDeep], startPoint: .top, endPoint: .bottom),
                                in: Circle()
                            )
                            .shadow(color: Color.webPineDeep.opacity(0.2), radius: 6, y: 3)
                    }
                    .accessibilityLabel("Refresh report")
                }
            }
        }
        .padding(16)
        .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.webLine, lineWidth: 1)
        )
        .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
        .onAppear {
            syncPickers()
        }
    }

    private func syncPickers() {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        if let d = dateFormatter.date(from: forecastDate) {
            datePickerDate = d
        }
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"
        if let t = timeFormatter.date(from: startTime) {
            timePickerDate = t
        }
    }

    private var forecastDateRange: ClosedRange<Date> {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return today...(calendar.date(byAdding: .day, value: 7, to: today) ?? today)
    }
}

#Preview {
    PlannerView()
        .environment(AppState())
}
