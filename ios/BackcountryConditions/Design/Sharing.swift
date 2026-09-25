import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

/// A report's data as a JSON file, for Export report data.
nonisolated struct ReportExport: Transferable, Sendable {
    var data: Data
    var name: String

    init(data: Data, name: String) {
        self.data = data
        self.name = name
    }

    @MainActor init(report: Report, name: String) {
        self.init(data: report.json.prettyData, name: name)
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .json) { item in item.data }
            .suggestedFileName { item in
                let safe = item.name.replacingOccurrences(of: "[^A-Za-z0-9]+", with: "-", options: .regularExpression)
                return "\(safe.isEmpty ? "report" : safe)-brief.json"
            }
    }
}

extension JSON {
    /// Indented JSON data.
    var prettyData: Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(self)) ?? Data()
    }
}
