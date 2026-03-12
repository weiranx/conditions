import SwiftUI

struct SourceFreshnessCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Source Freshness", systemImage: "clock.arrow.circlepath", initiallyExpanded: false) {
            VStack(alignment: .leading, spacing: 0) {
                freshnessRow("Weather", timestamp: data.weather.issuedTime ?? data.weather.generatedTime, source: data.weather.sourceDetails?.primary)
                Divider().padding(.horizontal, 10)
                freshnessRow("Avalanche", timestamp: data.avalanche.publishedTime ?? data.avalanche.generatedTime, source: data.avalanche.center)
                Divider().padding(.horizontal, 10)
                freshnessRow("Alerts", timestamp: data.alerts?.generatedTime, source: nil)
                Divider().padding(.horizontal, 10)
                freshnessRow("Air Quality", timestamp: data.airQuality?.measuredTime ?? data.airQuality?.generatedTime, source: data.airQuality?.source)
                Divider().padding(.horizontal, 10)
                freshnessRow("Snowpack", timestamp: data.snowpack?.generatedTime, source: nil)

                if let genAt = data.generatedAt {
                    Divider().padding(.horizontal, 10)
                    HStack {
                        HStack(spacing: 6) {
                            Image(systemName: "server.rack")
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                                .frame(width: 20)
                            Text("Report Generated")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(DateFormatting.formatAgeFromNow(genAt))
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 7)
                    .padding(.horizontal, 10)
                }
            }
            .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private func freshnessRow(_ label: String, timestamp: String?, source: String?) -> some View {
        HStack {
            HStack(spacing: 6) {
                Circle()
                    .fill(freshnessColor(timestamp: timestamp))
                    .frame(width: 6, height: 6)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.caption.weight(.medium))
                    if let source, !source.isEmpty {
                        Text(source)
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer()

            if let ts = timestamp {
                let age = DateFormatting.formatCompactAge(ts)
                HStack(spacing: 4) {
                    Text(freshnessLabel(timestamp: ts))
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(freshnessColor(timestamp: ts))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(freshnessColor(timestamp: ts).opacity(0.1), in: Capsule())
                    Text(age ?? "Unknown")
                        .font(.caption.monospaced())
                        .foregroundStyle(freshnessColor(timestamp: ts))
                }
            } else {
                Text("N/A")
                    .font(.caption)
                    .foregroundStyle(.quaternary)
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 10)
    }

    private func freshnessLabel(timestamp: String?) -> String {
        guard let timestamp, let date = DateFormatting.parseIsoToDate(timestamp) else { return "Unknown" }
        let ageHours = Date().timeIntervalSince(date) / 3600
        if ageHours <= 1 { return "Fresh" }
        if ageHours <= 4 { return "OK" }
        if ageHours <= 12 { return "Aging" }
        return "Stale"
    }

    private func freshnessColor(timestamp: String?) -> Color {
        guard let timestamp, let date = DateFormatting.parseIsoToDate(timestamp) else { return .gray }
        let ageHours = Date().timeIntervalSince(date) / 3600
        if ageHours <= 1 { return .green }
        if ageHours <= 4 { return .primary }
        if ageHours <= 12 { return .orange }
        return .red
    }
}
