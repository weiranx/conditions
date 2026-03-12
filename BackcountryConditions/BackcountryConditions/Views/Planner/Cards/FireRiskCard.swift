import SwiftUI

struct FireRiskCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Fire Risk", systemImage: "flame.fill", headerColor: riskColor) {
            VStack(alignment: .leading, spacing: 10) {
                if let fire = data.fireRisk {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            if let label = fire.label {
                                Text(label)
                                    .font(.title3.weight(.bold))
                            }
                            if let level = fire.level {
                                levelIndicator(level: level, max: 5, color: riskColor)
                            }
                        }
                        Spacer()
                        if let level = fire.level {
                            Text("\(level)/5")
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .foregroundStyle(riskColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(riskColor.opacity(0.1), in: Capsule())
                        }
                    }

                    if let guidance = fire.guidance {
                        Text(guidance)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let reasons = fire.reasons, !reasons.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(reasons, id: \.self) { reason in
                                HStack(alignment: .top, spacing: 6) {
                                    Circle()
                                        .fill(riskColor.opacity(0.5))
                                        .frame(width: 4, height: 4)
                                        .padding(.top, 5)
                                    Text(reason)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } else {
                    Text("Fire risk data not available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func levelIndicator(level: Int, max: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            ForEach(1...max, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i <= level ? color : color.opacity(0.12))
                    .frame(width: 20, height: 4)
            }
        }
    }

    private var riskColor: Color {
        switch data.fireRisk?.level ?? 0 {
        case 1: return .green
        case 2: return Color(red: 0.78, green: 0.58, blue: 0.05)
        case 3: return .orange
        case 4...5: return .red
        default: return .gray
        }
    }
}
