import Foundation
import Observation

@Observable
final class ReportHistoryViewModel {
    var reports: [SavedReport] = []
    var isLoading = false

    @MainActor
    func loadReports() async {
        isLoading = true
        do {
            reports = try await ReportStore.shared.loadAll()
        } catch {
            reports = []
        }
        isLoading = false
    }

    @MainActor
    func deleteReport(_ report: SavedReport) async {
        do {
            try await ReportStore.shared.delete(id: report.id)
            reports.removeAll { $0.id == report.id }
        } catch {
            // silently fail
        }
    }

    @MainActor
    func deleteAll() async {
        do {
            try await ReportStore.shared.deleteAll()
            reports = []
        } catch {
            // silently fail
        }
    }
}
