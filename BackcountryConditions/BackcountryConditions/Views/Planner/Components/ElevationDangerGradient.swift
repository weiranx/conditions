import SwiftUI

/// Vertical stack showing danger levels at each elevation band with weather metrics.
/// Highlights the band closest to the objective elevation.
struct ElevationDangerGradient: View {
    let elevationBands: [ElevationForecastBand]
    let avalancheElevations: AvalancheElevations?
    let objectiveElevationFt: Double?
    let preferences: UserPreferences

    private var sortedBands: [ElevationForecastBand] {
        elevationBands.sorted { $0.elevationFt > $1.elevationFt }
    }

    var body: some View {
        if sortedBands.isEmpty { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 6) {
                Text("Elevation Danger Profile")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                VStack(spacing: 0) {
                    ForEach(Array(sortedBands.enumerated()), id: \.offset) { index, band in
                        let avyBand = avyBandForElevation(band.elevationFt)
                        let isObjective = objectiveElevationFt != nil &&
                            abs(band.elevationFt - objectiveElevationFt!) < 250
                        let dangerLevel = avyBand?.level ?? 0

                        HStack(spacing: 0) {
                            // Elevation info
                            VStack(alignment: .leading, spacing: 1) {
                                Text(formatElevation(band.elevationFt, unit: preferences.elevationUnit))
                                    .font(.caption2.weight(.medium).monospacedDigit())
                                Text(band.label)
                                    .font(.system(size: 8))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(width: 72, alignment: .leading)

                            // Danger bar
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.dangerLevel(dangerLevel).opacity(0.7))
                                .frame(height: 22)
                                .overlay(alignment: .leading) {
                                    if dangerLevel > 0 {
                                        Text(dangerText(dangerLevel))
                                            .font(.system(size: 8, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .padding(.leading, 6)
                                    }
                                }
                                .overlay {
                                    if isObjective {
                                        RoundedRectangle(cornerRadius: 3)
                                            .strokeBorder(.white, lineWidth: 1.5)
                                    }
                                }

                            // Weather metrics
                            HStack(spacing: 6) {
                                Text(formatTemperature(band.temp, unit: preferences.temperatureUnit))
                                    .font(.caption2.monospacedDigit())
                                    .frame(width: 36)
                                Text(formatWind(band.windSpeed, unit: preferences.windSpeedUnit))
                                    .font(.caption2.monospacedDigit())
                                    .frame(width: 40)
                            }
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                        .padding(.horizontal, 8)
                        .background(isObjective ? Color.blue.opacity(0.06) : .clear)

                        if index < sortedBands.count - 1 {
                            Divider().padding(.horizontal, 8)
                        }
                    }
                }
                .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
        )
    }

    private func avyBandForElevation(_ elevFt: Double) -> AvalancheElevationBand? {
        guard let avy = avalancheElevations, let obj = objectiveElevationFt else { return nil }
        if elevFt > obj + 500 { return avy.above }
        if elevFt < obj - 500 { return avy.below }
        return avy.at
    }

    private func dangerText(_ level: Int) -> String {
        switch level {
        case 1: return "Low"
        case 2: return "Moderate"
        case 3: return "Considerable"
        case 4: return "High"
        case 5: return "Extreme"
        default: return ""
        }
    }
}
