import SwiftUI
import UIKit

struct SnowpackCard: View {
    let data: SafetyData
    let preferences: UserPreferences
    @State private var vision: SnowVisionResponse?
    @State private var visionError: String?
    @State private var isAnalyzing = false

    private let visionService = SnowVisionService()

    var body: some View {
        CollapsibleSection(title: "Snowpack", systemImage: "snowflake", headerColor: .cyan) {
            if let snowpack = data.snowpack {
                VStack(alignment: .leading, spacing: 10) {
                    if let summary = snowpack.summary {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    stationReadings(snowpack)
                    historicalNote(snowpack)
                    satelliteAnalysis
                }
            } else {
                Text("Snowpack data not available")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var satelliteAnalysis: some View {
        Divider()
        if let vision {
            VStack(alignment: .leading, spacing: 8) {
                Label("Satellite Snow Analysis", systemImage: "satellite")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.cyan)
                if let image = decodedImage(vision.image) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Satellite image used for snow analysis")
                }
                ForEach(MarkdownStrip.paragraphs(vision.analysis), id: \.self) { paragraph in
                    Text(paragraph)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button("Analyze Again") { Task { await analyzeSnow() } }
                    .font(.caption)
            }
        } else if let visionError {
            VStack(alignment: .leading, spacing: 6) {
                Label(visionError, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                Button("Retry Satellite Analysis") { Task { await analyzeSnow() } }
                    .font(.caption)
            }
        } else {
            Button {
                Task { await analyzeSnow() }
            } label: {
                if isAnalyzing {
                    HStack { ProgressView().controlSize(.small); Text("Analyzing satellite view…") }
                } else {
                    Label("Analyze Snow from Satellite", systemImage: "satellite")
                }
            }
            .buttonStyle(.bordered)
            .tint(.cyan)
            .controlSize(.small)
            .disabled(isAnalyzing)
        }
    }

    @MainActor
    private func analyzeSnow() async {
        guard !isAnalyzing else { return }
        isAnalyzing = true
        visionError = nil
        defer { isAnalyzing = false }
        do {
            vision = try await visionService.analyze(data: data, preferences: preferences)
        } catch {
            visionError = error.localizedDescription
        }
    }

    private func decodedImage(_ value: String?) -> UIImage? {
        guard let value, let comma = value.firstIndex(of: ","),
              let bytes = Data(base64Encoded: String(value[value.index(after: comma)...])) else { return nil }
        return UIImage(data: bytes)
    }

    // MARK: - Station Readings (merged table)

    @ViewBuilder
    private func stationReadings(_ snowpack: Snowpack) -> some View {
        let rows = buildStationRows(snowpack)
        if !rows.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(row.source)
                                .font(.caption.weight(.semibold))
                            Spacer()
                            if let depth = row.depth {
                                Text("Depth: \(depth)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            if let swe = row.swe {
                                Text("SWE: \(swe)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if let detail = row.detail {
                            Text(detail)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)

                    if index < rows.count - 1 {
                        Divider().padding(.horizontal, 10)
                    }
                }
            }
            .background(.quaternary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: - Historical

    @ViewBuilder
    private func historicalNote(_ snowpack: Snowpack) -> some View {
        if let hist = snowpack.historical, let overall = hist.overall {
            HStack(spacing: 6) {
                if let pct = overall.percentOfAverage {
                    Text("\(Int(pct))% of avg")
                        .font(.caption.weight(.semibold))
                }
                if let status = overall.status {
                    Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(historicalColor(status))
                }
                if let summary = hist.summary {
                    Text("· \(summary)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    // MARK: - Helpers

    private struct StationRow {
        let source: String
        let detail: String?
        let depth: String?
        let swe: String?
    }

    private func buildStationRows(_ snowpack: Snowpack) -> [StationRow] {
        var rows: [StationRow] = []

        if let s = snowpack.snotel, s.status != "unavailable" {
            let detail: String? = {
                var parts: [String] = []
                if let name = s.stationName { parts.append(name) }
                if let dist = s.distanceKm {
                    parts.append(formatDistance(dist, elevationUnit: preferences.elevationUnit))
                }
                return parts.isEmpty ? nil : parts.joined(separator: " · ")
            }()
            rows.append(StationRow(
                source: "SNOTEL",
                detail: detail,
                depth: s.snowDepthIn.map { formatSnowDepth($0, unit: preferences.elevationUnit) },
                swe: s.sweIn.map { formatSwe($0, unit: preferences.elevationUnit) }
            ))
        }

        if let n = snowpack.nohrsc, n.status != "unavailable" {
            rows.append(StationRow(
                source: "NOHRSC",
                detail: "Modeled",
                depth: n.snowDepthIn.map { formatSnowDepth($0, unit: preferences.elevationUnit) },
                swe: n.sweIn.map { formatSwe($0, unit: preferences.elevationUnit) }
            ))
        }

        if let c = snowpack.cdec, c.status != "unavailable" {
            rows.append(StationRow(
                source: "CDEC",
                detail: c.stationName,
                depth: c.snowDepthIn.map { formatSnowDepth($0, unit: preferences.elevationUnit) },
                swe: c.sweIn.map { formatSwe($0, unit: preferences.elevationUnit) }
            ))
        }

        return rows
    }

    private func historicalColor(_ status: String) -> Color {
        switch status {
        case "below_average": return .warningOrange
        case "above_average": return .blue
        case "at_average": return .safeGreen
        default: return .secondary
        }
    }
}
