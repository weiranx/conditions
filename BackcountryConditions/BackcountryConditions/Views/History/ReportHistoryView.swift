import SwiftUI

struct ReportHistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var historyVM = ReportHistoryViewModel()
    @State private var showDeleteAllConfirmation = false

    var body: some View {
        NavigationStack {
            Group {
                if historyVM.isLoading {
                    ProgressView("Loading reports...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if historyVM.reports.isEmpty {
                    emptyState
                } else {
                    reportList
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if !historyVM.reports.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Clear All", role: .destructive) {
                            showDeleteAllConfirmation = true
                        }
                        .font(.subheadline)
                    }
                }
            }
            .confirmationDialog("Delete all saved reports?", isPresented: $showDeleteAllConfirmation, titleVisibility: .visible) {
                Button("Delete All", role: .destructive) {
                    Task { await historyVM.deleteAll() }
                }
            } message: {
                Text("This will permanently remove all offline reports. This cannot be undone.")
            }
            .task {
                await historyVM.loadReports()
            }
        }
    }

    // MARK: - Report List

    private var reportList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(historyVM.reports) { report in
                    NavigationLink(value: report.id) {
                        reportRow(report)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .navigationDestination(for: String.self) { reportId in
            if let report = historyVM.reports.first(where: { $0.id == reportId }) {
                SavedReportDetailView(report: report)
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
                    .foregroundStyle(.primary)
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
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
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

                Image(systemName: "clock.arrow.circlepath")
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
                Text("No saved reports")
                    .font(.title3.weight(.semibold))

                Text("Reports are automatically saved when you\nload conditions in the Planner")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        return "Saved " + formatter.localizedString(for: date, relativeTo: Date())
    }
}

#Preview {
    ReportHistoryView()
        .environment(AppState())
}
