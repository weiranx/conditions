import Foundation

actor ReportStore {
    static let shared = ReportStore()

    private let directory: URL
    private let maxReports = 50

    private init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        directory = docs.appendingPathComponent("saved-reports", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: - Save

    func save(_ report: SavedReport) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(report)
        let filename = sanitizeFilename(report.id) + ".json"
        let url = directory.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)

        // Prune old reports
        try pruneIfNeeded()
    }

    // MARK: - Load All

    func loadAll() throws -> [SavedReport] {
        let files = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: .skipsHiddenFiles
        )

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        var reports: [SavedReport] = []
        for file in files where file.pathExtension == "json" {
            if let data = try? Data(contentsOf: file),
               let report = try? decoder.decode(SavedReport.self, from: data) {
                reports.append(report)
            }
        }

        return reports.sorted { $0.savedAt > $1.savedAt }
    }

    // MARK: - Load Single

    func load(id: String) throws -> SavedReport? {
        let filename = sanitizeFilename(id) + ".json"
        let url = directory.appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(SavedReport.self, from: data)
    }

    // MARK: - Update AI Brief

    func updateAiBrief(id: String, narrative: String) throws {
        guard var report = try load(id: id) else { return }
        report.aiBrief = narrative
        try save(report)
    }

    // MARK: - Update Route Analysis

    func updateRouteAnalysis(id: String, result: RouteAnalysisResult) throws {
        guard var report = try load(id: id) else { return }
        report.routeAnalysis = result
        try save(report)
    }

    // MARK: - Delete

    func delete(id: String) throws {
        let filename = sanitizeFilename(id) + ".json"
        let url = directory.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    func deleteAll() throws {
        let files = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: .skipsHiddenFiles
        )
        for file in files {
            try FileManager.default.removeItem(at: file)
        }
    }

    // MARK: - Helpers

    private func pruneIfNeeded() throws {
        let reports = try loadAll()
        if reports.count > maxReports {
            let toDelete = reports.suffix(from: maxReports)
            for report in toDelete {
                try delete(id: report.id)
            }
        }
    }

    private func sanitizeFilename(_ id: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        return String(id.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
    }
}
