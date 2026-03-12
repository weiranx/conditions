import SwiftUI

struct TravelWindowCard: View {
    let data: SafetyData
    let preferences: UserPreferences

    private var rows: [TravelWindowRow] {
        guard let trend = data.weather.trend, !trend.isEmpty else { return [] }
        return TravelWindowEngine.buildRows(trend: trend, preferences: preferences)
    }

    private var insights: TravelWindowInsights? {
        let r = rows
        guard !r.isEmpty else { return nil }
        return TravelWindowEngine.buildInsights(rows: r)
    }

    var body: some View {
        CollapsibleSection(title: "Travel Window", systemImage: "clock.arrow.2.circlepath") {
            VStack(alignment: .leading, spacing: 12) {
                if let insights, !rows.isEmpty {
                    summaryBanner(insights)
                    statsRow(insights)
                    topIssues(insights)
                    hourTable
                } else {
                    Text("Hourly forecast data not available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Summary Banner

    private func summaryBanner(_ insights: TravelWindowInsights) -> some View {
        HStack(spacing: 8) {
            Image(systemName: summaryIcon)
                .font(.system(size: 16))
                .foregroundStyle(summaryColor)
            Text(insights.summary)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(summaryColor.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(summaryColor.opacity(0.15), lineWidth: 0.5)
        )
    }

    // MARK: - Stats Row

    private func statsRow(_ insights: TravelWindowInsights) -> some View {
        HStack(spacing: 0) {
            statCell(value: "\(insights.passHours)", label: "Pass", color: .green)
                .frame(width: 70)
            Divider().frame(height: 30)
            statCell(value: "\(insights.failHours)", label: "Fail", color: .red)
                .frame(width: 70)
            Divider().frame(height: 30)
            VStack(spacing: 2) {
                Text(insights.trendLabel)
                    .font(.caption.weight(.semibold))
                Text(insights.trendSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 8)
        }
        .padding(.vertical, 6)
        .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private func statCell(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(0.5)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Top Issues

    @ViewBuilder
    private func topIssues(_ insights: TravelWindowInsights) -> some View {
        if !insights.topFailureLabels.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Top Issues")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(insights.topFailureLabels, id: \.self) { label in
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(.orange)
                        Text(label)
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
    }

    // MARK: - Hour Table

    private var hourTable: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Time")
                    .frame(width: 54, alignment: .leading)
                Text("Feels")
                    .frame(width: 40)
                Text("Gust")
                    .frame(width: 40)
                Text("Precip")
                    .frame(width: 38)
                Spacer()
                Text("Go")
                    .frame(width: 24)
            }
            .font(.caption2.weight(.bold))
            .foregroundStyle(.tertiary)
            .padding(.vertical, 6)
            .padding(.horizontal, 10)

            Divider().padding(.horizontal, 10)

            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                hourRow(row)
                if index < rows.count - 1 {
                    Divider().padding(.horizontal, 10)
                }
            }
        }
        .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private func hourRow(_ row: TravelWindowRow) -> some View {
        HStack {
            Text(DateFormatting.formatClockForStyle(row.time, style: preferences.timeStyle))
                .font(.caption.monospaced())
                .frame(width: 54, alignment: .leading)

            Text(formatTemperature(row.feelsLike, unit: preferences.temperatureUnit, includeUnit: false))
                .font(.caption.monospaced())
                .foregroundStyle(row.feelsLike < 20 ? .blue : .primary)
                .frame(width: 40)

            Text(formatWind(row.gust, unit: preferences.windSpeedUnit, includeUnit: false))
                .font(.caption.monospaced())
                .foregroundStyle(row.gust > preferences.maxWindGustMph ? .red : .primary)
                .frame(width: 40)

            Text("\(Int(row.precipChance))%")
                .font(.caption.monospaced())
                .foregroundStyle(row.precipChance > 50 ? .blue : .primary)
                .frame(width: 38)

            Spacer()

            Image(systemName: row.pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(row.pass ? .green : .red)
                .font(.system(size: 13))
                .frame(width: 24)
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 10)
        .background(row.pass ? Color.clear : Color.red.opacity(0.03))
    }

    // MARK: - Helpers

    private var summaryIcon: String {
        guard let insights else { return "clock" }
        if insights.passHours == 0 { return "xmark.circle.fill" }
        if insights.failHours == 0 { return "checkmark.circle.fill" }
        return "exclamationmark.circle.fill"
    }

    private var summaryColor: Color {
        guard let insights else { return .secondary }
        if insights.passHours == 0 { return .red }
        if insights.failHours == 0 { return .green }
        return .orange
    }
}
