import SwiftUI

struct ReportHistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var historyVM = ReportHistoryViewModel()
    @State private var showDeleteAllConfirmation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WebPageHeader(
                    kicker: "Offline library",
                    title: "Generated reports",
                    subtitle: "Reopen decision briefs you have already generated, even when reception disappears.",
                    systemImage: "clock.arrow.circlepath"
                )
                if historyVM.isLoading {
                    ProgressView("Loading reports...")
                        .frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if historyVM.reports.isEmpty {
                    emptyState
                } else {
                    reportList
                }
            }
            .padding(16)
        }
        .background(Color.webBackground)
        .navigationTitle("Generated reports")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !historyVM.reports.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear All", role: .destructive) {
                        showDeleteAllConfirmation = true
                    }
                    .font(.webSans(13, weight: .semibold))
                }
            }
        }
        .confirmationDialog("Delete all generated reports?", isPresented: $showDeleteAllConfirmation, titleVisibility: .visible) {
            Button("Delete All", role: .destructive) {
                Task { await historyVM.deleteAll() }
            }
        } message: {
            Text("This will permanently remove all offline reports. This cannot be undone.")
        }
        .navigationDestination(for: String.self) { reportId in
            if let report = historyVM.reports.first(where: { $0.id == reportId }) {
                SavedReportDetailView(report: report)
            }
        }
        .task { await historyVM.loadReports() }
    }

    // MARK: - Report List

    private var reportList: some View {
        LazyVStack(spacing: 10) {
            ForEach(historyVM.reports) { report in
                NavigationLink(value: report.id) {
                    reportRow(report)
                }
            }
        }
    }

    private func reportRow(_ report: SavedReport) -> some View {
        HStack(spacing: 12) {
            // Decision badge
            ZStack {
                Circle()
                    .fill(decisionGradient(report.decisionLevel))
                    .frame(width: 42, height: 42)
                Text("\(Int(report.safetyScore))")
                    .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(report.objectiveName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.webInk)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(report.forecastDate)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(report.decisionLevel)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(decisionColor(report.decisionLevel), in: Capsule())
                }

                Text(relativeDateString(report.savedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.quaternary)
        }
        .padding(14)
        .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.webLine))
        .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task { await historyVM.deleteReport(report) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button(role: .destructive) {
                Task { await historyVM.deleteReport(report) }
            } label: {
                Label("Delete Report", systemImage: "trash")
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        WebSectionHeader(
            "No generated reports yet",
            number: "01",
            subtitle: "Generated conditions reports are added automatically after a successful Planner request."
        )
        .webCard(padding: 18)
    }

    // MARK: - Helpers

    private func decisionColor(_ level: String) -> Color {
        switch level {
        case "GO": return .green
        case "CAUTION": return .orange
        case "NO-GO": return .red
        default: return .gray
        }
    }

    private func decisionGradient(_ level: String) -> LinearGradient {
        switch level {
        case "GO":
            return LinearGradient(colors: [Color(red: 0.18, green: 0.72, blue: 0.35), Color(red: 0.1, green: 0.55, blue: 0.25)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        case "CAUTION":
            return LinearGradient(colors: [Color(red: 0.92, green: 0.62, blue: 0.12), Color(red: 0.85, green: 0.45, blue: 0.1)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        case "NO-GO":
            return LinearGradient(colors: [Color(red: 0.88, green: 0.22, blue: 0.22), Color(red: 0.7, green: 0.12, blue: 0.15)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        default:
            return LinearGradient(colors: [.gray.opacity(0.5), .gray.opacity(0.3)],
                                  startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private func relativeDateString(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return "Generated " + formatter.localizedString(for: date, relativeTo: Date())
    }
}

#Preview {
    ReportHistoryView()
        .environment(AppState())
}
