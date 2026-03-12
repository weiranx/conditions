import SwiftUI

struct TerrainCard: View {
    let data: SafetyData
    let preferences: UserPreferences

    var body: some View {
        CollapsibleSection(title: "Terrain", systemImage: "figure.hiking", headerColor: .brown) {
            if let terrain = data.terrainCondition {
                VStack(alignment: .leading, spacing: 10) {
                    // Label + impact badge
                    HStack {
                        Text(terrain.label ?? "Unknown")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        if let impact = terrain.impact {
                            Text(impact.capitalized)
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(impactColor(impact).opacity(0.15), in: Capsule())
                                .foregroundStyle(impactColor(impact))
                        }
                    }

                    // Summary
                    if let summary = terrain.summary {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Gear recommendations inline
                    gearChips(terrain)

                    // Snow profile — only if it adds info
                    snowNote(terrain)

                    // Reasons as compact list
                    reasonsList(terrain)
                }
            } else {
                Text("Terrain data not available")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func gearChips(_ terrain: TerrainCondition) -> some View {
        let items: [(String, String)] = [
            (terrain.footwear, "shoe.fill"),
            (terrain.recommendedTravel, "figure.walk"),
        ].compactMap { item in
            guard let text = item.0 else { return nil }
            return (text, item.1)
        }

        if !items.isEmpty {
            HStack(spacing: 8) {
                ForEach(items, id: \.0) { text, icon in
                    Label(text, systemImage: icon)
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.quaternary.opacity(0.2), in: Capsule())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func snowNote(_ terrain: TerrainCondition) -> some View {
        if let snow = terrain.snowProfile,
           let summary = snow.summary, summary != terrain.summary {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "snowflake")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                    .padding(.top, 1)
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func reasonsList(_ terrain: TerrainCondition) -> some View {
        let unique = dedupedReasons(terrain)
        if !unique.isEmpty {
            Text(unique.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func dedupedReasons(_ terrain: TerrainCondition) -> [String] {
        guard let reasons = terrain.reasons, !reasons.isEmpty else { return [] }
        let summaryText = terrain.summary ?? ""
        let snowSummary = terrain.snowProfile?.summary ?? ""
        return reasons.filter { reason in
            reason != summaryText && reason != snowSummary &&
            !summaryText.hasPrefix(reason)
        }
    }

    private func impactColor(_ impact: String) -> Color {
        switch impact.lowercased() {
        case "low": return .safeGreen
        case "moderate": return .warningOrange
        case "high": return .dangerRed
        default: return .gray
        }
    }
}
