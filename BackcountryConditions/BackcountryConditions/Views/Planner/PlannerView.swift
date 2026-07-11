import SwiftUI

struct PlannerView: View {
    @Environment(AppState.self) private var appState
    @State private var plannerVM = PlannerViewModel()
    @State private var searchVM = SearchViewModel()
    @State private var isSearchActive = false
    @State private var recentReports: [SavedReport] = []
    @State private var locationService = LocationService()
    @State private var locationError: String?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 16) {
                        if !plannerVM.hasReport {
                            searchBar
                        }
                        savedObjectivesSection
                        recentSearches
                        recentReportsSection
                        controls
                        mapView
                        status
                        cards(proxy: proxy)
                        emptyState
                    }
                    .padding(.vertical, 8)
                }
                .background(Color(.systemGroupedBackground))
            }
            .navigationTitle("Planner")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if let data = plannerVM.safetyData, let decision = plannerVM.decision {
                    ToolbarItem(placement: .topBarTrailing) {
                        ShareLink(item: shareSummary(data: data, decision: decision)) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel("Share report")
                    }
                }
                if plannerVM.hasObjective {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(plannerVM.hasReport ? "New Objective" : "Clear") {
                            plannerVM.clear()
                            isSearchActive = true
                        }
                    }
                }
            }
            .task {
                recentReports = (try? await ReportStore.shared.loadAll()) ?? []
            }
            .onChange(of: plannerVM.currentReportId) { _, _ in
                Task {
                    recentReports = (try? await ReportStore.shared.loadAll()) ?? []
                }
            }
            .refreshable {
                if plannerVM.hasObjective {
                    await plannerVM.loadReport(preferences: appState.preferences)
                }
            }
            .onChange(of: locationService.currentLocation?.latitude) { _, _ in
                guard let coordinate = locationService.currentLocation else { return }
                selectCoordinate(name: "Current Location", lat: coordinate.latitude, lon: coordinate.longitude)
            }
            .onChange(of: locationService.locationError?.localizedDescription) { _, message in
                locationError = message
            }
        }
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
        .padding(.horizontal)
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
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
            .padding(.horizontal)
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
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
            .padding(.horizontal)
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
                    objectiveName: plannerVM.objectiveName,
                    isLocked: plannerVM.hasReport,
                    onReload: {
                        Task {
                            await plannerVM.loadReport(preferences: appState.preferences)
                        }
                    },
                    trailingContent: { bookmarkButton }
                )
            }
            .padding(.horizontal)

            if !plannerVM.hasReport && !plannerVM.isLoading {
                Button {
                    Task { await plannerVM.loadReport(preferences: appState.preferences) }
                } label: {
                    Label("Get Conditions", systemImage: "checkmark.shield.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal)
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
            .padding(.horizontal)
        } else if !isSearchActive {
            MapCard(
                lat: Configuration.defaultCenter.lat,
                lon: Configuration.defaultCenter.lon,
                objectiveName: "Drop a pin",
                onTapLocation: { lat, lon in selectCoordinate(name: "Dropped Pin", lat: lat, lon: lon) }
            )
            .padding(.horizontal)
        }
    }

    private func selectCoordinate(name: String, lat: Double, lon: Double) {
        let result = SearchResult(name: name, lat: lat, lon: lon, resultClass: "coordinate", type: "location")
        plannerVM.setObjective(result: result)
        searchVM.addToRecent(result)
        isSearchActive = false
        Haptics.selection()
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
                    await plannerVM.loadReport(preferences: appState.preferences)
                }
            }
            .padding(.horizontal)
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
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private func cards(proxy: ScrollViewProxy) -> some View {
        if let data = plannerVM.safetyData, let decision = plannerVM.decision {
            let prefs = appState.preferences
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
            .padding(.horizontal)
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
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !plannerVM.hasObjective && !plannerVM.isLoading && searchVM.recentSearches.isEmpty {
            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [.blue.opacity(0.08), .blue.opacity(0.02)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 100, height: 100)

                    Image(systemName: "mountain.2.fill")
                        .font(.system(size: 42, weight: .medium))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue.opacity(0.5), .blue.opacity(0.2)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                }

                VStack(spacing: 8) {
                    Text("Plan your adventure")
                        .font(.title3.weight(.semibold))

                    Text("Search for a peak, trailhead, or coordinates\nto check backcountry conditions")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(2)
                }
            }
            .padding(.top, 48)
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
                    .foregroundStyle(
                        LinearGradient(colors: [.blue, .blue.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                    )
                Text(objectiveName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                trailingContent()
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Date")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    DatePicker("", selection: $datePickerDate, in: forecastDateRange, displayedComponents: .date)
                        .labelsHidden()
                        .disabled(isLocked)
                        .onChange(of: datePickerDate) { _, newValue in
                            forecastDate = DateFormatting.formatDateInput(newValue)
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Start Time")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    DatePicker("", selection: $timePickerDate, displayedComponents: .hourAndMinute)
                        .labelsHidden()
                        .disabled(isLocked)
                        .onChange(of: timePickerDate) { _, newValue in
                            let formatter = DateFormatter()
                            formatter.dateFormat = "HH:mm"
                            startTime = formatter.string(from: newValue)
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
                                LinearGradient(colors: [.blue, .blue.opacity(0.8)], startPoint: .top, endPoint: .bottom),
                                in: Circle()
                            )
                            .shadow(color: .blue.opacity(0.25), radius: 4, y: 2)
                    }
                    .accessibilityLabel("Refresh report")
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
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
