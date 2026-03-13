import SwiftUI

struct TripPlannerView: View {
    @Environment(AppState.self) private var appState
    @State private var days: Int = 3
    @State private var startDate = Date()
    @State private var objectiveName: String = ""
    @State private var lat: Double?
    @State private var lon: Double?
    @State private var dayResults: [DayResult] = []
    @State private var isLoading = false
    @State private var searchVM = SearchViewModel()
    @State private var isSearchActive = false

    private let safetyService = SafetyService()

    struct DayResult: Identifiable {
        let id = UUID()
        let date: String
        let displayDate: String
        let data: SafetyData?
        let decision: SummitDecision?
        let error: String?
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    SearchBarView(searchVM: searchVM, isSearchActive: $isSearchActive) { result in
                        objectiveName = result.name
                        lat = result.lat
                        lon = result.lon
                        searchVM.addToRecent(result)
                    }
                    .padding(.horizontal)

                    if lat != nil {
                        controlsCard
                    }

                    if isLoading {
                        loadingView
                    }

                    if !dayResults.isEmpty {
                        tripSummary
                        riskArcChart
                        dayResultsList
                    }

                    if lat == nil && !isLoading {
                        emptyState
                    }
                }
                .padding(.vertical, 8)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Trip Planner")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(for: UUID.self) { dayId in
                if let day = dayResults.first(where: { $0.id == dayId }) {
                    TripDayDetailView(dayResult: day, objectiveName: objectiveName)
                } else {
                    ContentUnavailableView("Trip data unavailable", systemImage: "exclamationmark.triangle", description: Text("This day's forecast is no longer loaded."))
                }
            }
        }
    }

    // MARK: - Controls Card

    private var controlsCard: some View {
        VStack(spacing: 14) {
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
            }

            Divider()

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Start Date")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    DatePicker("", selection: $startDate, displayedComponents: .date)
                        .labelsHidden()
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Days")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    Stepper("\(days)", value: $days, in: 1...7)
                        .frame(width: 120)
                }

                Spacer()
            }

            Button {
                Task { await loadTrip() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Plan Trip")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .foregroundStyle(.white)
                .background(
                    LinearGradient(colors: [.blue, .blue.opacity(0.8)], startPoint: .top, endPoint: .bottom),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .shadow(color: .blue.opacity(0.25), radius: 4, y: 2)
            }
            .disabled(isLoading)
            .opacity(isLoading ? 0.6 : 1)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
        .padding(.horizontal)
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Loading \(days)-day forecast...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 32)
    }

    // MARK: - Trip Summary

    private var tripSummary: some View {
        let goCount = dayResults.filter { $0.decision?.level == .go }.count
        let cautionCount = dayResults.filter { $0.decision?.level == .caution }.count
        let noGoCount = dayResults.filter { $0.decision?.level == .noGo }.count

        return HStack(spacing: 0) {
            summaryPill(label: "GO", count: goCount, colors: [Color(red: 0.18, green: 0.72, blue: 0.35), Color(red: 0.1, green: 0.55, blue: 0.25)])
            summaryPill(label: "CAUTION", count: cautionCount, colors: [Color(red: 0.92, green: 0.62, blue: 0.12), Color(red: 0.85, green: 0.45, blue: 0.1)])
            summaryPill(label: "NO-GO", count: noGoCount, colors: [Color(red: 0.88, green: 0.22, blue: 0.22), Color(red: 0.7, green: 0.12, blue: 0.15)])
        }
        .padding(4)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
        .padding(.horizontal)
    }

    private func summaryPill(label: String, count: Int, colors: [Color]) -> some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white.opacity(0.85))
                .tracking(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            LinearGradient(colors: count > 0 ? colors : [.gray.opacity(0.3), .gray.opacity(0.2)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 10)
        )
    }

    // MARK: - Risk Arc Chart

    @ViewBuilder
    private var riskArcChart: some View {
        MultiDayRiskArc(dayResults: dayResults)
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
            .padding(.horizontal)
    }

    // MARK: - Day Results

    private var dayResultsList: some View {
        VStack(spacing: 10) {
            ForEach(dayResults) { day in
                NavigationLink(value: day.id) {
                    dayCard(day)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal)
    }

    private func dayCard(_ day: DayResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.displayDate)
                        .font(.subheadline.weight(.semibold))
                    Text(day.date)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                if let decision = day.decision {
                    Text(decision.level.rawValue)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            LinearGradient(
                                colors: decisionGradient(decision.level),
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            in: Capsule()
                        )
                        .shadow(color: decisionColor(decision.level).opacity(0.3), radius: 3, y: 1)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.quaternary)
            }

            if let data = day.data {
                HStack(spacing: 0) {
                    metricCell(
                        icon: "thermometer",
                        value: formatTemperature(data.weather.temp, unit: appState.preferences.temperatureUnit),
                        color: .orange
                    )
                    Divider().frame(height: 28)
                    metricCell(
                        icon: "wind",
                        value: formatWind(data.weather.windSpeed, unit: appState.preferences.windSpeedUnit),
                        color: .blue
                    )
                    Divider().frame(height: 28)
                    metricCell(
                        icon: "drop.fill",
                        value: "\(Int(data.weather.precipChance))%",
                        color: data.weather.precipChance > 40 ? .blue : .secondary
                    )
                    Divider().frame(height: 28)
                    metricCell(
                        icon: "shield.checkered",
                        value: "\(Int(data.safety.score))",
                        color: Color.scoreColor(data.safety.score)
                    )
                }
                .padding(.vertical, 6)
                .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))

                if let decision = day.decision, !decision.headline.isEmpty {
                    Text(decision.headline)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            if let error = day.error {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
    }

    private func metricCell(icon: String, value: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(color)
            Text(value)
                .font(.caption.weight(.medium).monospacedDigit())
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Empty State

    private var emptyState: some View {
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

                Image(systemName: "calendar.badge.clock")
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
                Text("Plan a multi-day trip")
                    .font(.title3.weight(.semibold))

                Text("Search for a location to compare\nconditions across multiple days")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
        }
        .padding(.top, 48)
    }

    // MARK: - Load Trip

    @MainActor
    private func loadTrip() async {
        guard let lat, let lon else { return }
        isLoading = true
        dayResults = []

        let preferences = appState.preferences
        let defaultStart = preferences.defaultStartTime
        let startDateStr = DateFormatting.formatDateInput(startDate)

        await withTaskGroup(of: DayResult.self) { group in
            for dayOffset in 0..<days {
                let date = DateFormatting.addDays(to: startDateStr, days: dayOffset)
                group.addTask {
                    do {
                        let data = try await safetyService.loadReport(
                            lat: lat, lon: lon, date: date, startTime: defaultStart
                        )
                        let decision = DecisionEngine.evaluate(data: data, preferences: preferences)
                        return DayResult(date: date, displayDate: formatDisplayDate(date), data: data, decision: decision, error: nil)
                    } catch {
                        return DayResult(date: date, displayDate: formatDisplayDate(date), data: nil, decision: nil, error: error.localizedDescription)
                    }
                }
            }

            for await result in group {
                dayResults.append(result)
            }
        }

        dayResults.sort { $0.date < $1.date }
        isLoading = false
    }

    // MARK: - Helpers

    private nonisolated func formatDisplayDate(_ dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return dateStr }
        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "EEE, MMM d"
        return displayFormatter.string(from: date)
    }

    private func decisionColor(_ level: DecisionLevel) -> Color {
        switch level {
        case .go: return .green
        case .caution: return .orange
        case .noGo: return .red
        }
    }

    private func decisionGradient(_ level: DecisionLevel) -> [Color] {
        switch level {
        case .go: return [Color(red: 0.18, green: 0.72, blue: 0.35), Color(red: 0.1, green: 0.55, blue: 0.25)]
        case .caution: return [Color(red: 0.92, green: 0.62, blue: 0.12), Color(red: 0.85, green: 0.45, blue: 0.1)]
        case .noGo: return [Color(red: 0.88, green: 0.22, blue: 0.22), Color(red: 0.7, green: 0.12, blue: 0.15)]
        }
    }
}

#Preview {
    TripPlannerView()
        .environment(AppState())
}
