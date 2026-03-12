import SwiftUI

struct RainfallCard: View {
    let data: SafetyData
    let preferences: UserPreferences

    var body: some View {
        CollapsibleSection(title: "Rainfall", systemImage: "cloud.rain.fill", headerColor: .blue, initiallyExpanded: false) {
            VStack(alignment: .leading, spacing: 10) {
                if let rainfall = data.rainfall {

                // Expected precipitation in travel window
                if let expected = rainfall.expected {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Travel Window Forecast")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        HStack(spacing: 16) {
                            if let rain = expected.rainWindowIn, rain > 0 {
                                VStack {
                                    Text(formatRainAmount(inches: rain, millimeters: nil, unit: preferences.elevationUnit))
                                        .font(.subheadline.bold())
                                    Text("Rain")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if let snow = expected.snowWindowIn, snow > 0 {
                                VStack {
                                    Text(formatSnowDepth(snow, unit: preferences.elevationUnit))
                                        .font(.subheadline.bold())
                                    Text("Snow")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }

                        if let note = expected.note {
                            Text(note)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // Past totals
                if let totals = rainfall.totals {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Recent Precipitation")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)

                        HStack(spacing: 16) {
                            rainfallTotal("12h", inches: totals.rainPast12hIn ?? totals.past12hIn)
                            rainfallTotal("24h", inches: totals.rainPast24hIn ?? totals.past24hIn)
                            rainfallTotal("48h", inches: totals.rainPast48hIn ?? totals.past48hIn)
                        }
                    }
                }

                if let note = rainfall.note {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                } else {
                    Text("Rainfall data not available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func rainfallTotal(_ label: String, inches: Double?) -> some View {
        VStack {
            Text(formatRainAmount(inches: inches, millimeters: nil, unit: preferences.elevationUnit))
                .font(.subheadline.bold())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
