import SwiftUI

struct AvalancheCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Avalanche", systemImage: "snow", headerColor: dangerColor) {
            VStack(alignment: .leading, spacing: 12) {
                if data.avalanche.relevant == false {
                    // Relevance check — not relevant
                    HStack {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(.green)
                        Text(data.avalanche.relevanceReason ?? "Avalanche terrain not relevant for this objective")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } else {
                // Coverage status
                if let status = data.avalanche.coverageStatus, status != "reported" {
                    HStack {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.orange)
                        Text(coverageMessage(status))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                // Danger level
                HStack {
                    DangerLevelBadge(level: data.avalanche.dangerLevel, label: data.avalanche.risk)
                    Spacer()
                    if let center = data.avalanche.center {
                        Text(center)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Bottom line — most important field, shown first
                if let bottomLine = data.avalanche.bottomLine {
                    Text(bottomLine.strippingHTML)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }

                // Elevation bands
                if let elevations = data.avalanche.elevations {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("By Elevation")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        elevationRow("Above Treeline", band: elevations.above)
                        elevationRow("Near Treeline", band: elevations.at)
                        elevationRow("Below Treeline", band: elevations.below)
                    }
                }

                // Problems
                if let problems = data.avalanche.problems, !problems.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Problems")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        ForEach(Array(problems.enumerated()), id: \.offset) { _, problem in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(problem.name ?? "Unknown Problem")
                                        .font(.subheadline.bold())

                                    Spacer()

                                    if let likelihood = problem.likelihood {
                                        Text(likelihood)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }

                                if let size = problem.size {
                                    Text("Size: \(size.displayString)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if let text = problem.discussion ?? problem.problem_description {
                                    Text(text.strippingHTML)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(nil)
                                }

                                // Affected terrain for this problem
                                problemTerrainView(problem)
                            }
                            .padding(8)
                            .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                // Stale warning
                if let staleWarning = data.avalanche.staleWarning {
                    HStack {
                        Image(systemName: "clock.badge.exclamationmark")
                            .foregroundStyle(.orange)
                        Text("Forecast is \(staleWarning) old — may be outdated")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }

                // Link
                if let link = data.avalanche.link, let url = URL(string: link) {
                    Link(destination: url) {
                        Label("View Full Forecast", systemImage: "arrow.up.right.square")
                            .font(.subheadline)
                    }
                }
                } // end else (relevant)
            }
        }
    }

    @ViewBuilder
    private func problemTerrainView(_ problem: AvalancheProblem) -> some View {
        let parsed = AspectElevationRose.parseFromProblems([problem])
        if !parsed.aspects.isEmpty || !parsed.elevations.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Affected Terrain")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                HStack(spacing: 8) {
                    AspectElevationRose(aspects: parsed.aspects, elevations: parsed.elevations)
                        .frame(width: 120, height: 120)
                    VStack(alignment: .leading, spacing: 4) {
                        if !parsed.aspects.isEmpty {
                            Text("Aspects")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                            HStack(spacing: 3) {
                                ForEach(Array(parsed.aspects).sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { aspect in
                                    Text(aspect.rawValue)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.orange.opacity(0.15), in: Capsule())
                                }
                            }
                        }
                        if !parsed.elevations.isEmpty {
                            Text("Elevations")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                            HStack(spacing: 3) {
                                ForEach(Array(parsed.elevations).sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { elev in
                                    Text(elev.abbreviation)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.orange.opacity(0.15), in: Capsule())
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func elevationRow(_ label: String, band: AvalancheElevationBand?) -> some View {
        if let band {
            HStack {
                Text(label)
                    .font(.caption)
                    .frame(width: 120, alignment: .leading)
                DangerLevelBadge(level: band.level ?? 0, label: band.label)
            }
        }
    }

    private var dangerColor: Color {
        switch data.avalanche.dangerLevel {
        case 0: return .gray
        case 1: return .green
        case 2: return .yellow
        case 3: return .orange
        case 4...5: return .red
        default: return .gray
        }
    }

    private func coverageMessage(_ status: String) -> String {
        switch status {
        case "no_center_coverage": return "No avalanche center covers this area"
        case "temporarily_unavailable": return "Avalanche forecast temporarily unavailable"
        case "no_active_forecast": return "No active avalanche forecast"
        case "expired_for_selected_start": return "Forecast expired for selected date"
        default: return status
        }
    }
}
