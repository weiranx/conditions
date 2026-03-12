import SwiftUI

struct VisibilityRiskCard: View {
    let data: SafetyData

    private var vis: VisibilityRisk? {
        data.weather.visibilityRisk
    }

    private var level: String {
        vis?.level?.lowercased() ?? "none"
    }

    var body: some View {
        CollapsibleSection(
            title: "Visibility Risk",
            systemImage: "eye.slash",
            headerColor: headerColor
        ) {
            VStack(alignment: .leading, spacing: 12) {
                levelBanner
                summaryText
                factorsList
                activeHoursBar
            }
        }
    }

    // MARK: - Level Banner

    private var levelBanner: some View {
        HStack(spacing: 10) {
            Text(vis?.level?.capitalized ?? "Unknown")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(tintColor, in: Capsule())

            if let score = vis?.score {
                Text("Score: \(Int(score))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }

    // MARK: - Summary

    @ViewBuilder
    private var summaryText: some View {
        if let summary = vis?.summary {
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Factors

    @ViewBuilder
    private var factorsList: some View {
        if let factors = vis?.factors, !factors.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Contributing Factors")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                ForEach(factors, id: \.self) { factor in
                    HStack(alignment: .top, spacing: 8) {
                        Circle()
                            .fill(tintColor.opacity(0.7))
                            .frame(width: 5, height: 5)
                            .padding(.top, 5)
                        Text(factor)
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(10)
            .background(tintColor.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(tintColor.opacity(0.12), lineWidth: 0.5)
            )
        }
    }

    // MARK: - Active Hours

    @ViewBuilder
    private var activeHoursBar: some View {
        if let active = vis?.activeHours, let window = vis?.windowHours, window > 0 {
            HStack(spacing: 8) {
                Text("\(Int(active))h of \(Int(window))h window affected")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(.gray.opacity(0.12))
                        RoundedRectangle(cornerRadius: 3)
                            .fill(tintColor.opacity(0.6))
                            .frame(width: geo.size.width * min(1, max(0, active / window)))
                    }
                }
                .frame(width: 60, height: 5)
            }
        }
    }

    // MARK: - Helpers

    private var headerColor: Color {
        switch level {
        case "extreme": return .dangerRed
        case "high": return .warningOrange
        case "moderate": return .cautionAmber
        default: return .gray
        }
    }

    private var tintColor: Color {
        switch level {
        case "extreme": return .red
        case "high": return .orange
        case "moderate": return .yellow
        default: return .secondary
        }
    }
}
