import SwiftUI

struct AirQualityCard: View {
    let data: SafetyData

    var body: some View {
        CollapsibleSection(title: "Air Quality", systemImage: "aqi.medium", headerColor: aqiColor) {
            VStack(alignment: .leading, spacing: 10) {
                if let aq = data.airQuality {
                    HStack {
                        if let aqi = aq.usAqi {
                            VStack(spacing: 2) {
                                Text("\(aqi)")
                                    .font(.system(size: 36, weight: .bold, design: .rounded))
                                    .foregroundStyle(aqiColor)
                                Text("US AQI")
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 5) {
                            if let category = aq.category {
                                Text(category)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(aqiColor)
                            }
                            if let pm25 = aq.pm25 {
                                Label("PM2.5: \(String(format: "%.1f", pm25))", systemImage: "aqi.low")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if let ozone = aq.ozone {
                                Label("Ozone: \(String(format: "%.1f", ozone))", systemImage: "wind")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    // AQI scale bar
                    if let aqi = aq.usAqi {
                        aqiScaleBar(value: aqi)
                    }

                    if let note = aq.note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Air quality data not available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func aqiScaleBar(value: Int) -> some View {
        VStack(spacing: 4) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Scale gradient
                    LinearGradient(
                        colors: [.green, .yellow, .orange, .red, .purple],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(height: 6)
                    .clipShape(Capsule())

                    // Position indicator — clamp to keep circle within bar
                    let radius: CGFloat = 5
                    let position = min(1.0, max(0.0, Double(value) / 500.0))
                    let clampedX = max(radius, min(geo.size.width - radius, geo.size.width * position))
                    Circle()
                        .fill(.white)
                        .frame(width: 10, height: 10)
                        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                        .offset(x: clampedX - radius)
                }
            }
            .frame(height: 10)

            HStack {
                Text("Good")
                    .font(.system(size: 8))
                    .foregroundStyle(.tertiary)
                Spacer()
                Text("Hazardous")
                    .font(.system(size: 8))
                    .foregroundStyle(.tertiary)
            }
        }
        .drawingGroup()
    }

    private var aqiColor: Color {
        guard let aqi = data.airQuality?.usAqi else { return .gray }
        if aqi <= 50 { return .green }
        if aqi <= 100 { return .yellow }
        if aqi <= 150 { return .orange }
        if aqi <= 200 { return .red }
        return .purple
    }
}
