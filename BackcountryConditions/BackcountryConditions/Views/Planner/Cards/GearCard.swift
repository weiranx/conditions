import SwiftUI

struct GearCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Gear Suggestions", systemImage: "backpack.fill", headerColor: .indigo, initiallyExpanded: false) {
            VStack(alignment: .leading, spacing: 8) {
                if let gear = data.gear, !gear.isEmpty {
                    let grouped = Dictionary(grouping: gear, by: \.category)
                    let sortedKeys = grouped.keys.sorted { a, b in
                        let severity: (String) -> Int = { tone in
                            switch tone {
                            case "critical": return 0
                            case "warning": return 1
                            case "info": return 2
                            default: return 3
                            }
                        }
                        let aSev = (grouped[a] ?? []).map { severity($0.tone) }.min() ?? 3
                        let bSev = (grouped[b] ?? []).map { severity($0.tone) }.min() ?? 3
                        return aSev < bSev
                    }
                    ForEach(sortedKeys, id: \.self) { category in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(category)
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)

                            ForEach(Array((grouped[category] ?? []).enumerated()), id: \.offset) { _, item in
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: toneIcon(item.tone))
                                        .foregroundStyle(toneColor(item.tone))
                                        .font(.caption)
                                        .frame(width: 16)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title)
                                            .font(.subheadline)
                                            .fixedSize(horizontal: false, vertical: true)
                                        if let detail = item.detail {
                                            Text(detail)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.bottom, 4)
                    }
                } else {
                    Text("No specific gear suggestions")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func toneIcon(_ tone: String) -> String {
        switch tone {
        case "critical": return "exclamationmark.triangle.fill"
        case "warning": return "exclamationmark.circle.fill"
        case "info": return "info.circle"
        default: return "checkmark.circle"
        }
    }

    private func toneColor(_ tone: String) -> Color {
        switch tone {
        case "critical": return .red
        case "warning": return .orange
        case "info": return .blue
        default: return .green
        }
    }
}
