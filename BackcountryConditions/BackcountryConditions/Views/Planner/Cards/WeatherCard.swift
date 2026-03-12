import SwiftUI
import Charts

struct WeatherCard: View {
    let data: SafetyData
    let preferences: UserPreferences

    @State private var selectedHourIndex: Int = 0

    private var trend: [WeatherTrendPoint] {
        data.weather.trend ?? []
    }

    private var clampedIndex: Int {
        guard !trend.isEmpty else { return 0 }
        return min(selectedHourIndex, trend.count - 1)
    }

    private var selectedPoint: WeatherTrendPoint? {
        guard !trend.isEmpty else { return nil }
        return trend[clampedIndex]
    }

    var body: some View {
        CollapsibleSection(title: "Weather", systemImage: "cloud.sun.fill", headerColor: .blue) {
            VStack(alignment: .leading, spacing: 16) {
                sunriseSunsetBar
                currentConditions
                hourSelector
                hourlyChart
                atmosphericDetails
                elevationForecast
                temperatureContext
            }
        }
    }

    // MARK: - Sunrise / Sunset

    private var sunriseSunsetBar: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "sunrise.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(
                        LinearGradient(colors: [.orange, .yellow], startPoint: .bottom, endPoint: .top)
                    )
                Text(stripSeconds(data.solar.sunrise))
                    .font(.subheadline.weight(.medium).monospacedDigit())
            }
            .frame(maxWidth: .infinity)

            Circle()
                .fill(.quaternary)
                .frame(width: 3, height: 3)

            HStack(spacing: 6) {
                Image(systemName: "sunset.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(
                        LinearGradient(colors: [.orange, .red.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                    )
                Text(stripSeconds(data.solar.sunset))
                    .font(.subheadline.weight(.medium).monospacedDigit())
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .background(
            LinearGradient(
                colors: [.orange.opacity(0.06), .yellow.opacity(0.04)],
                startPoint: .leading,
                endPoint: .trailing
            ),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.orange.opacity(0.1), lineWidth: 0.5)
        )
    }

    // MARK: - Current Conditions

    private var currentConditions: some View {
        let point = selectedPoint
        let temp = point?.temp ?? data.weather.temp
        let wind = point?.wind ?? data.weather.windSpeed
        let gust = point?.gust ?? data.weather.windGust
        let precip = point?.precipChance ?? data.weather.precipChance
        let condition = point?.condition ?? data.weather.description
        let windDir = point?.windDirection ?? data.weather.windDirection
        let humidity = point?.humidity ?? data.weather.humidity

        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(formatTemperature(temp, unit: preferences.temperatureUnit))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())

                Text(condition)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 5) {
                Label(formatWind(wind, unit: preferences.windSpeedUnit), systemImage: "wind")
                    .font(.subheadline)

                if gust > 0 {
                    Text("Gusts \(formatWind(gust, unit: preferences.windSpeedUnit))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let dir = windDir {
                    Text(dir)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Label("\(Int(precip))%", systemImage: "drop.fill")
                    .font(.subheadline)
                    .foregroundStyle(precip > 40 ? .blue : .secondary)

                Label("\(Int(humidity))%", systemImage: "humidity.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Hour Selector

    @ViewBuilder
    private var hourSelector: some View {
        if trend.count > 1 {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Hour-by-Hour")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let point = selectedPoint {
                        Text(formattedTime(point.time))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.blue)
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(trend.enumerated()), id: \.offset) { index, point in
                            Button {
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    selectedHourIndex = index
                                }
                            } label: {
                                VStack(spacing: 3) {
                                    Text(compactTime(point.time))
                                        .font(.system(size: 10, weight: .medium))
                                    Text("\(Int(convertTempFToDisplay(point.temp, unit: preferences.temperatureUnit).rounded()))°")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Image(systemName: weatherIcon(point.condition))
                                        .font(.system(size: 11))
                                        .foregroundStyle(index == clampedIndex ? .white : .secondary)
                                }
                                .frame(width: 48, height: 60)
                                .foregroundStyle(index == clampedIndex ? .white : .primary)
                                .background(
                                    index == selectedHourIndex
                                        ? AnyShapeStyle(.blue)
                                        : AnyShapeStyle(.quaternary.opacity(0.3)),
                                    in: RoundedRectangle(cornerRadius: 10)
                                )
                            }
                        }
                    }
                }
            }
            .onChange(of: data.weather.trend?.count) { _, _ in
                selectedHourIndex = 0
            }
        }
    }

    // MARK: - Hourly Chart

    @ViewBuilder
    private var hourlyChart: some View {
        if trend.count > 1 {
            let chartWidth = max(CGFloat(trend.count) * 32, 280)

            ScrollView(.horizontal, showsIndicators: false) {
                Chart {
                    ForEach(Array(trend.enumerated()), id: \.offset) { index, point in
                        AreaMark(
                            x: .value("Hour", index),
                            y: .value("Temp", convertTempFToDisplay(point.temp, unit: preferences.temperatureUnit))
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.orange.opacity(0.15), .orange.opacity(0.02)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .interpolationMethod(.catmullRom)

                        LineMark(
                            x: .value("Hour", index),
                            y: .value("Temp", convertTempFToDisplay(point.temp, unit: preferences.temperatureUnit))
                        )
                        .foregroundStyle(.orange.gradient)
                        .interpolationMethod(.catmullRom)
                        .lineStyle(StrokeStyle(lineWidth: 2.5))

                        if index == clampedIndex {
                            PointMark(
                                x: .value("Hour", index),
                                y: .value("Temp", convertTempFToDisplay(point.temp, unit: preferences.temperatureUnit))
                            )
                            .foregroundStyle(.orange)
                            .symbolSize(50)
                            .annotation(position: .top, spacing: 4) {
                                Text("\(Int(convertTempFToDisplay(point.temp, unit: preferences.temperatureUnit).rounded()))°")
                                    .font(.system(size: 10, weight: .bold, design: .rounded))
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
                .frame(width: chartWidth, height: 120)
                .chartXAxis {
                    AxisMarks(values: .stride(by: 1)) { value in
                        if let idx = value.as(Int.self), idx >= 0, idx < trend.count {
                            AxisValueLabel {
                                Text(compactTime(trend[idx].time))
                                    .font(.system(size: 9))
                            }
                            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.3))
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text("\(Int(v))°")
                                    .font(.system(size: 9))
                            }
                        }
                    }
                }
                .drawingGroup()
            }
        }
    }

    // MARK: - Elevation Forecast

    private static let tempLapseFPerKft: Double = 3.3
    private static let windIncreasePerKft: Double = 2.0

    private var adjustedElevationBands: [(label: String, temp: Double, windSpeed: Double, delta: Double)]? {
        guard let bands = data.weather.elevationForecast, !bands.isEmpty else { return nil }
        guard let point = selectedPoint else {
            return bands.map { (label: $0.label, temp: $0.temp, windSpeed: $0.windSpeed, delta: $0.deltaFromObjectiveFt) }
        }
        // Use the selected hour's temp/wind at objective elevation, then extrapolate
        let baseTemp = point.temp
        let baseWind = point.wind
        return bands.map { band in
            let deltaKft = band.deltaFromObjectiveFt / 1000.0
            let adjTemp = baseTemp + deltaKft * Self.tempLapseFPerKft
            let adjWind = max(0, baseWind + deltaKft * Self.windIncreasePerKft)
            return (label: band.label, temp: adjTemp, windSpeed: adjWind, delta: band.deltaFromObjectiveFt)
        }
    }

    @ViewBuilder
    private var elevationForecast: some View {
        if let bands = adjustedElevationBands, !bands.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("By Elevation")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)

                VStack(spacing: 0) {
                    ForEach(Array(bands.enumerated()), id: \.offset) { index, band in
                        HStack {
                            Text(band.label)
                                .font(.caption)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Text(formatTemperature(band.temp, unit: preferences.temperatureUnit))
                                .font(.caption.monospaced())
                                .frame(width: 48)

                            Text(formatWind(band.windSpeed, unit: preferences.windSpeedUnit))
                                .font(.caption.monospaced())
                                .frame(width: 56)

                            Text(formatElevationDelta(band.delta, unit: preferences.elevationUnit))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .frame(width: 64, alignment: .trailing)
                        }
                        .padding(.vertical, 5)
                        .padding(.horizontal, 10)
                        .contentTransition(.numericText())

                        if index < bands.count - 1 {
                            Divider().padding(.horizontal, 10)
                        }
                    }
                }
                .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    // MARK: - Atmospheric Details

    @ViewBuilder
    private var atmosphericDetails: some View {
        let point = selectedPoint
        let pressure = point?.pressure ?? data.weather.pressure
        let dewPoint = point?.dewPoint ?? data.weather.dewPoint
        let cloudCover = point?.cloudCover ?? data.weather.cloudCover
        let feelsLike = data.weather.feelsLike

        let hasAnyDetail = pressure != nil || dewPoint != nil || cloudCover != nil || feelsLike != nil
        if hasAnyDetail {
            VStack(alignment: .leading, spacing: 6) {
                Text("Atmospheric")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)

                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 8),
                    GridItem(.flexible(), spacing: 8),
                ], spacing: 8) {
                    if let fl = feelsLike {
                        atmosphericStat(
                            icon: "thermometer.variable.and.figure",
                            label: "Feels Like",
                            value: formatTemperature(fl, unit: preferences.temperatureUnit)
                        )
                    }
                    if let dp = dewPoint {
                        atmosphericStat(
                            icon: "drop.degreesign",
                            label: "Dew Point",
                            value: formatTemperature(dp, unit: preferences.temperatureUnit)
                        )
                    }
                    if let p = pressure {
                        atmosphericStat(
                            icon: "gauge.with.dots.needle.33percent",
                            label: "Pressure",
                            value: "\(Int(p.rounded())) mb"
                        )
                    }
                    if let cc = cloudCover {
                        atmosphericStat(
                            icon: "cloud",
                            label: "Cloud Cover",
                            value: "\(Int(cc.rounded()))%"
                        )
                    }
                }
            }
        }
    }

    private func atmosphericStat(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text(value)
                    .font(.caption.weight(.medium).monospacedDigit())
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Temperature Context

    @ViewBuilder
    private var temperatureContext: some View {
        if let ctx = data.weather.temperatureContext24h {
            HStack(spacing: 16) {
                if let high = ctx.daytimeHighF {
                    Label("High \(formatTemperature(high, unit: preferences.temperatureUnit))", systemImage: "thermometer.sun.fill")
                        .font(.caption)
                }
                if let low = ctx.overnightLowF {
                    Label("Low \(formatTemperature(low, unit: preferences.temperatureUnit))", systemImage: "thermometer.snowflake")
                        .font(.caption)
                }
            }
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Helpers

    /// Strips seconds from time strings like "6:23:45 AM" → "6:23 AM"
    private func stripSeconds(_ time: String) -> String {
        time.replacingOccurrences(
            of: #"(\d{1,2}:\d{2}):\d{2}"#,
            with: "$1",
            options: .regularExpression
        )
    }

    private func formattedTime(_ time: String) -> String {
        DateFormatting.formatClockForStyle(time, style: preferences.timeStyle)
    }

    private func compactTime(_ time: String) -> String {
        let formatted = formattedTime(time)
        // Shorten for compact display in hour pills and chart axis
        return formatted
            .replacingOccurrences(of: " AM", with: "a")
            .replacingOccurrences(of: " PM", with: "p")
    }

    private func weatherIcon(_ condition: String) -> String {
        let c = condition.lowercased()
        if c.contains("thunder") || c.contains("lightning") { return "cloud.bolt.fill" }
        if c.contains("snow") || c.contains("blizzard") { return "cloud.snow.fill" }
        if c.contains("rain") || c.contains("shower") { return "cloud.rain.fill" }
        if c.contains("fog") || c.contains("mist") { return "cloud.fog.fill" }
        if c.contains("cloud") || c.contains("overcast") { return "cloud.fill" }
        if c.contains("clear") || c.contains("sunny") { return "sun.max.fill" }
        return "cloud.sun.fill"
    }
}
