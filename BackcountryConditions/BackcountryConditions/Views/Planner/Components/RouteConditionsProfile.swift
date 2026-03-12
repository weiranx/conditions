import SwiftUI
import Charts

/// Elevation profile chart showing waypoint conditions along a route.
/// Dots are colored by safety score; high-risk waypoints get a red halo.
struct RouteConditionsProfile: View {
    let waypoints: [RouteWaypoint]
    let summaries: [RouteSummary]
    let preferences: UserPreferences

    private var entries: [ProfileEntry] {
        waypoints.enumerated().map { index, wp in
            let summary = summaries.count > index ? summaries[index] : nil
            return ProfileEntry(
                index: index,
                name: wp.name ?? "WP\(index + 1)",
                elevFt: wp.elev_ft ?? 0,
                score: summary?.score,
                temp: summary?.weather?.temp,
                windSpeed: summary?.weather?.windSpeed,
                precipChance: summary?.weather?.precipChance,
                avyRisk: summary?.avalanche?.risk,
                description: summary?.weather?.description
            )
        }
    }

    var body: some View {
        if entries.count < 2 { return AnyView(EmptyView()) }

        let elevs = entries.map(\.elevFt)
        let minElev = Double(Int(elevs.min()! / 500) * 500)
        let maxElev = Double(Int((elevs.max()! / 500).rounded(.up)) * 500 + 500)

        return AnyView(
            VStack(alignment: .leading, spacing: 8) {
                Text("Route Profile")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                Chart {
                    ForEach(entries, id: \.index) { entry in
                        AreaMark(
                            x: .value("WP", entry.index),
                            y: .value("Elev", entry.elevFt)
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.gray.opacity(0.2), .gray.opacity(0.03)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .interpolationMethod(.catmullRom)

                        LineMark(
                            x: .value("WP", entry.index),
                            y: .value("Elev", entry.elevFt)
                        )
                        .foregroundStyle(.gray.opacity(0.6))
                        .interpolationMethod(.catmullRom)
                        .lineStyle(StrokeStyle(lineWidth: 2))

                        PointMark(
                            x: .value("WP", entry.index),
                            y: .value("Elev", entry.elevFt)
                        )
                        .foregroundStyle(dotColor(entry.score))
                        .symbolSize(entry.isHighRisk ? 60 : 36)
                        .annotation(position: .top, spacing: 4) {
                            VStack(spacing: 1) {
                                if let score = entry.score {
                                    Text("\(Int(score))")
                                        .font(.system(size: 8, weight: .bold, design: .rounded))
                                        .foregroundStyle(Color.scoreColor(score))
                                }
                                Text(entry.name)
                                    .font(.system(size: 7))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: 1)) { value in
                        if let idx = value.as(Int.self), idx >= 0, idx < entries.count {
                            AxisValueLabel {
                                Text(entries[idx].name)
                                    .font(.system(size: 8))
                                    .rotationEffect(.degrees(-25))
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text("\(String(format: "%.1f", v / 1000))k")
                                    .font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartYScale(domain: minElev...maxElev)
                .frame(height: 180)
                .drawingGroup()
            }
        )
    }

    private func dotColor(_ score: Double?) -> Color {
        guard let score else { return .gray }
        return Color.scoreColor(score)
    }

    private struct ProfileEntry {
        var index: Int
        var name: String
        var elevFt: Double
        var score: Double?
        var temp: Double?
        var windSpeed: Double?
        var precipChance: Double?
        var avyRisk: String?
        var description: String?

        var isHighRisk: Bool { score != nil && score! < 40 }
    }
}
