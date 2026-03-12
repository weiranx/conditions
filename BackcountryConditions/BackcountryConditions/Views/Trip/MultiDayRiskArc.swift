import SwiftUI
import Charts

/// Area chart showing daily safety scores with decision-level colored dots and precipitation bars.
struct MultiDayRiskArc: View {
    let dayResults: [TripPlannerView.DayResult]

    var body: some View {
        let chartData = dayResults.compactMap { day -> ChartEntry? in
            guard let data = day.data, let decision = day.decision else { return nil }
            return ChartEntry(
                label: day.displayDate,
                score: data.safety.score,
                precipChance: data.weather.precipChance,
                decisionLevel: decision.level
            )
        }

        if chartData.isEmpty { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 8) {
                Text("Trip Risk Overview")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                Chart {
                    ForEach(Array(chartData.enumerated()), id: \.offset) { index, entry in
                        // Precipitation bars (background)
                        BarMark(
                            x: .value("Day", index),
                            y: .value("Precip", entry.precipChance)
                        )
                        .foregroundStyle(.gray.opacity(0.2))

                        // Safety score area
                        AreaMark(
                            x: .value("Day", index),
                            y: .value("Score", entry.score)
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.scoreColor(entry.score).opacity(0.3), Color.scoreColor(entry.score).opacity(0.05)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .interpolationMethod(.catmullRom)

                        LineMark(
                            x: .value("Day", index),
                            y: .value("Score", entry.score)
                        )
                        .foregroundStyle(Color.scoreColor(entry.score))
                        .interpolationMethod(.catmullRom)
                        .lineStyle(StrokeStyle(lineWidth: 2.5))

                        PointMark(
                            x: .value("Day", index),
                            y: .value("Score", entry.score)
                        )
                        .foregroundStyle(decisionDotColor(entry.decisionLevel))
                        .symbolSize(40)
                        .annotation(position: .top, spacing: 4) {
                            Text("\(Int(entry.score))")
                                .font(.system(size: 9, weight: .bold, design: .rounded))
                                .foregroundStyle(Color.scoreColor(entry.score))
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: 1)) { value in
                        if let idx = value.as(Int.self), idx >= 0, idx < chartData.count {
                            AxisValueLabel {
                                Text(chartData[idx].label)
                                    .font(.system(size: 9))
                            }
                            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.3))
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { value in
                        AxisValueLabel {
                            if let v = value.as(Int.self) {
                                Text("\(v)")
                                    .font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartYScale(domain: 0...100)
                .frame(height: 180)
                .drawingGroup()
            }
        )
    }

    private func decisionDotColor(_ level: DecisionLevel) -> Color {
        switch level {
        case .go: return .safeGreen
        case .caution: return .cautionAmber
        case .noGo: return .dangerRed
        }
    }

    private struct ChartEntry {
        var label: String
        var score: Double
        var precipChance: Double
        var decisionLevel: DecisionLevel
    }
}
