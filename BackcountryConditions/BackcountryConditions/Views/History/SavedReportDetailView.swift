import SwiftUI

struct SavedReportDetailView: View {
    @Environment(AppState.self) private var appState
    let report: SavedReport

    private var decision: SummitDecision {
        DecisionEngine.evaluate(data: report.data, preferences: appState.preferences)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                headerCard
                mapCard
                reportCards
            }
            .padding(.vertical, 8)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(report.objectiveName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                offlineBadge
            }
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(
                        LinearGradient(colors: [.blue, .blue.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(report.objectiveName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text("\(report.forecastDate) at \(report.startTime)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            HStack(spacing: 8) {
                Text(report.decisionLevel)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(decisionColor, in: Capsule())

                Text("Score: \(Int(report.safetyScore))")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.scoreColor(report.safetyScore))

                Spacer()

                Text(savedDateString)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if !report.headline.isEmpty {
                Text(report.headline)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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

    // MARK: - Map

    private var mapCard: some View {
        MapCard(
            lat: report.lat,
            lon: report.lon,
            objectiveName: report.objectiveName,
            elevationFt: report.data.weather.elevation,
            elevationUnit: appState.preferences.elevationUnit
        )
        .padding(.horizontal)
    }

    // MARK: - Report Cards

    private var reportCards: some View {
        let data = report.data
        let prefs = appState.preferences
        let visibleCards = PlannerCardType.allCases.filter { type in
            type.isVisible(for: data) && type != .routeAnalysis
        }

        return LazyVStack(spacing: 12) {
            ForEach(visibleCards) { cardType in
                PlannerCardFactory.view(
                    for: cardType,
                    data: data,
                    decision: decision,
                    preferences: prefs,
                    aiBrief: report.aiBrief,
                    isLoadingBrief: false,
                    onRequestBrief: {},
                    objectiveName: report.objectiveName,
                    forecastDate: report.forecastDate,
                    startTime: report.startTime
                )
                .id(cardType)
            }

            // Saved route analysis (offline)
            if let routeResult = report.routeAnalysis {
                savedRouteAnalysisCard(routeResult)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Offline Badge

    private var offlineBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 10))
            Text("Offline")
                .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.quaternary.opacity(0.2), in: Capsule())
    }

    // MARK: - Saved Route Analysis

    private func savedRouteAnalysisCard(_ result: RouteAnalysisResult) -> some View {
        CollapsibleSection(title: "Route Analysis", systemImage: "point.topleft.down.to.point.bottomright.curvepath.fill", headerColor: .purple, initiallyExpanded: false) {
            VStack(alignment: .leading, spacing: 12) {
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

                if let waypoints = result.waypoints, !waypoints.isEmpty {
                    let summaries = result.summaries ?? []
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Waypoints")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        VStack(spacing: 0) {
                            ForEach(Array(waypoints.enumerated()), id: \.offset) { index, wp in
                                let summary = summaries.count > index ? summaries[index] : nil
                                HStack {
                                    HStack(spacing: 6) {
                                        Text("\(index + 1)")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(.white)
                                            .frame(width: 18, height: 18)
                                            .background(Color.scoreColor(summary?.score ?? 50).opacity(0.7), in: Circle())
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
                                        Text("\(Int(elev)) ft")
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.vertical, 6)
                                .padding(.horizontal, 10)

                                if index < waypoints.count - 1 {
                                    Divider().padding(.horizontal, 10)
                                }
                            }
                        }
                        .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private var decisionColor: Color {
        switch report.decisionLevel {
        case "GO": return .green
        case "CAUTION": return .orange
        case "NO-GO": return .red
        default: return .gray
        }
    }

    private var savedDateString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Saved " + formatter.string(from: report.savedAt)
    }
}
