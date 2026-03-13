import SwiftUI

struct SafetyScoreCard: View {
    let data: SafetyData
    var aiBrief: String?
    var isLoadingBrief: Bool = false
    var onRequestBrief: (() -> Void)?

    var body: some View {
        CollapsibleSection(title: "Safety Score", systemImage: "shield.checkered", headerColor: scoreColor) {
            VStack(spacing: 16) {
                scoreHeader
                factorBreakdown
                explanationsList
                aiBriefSection
            }
        }
    }

    // MARK: - Score Header

    private var scoreHeader: some View {
        HStack(alignment: .center, spacing: 20) {
            ScoreGauge(score: data.safety.score, size: 110)

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Primary Hazard")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text(data.safety.primaryHazard)
                        .font(.headline)
                        .foregroundStyle(.primary)
                }

                if let confidence = data.safety.confidence {
                    HStack(spacing: 8) {
                        ConfidenceBar(value: confidence / 100)
                            .frame(width: 56, height: 5)
                        Text("\(Int(confidence))%")
                            .font(.caption.weight(.medium).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Factor Breakdown

    @ViewBuilder
    private var factorBreakdown: some View {
        if let factors = data.safety.factors, !factors.isEmpty {
            // Deduplicate by hazard name, summing impacts
            let merged = mergeFactors(factors)
            let maxImpact = merged.compactMap(\.impact).max() ?? 20
            let scale = max(maxImpact, 10)

            VStack(alignment: .leading, spacing: 6) {
                Text("Factor Breakdown")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                VStack(spacing: 4) {
                    ForEach(Array(merged.enumerated()), id: \.offset) { _, factor in
                        factorRow(factor, scale: scale)
                    }
                }
            }
        }
    }

    private func mergeFactors(_ factors: [SafetyFactor]) -> [SafetyFactor] {
        var seen: [String: Int] = [:]
        var result: [SafetyFactor] = []
        for factor in factors.prefix(8) {
            let key = factor.hazard ?? "Unknown"
            if let idx = seen[key] {
                let existing = result[idx].impact ?? 0
                let additional = factor.impact ?? 0
                result[idx] = SafetyFactor(hazard: key, impact: existing + additional, message: result[idx].message ?? factor.message)
            } else {
                seen[key] = result.count
                result.append(factor)
            }
        }
        return result.sorted { ($0.impact ?? 0) > ($1.impact ?? 0) }
    }

    private func factorRow(_ factor: SafetyFactor, scale: Double) -> some View {
        let impact = factor.impact ?? 0
        let color = impactTextColor(impact)

        return VStack(spacing: 3) {
            HStack {
                Text(factor.hazard ?? "Unknown")
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                Text("-\(Int(impact.rounded()))")
                    .font(.caption2.weight(.bold).monospacedDigit())
                    .foregroundStyle(color)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(.gray.opacity(0.12))
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(color.opacity(0.8))
                        .frame(width: max(3, geo.size.width * min(1, max(0, impact / scale))))
                }
            }
            .frame(height: 4)
        }
        .padding(.vertical, 3)
    }

    // MARK: - Explanations

    @ViewBuilder
    private var explanationsList: some View {
        if !data.safety.explanations.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(data.safety.explanations, id: \.self) { explanation in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .padding(.top, 3)
                        Text(explanation)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(12)
            .background(.quaternary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: - AI Brief

    @ViewBuilder
    private var aiBriefSection: some View {
        if let brief = aiBrief {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                    Text("AI Analysis")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Text(LocalizedStringKey(MarkdownStrip.inlineOnly(brief)))
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(.blue.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.blue.opacity(0.12), lineWidth: 0.5)
            )
        } else if isLoadingBrief {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Generating AI brief...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if let onRequestBrief {
            Button(action: onRequestBrief) {
                Label("Generate AI Brief", systemImage: "sparkles")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.bordered)
            .tint(.blue)
            .controlSize(.small)
        }
    }

    // MARK: - Colors & Helpers

    private var scoreColor: Color {
        Color.scoreColor(data.safety.score)
    }

    private func impactGradient(_ impact: Double) -> LinearGradient {
        let color = impactTextColor(impact)
        return LinearGradient(
            colors: [color.opacity(0.7), color],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    private func impactTextColor(_ impact: Double) -> Color {
        if impact >= 15 { return .dangerRed }
        if impact >= 8 { return .warningOrange }
        if impact >= 3 { return .cautionAmber }
        return .secondary
    }

    private func impactLabel(_ impact: Double) -> String {
        let rounded = Int(impact.rounded())
        return "-\(rounded)"
    }
}

// MARK: - Confidence Bar

private struct ConfidenceBar: View {
    let value: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(.gray.opacity(0.2))
                RoundedRectangle(cornerRadius: 3)
                    .fill(barColor)
                    .frame(width: geo.size.width * max(0, min(1, value)))
            }
        }
    }

    private var barColor: Color {
        if value >= 0.7 { return .safeGreen }
        if value >= 0.4 { return .warningOrange }
        return .dangerRed
    }
}
