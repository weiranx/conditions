import SwiftUI

struct AlertsCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Alerts", systemImage: "exclamationmark.triangle.fill", headerColor: alertColor) {
            VStack(alignment: .leading, spacing: 10) {
                if let alerts = data.alerts?.alerts, !alerts.isEmpty {
                    ForEach(alerts) { alert in
                        AlertRow(alert: alert)
                    }
                } else {
                    HStack {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(.green)
                        Text("No active alerts")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var alertColor: Color {
        guard let severity = data.alerts?.highestSeverity?.lowercased() else { return .green }
        switch severity {
        case "extreme": return .red
        case "severe": return .red
        case "moderate": return .orange
        case "minor": return Color(red: 0.8, green: 0.55, blue: 0)
        default: return .green
        }
    }
}

struct AlertRow: View {
    let alert: NwsAlertItem
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation { isExpanded.toggle() }
            } label: {
                HStack {
                    severityBadge

                    VStack(alignment: .leading, spacing: 2) {
                        Text(alert.event ?? "Unknown Alert")
                            .font(.subheadline.bold())
                            .foregroundStyle(.primary)
                        if let headline = alert.headline {
                            Text(headline)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(isExpanded ? nil : 2)
                        }
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let description = alert.description {
                        Text(description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let instruction = alert.instruction {
                        Text(instruction)
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let link = alert.link, let url = URL(string: link) {
                        Link("View Full Alert", destination: url)
                            .font(.caption)
                    }
                }
                .padding(.leading, 30)
            }
        }
        .padding(8)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
    }

    private var severityBadge: some View {
        let severity = alert.severity?.lowercased() ?? "unknown"
        let color: Color = {
            switch severity {
            case "extreme": return .red
            case "severe": return .red
            case "moderate": return .orange
            case "minor": return Color(red: 0.8, green: 0.55, blue: 0)
            default: return .gray
            }
        }()
        let label: String = {
            switch severity {
            case "extreme": return "EXT"
            case "severe": return "SEV"
            case "moderate": return "MOD"
            case "minor": return "MIN"
            default: return "—"
            }
        }()
        return Text(label)
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(color, in: Capsule())
            .accessibilityLabel("Severity: \(alert.severity ?? "unknown")")
    }
}
