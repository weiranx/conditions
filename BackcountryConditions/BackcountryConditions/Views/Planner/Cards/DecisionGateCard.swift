import SwiftUI

struct DecisionGateCard: View {
    let decision: SummitDecision
    var onScrollToCard: ((PlannerCardType) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Decision banner
            HStack(spacing: 12) {
                Image(systemName: decisionIcon)
                    .font(.system(size: 30, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)

                VStack(alignment: .leading, spacing: 3) {
                    Text(decision.level.rawValue.uppercased())
                        .font(.title3.weight(.heavy))
                        .tracking(1.5)
                    Text(decision.headline)
                        .font(.caption)
                        .opacity(0.9)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: decisionGradient,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .shadow(color: decisionColor.opacity(0.35), radius: 12, y: 6)

            // Blockers
            if !decision.blockers.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Blockers", systemImage: "xmark.octagon.fill")
                        .font(.subheadline.bold())
                        .foregroundStyle(.red)
                    ForEach(decision.blockers, id: \.self) { blocker in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.red)
                                .font(.system(size: 14))
                                .padding(.top, 1)
                            Text(blocker)
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.red.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.red.opacity(0.1), lineWidth: 0.5)
                )
            }

            // Cautions
            if !decision.cautions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Cautions", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.bold())
                        .foregroundStyle(.orange)
                    ForEach(decision.cautions, id: \.self) { caution in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                                .font(.system(size: 12))
                                .padding(.top, 2)
                            Text(caution)
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.orange.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.orange.opacity(0.1), lineWidth: 0.5)
                )
            }

            // Checklist
            VStack(alignment: .leading, spacing: 10) {
                Text("Checklist")
                    .font(.subheadline.bold())
                    .padding(.horizontal, 4)

                VStack(spacing: 0) {
                    ForEach(Array(decision.checks.enumerated()), id: \.offset) { index, check in
                        let targetCard = PlannerCardType.cardForCheckKey(check.key ?? "")
                        checkRow(check: check, targetCard: targetCard)
                            .padding(.vertical, 9)
                            .padding(.horizontal, 12)

                        if index < decision.checks.count - 1 {
                            Divider()
                                .padding(.leading, 40)
                        }
                    }
                }
                .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(.quaternary.opacity(0.4), lineWidth: 0.5)
        )
        .compositingGroup()
        .shadow(color: .black.opacity(0.04), radius: 6, y: 2)
    }

    @ViewBuilder
    private func checkRow(check: SummitDecision.Check, targetCard: PlannerCardType?) -> some View {
        let content = HStack(spacing: 10) {
            Image(systemName: check.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(check.ok ? .green : .red)
                .font(.system(size: 17))

            Text(check.label)
                .font(.subheadline)
                .foregroundStyle(.primary)

            Spacer()

            if let detail = check.detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if targetCard != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.quaternary)
            }
        }

        if let target = targetCard {
            Button { onScrollToCard?(target) } label: { content }
        } else {
            content
        }
    }

    private var decisionColor: Color {
        switch decision.level {
        case .go: return .green
        case .caution: return .orange
        case .noGo: return .red
        }
    }

    private var decisionGradient: [Color] {
        switch decision.level {
        case .go: return [Color(red: 0.18, green: 0.72, blue: 0.35), Color(red: 0.1, green: 0.55, blue: 0.25)]
        case .caution: return [Color(red: 0.92, green: 0.62, blue: 0.12), Color(red: 0.85, green: 0.45, blue: 0.1)]
        case .noGo: return [Color(red: 0.88, green: 0.22, blue: 0.22), Color(red: 0.7, green: 0.12, blue: 0.15)]
        }
    }

    private var decisionIcon: String {
        switch decision.level {
        case .go: return "checkmark.shield.fill"
        case .caution: return "exclamationmark.shield.fill"
        case .noGo: return "xmark.shield.fill"
        }
    }
}
