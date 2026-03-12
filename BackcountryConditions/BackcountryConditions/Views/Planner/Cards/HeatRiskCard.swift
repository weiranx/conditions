import SwiftUI

struct HeatRiskCard: View {
    let data: SafetyData
    let preferences: UserPreferences

    var body: some View {
        CollapsibleSection(title: "Heat Risk", systemImage: "thermometer.sun.fill", headerColor: riskColor) {
            VStack(alignment: .leading, spacing: 10) {
                if let heat = data.heatRisk {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            if let label = heat.label {
                                Text(label)
                                    .font(.title3.weight(.bold))
                            }
                            if let level = heat.level {
                                levelIndicator(level: level, max: 5, color: riskColor)
                            }
                        }
                        Spacer()
                        if let level = heat.level {
                            Text("\(level)/5")
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .foregroundStyle(riskColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(riskColor.opacity(0.1), in: Capsule())
                        }
                    }

                    if let guidance = heat.guidance {
                        Text(guidance)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    // Metrics
                    if let metrics = heat.metrics {
                        HStack(spacing: 0) {
                            if let temp = metrics.tempF {
                                metricCell(value: formatTemperature(temp, unit: preferences.temperatureUnit), label: "Temp")
                            }
                            if let feels = metrics.feelsLikeF {
                                if metrics.tempF != nil {
                                    Divider().frame(height: 30)
                                }
                                metricCell(value: formatTemperature(feels, unit: preferences.temperatureUnit), label: "Feels Like")
                            }
                            if let humidity = metrics.humidity {
                                Divider().frame(height: 30)
                                metricCell(value: "\(Int(humidity))%", label: "Humidity")
                            }
                        }
                        .padding(.vertical, 8)
                        .background(.quaternary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                    }

                    if let reasons = heat.reasons, !reasons.isEmpty {
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
                    Text("Heat risk data not available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func metricCell(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.subheadline.weight(.bold))
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
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
        switch data.heatRisk?.level ?? 0 {
        case 1: return .green
        case 2: return Color(red: 0.78, green: 0.58, blue: 0.05)
        case 3: return .orange
        case 4...5: return .red
        default: return .gray
        }
    }
}
