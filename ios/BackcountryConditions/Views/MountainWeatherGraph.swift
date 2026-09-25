import SwiftUI

/// A meteogram of the objective's forecast, one column per planned hour: sky, temperature against
/// freezing, rain or snow chance against your limit, cloud cover, and wind with gusts. Values are the
/// forecast at the objective (`weather.trend`); the orange marks are the backend's hour-by-hour checks.
struct MountainWeatherGraph: View {
    var points: [ForecastPoint]
    var hours: [Hour]
    var limits: Limits
    var elevationFt: Double?
    @Binding var selected: String?

    private let freezingF = 32.0
    private let tempHeight: CGFloat = 104
    private let precipHeight: CGFloat = 34

    var body: some View {
        Card(spacing: 10) {
            CardHead(title: "Mountain weather") {
                if let elevationFt { Text("At \(Format.feet(elevationFt))").font(.footnote.weight(.medium)) }
            }
            graph
            Caption(caption)
        }
    }

    // MARK: Layout

    private var graph: some View {
        VStack(alignment: .leading, spacing: 0) {
            row { point in
                let symbol = symbol(point)
                Image(systemName: symbol.name)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(symbol.primary, symbol.secondary)
                    .font(.system(size: 15))
                    .frame(height: 24)
            }
            HStack(alignment: .firstTextBaseline) {
                rowTitle("Temperature, \(Units.current.tempSymbol)")
                Spacer()
                if showsFreezing { freezingKey }
            }
            temperature.frame(height: tempHeight)
            rowTitle("Rain or snow chance, %")
            precipitation.frame(height: precipHeight + 14)
            rowTitle("Cloud cover")
            row { point in
                RoundedRectangle(cornerRadius: 2)
                    .fill(Palette.secondary.opacity(0.08 + 0.72 * (point.cloudCover ?? 0) / 100))
                    .overlay { if point.cloudCover == nil { RoundedRectangle(cornerRadius: 2).strokeBorder(Palette.missing, style: StrokeStyle(lineWidth: 1, dash: [2, 2])) } }
                    .frame(height: 10)
                    .padding(.horizontal, 1)
            }
            rowTitle("Wind and gusts, \(Units.current.windSymbol)")
            row { point in wind(point) }
            row { point in
                let hour = hour(point)
                Text(showsLabel(point, every: labelStride) ? point.shortLabel : " ")
                    .font(.caption2.weight(hour?.isOver == true || isSelected(point) ? .bold : .regular))
                    .foregroundStyle(hour?.isOver == true ? Palette.caution : isSelected(point) ? Palette.label : Palette.secondary)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(height: 18)
            }
            .padding(.top, 4)
        }
        .background { columns }
        .overlay {
            GeometryReader { proxy in
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        let index = Int(location.x / max(1, proxy.size.width) * CGFloat(points.count))
                        select(min(max(index, 0), points.count - 1))
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Mountain weather by hour")
        .accessibilityValue(selectedPoint.map(describe) ?? "")
        .accessibilityHint("Swipe up or down to move between hours.")
        .accessibilityAdjustableAction { direction in
            let index = selectedIndex ?? 0
            switch direction {
            case .increment: select(min(index + 1, points.count - 1))
            case .decrement: select(max(index - 1, 0))
            @unknown default: break
            }
        }
    }

    /// One equal-width column per hour, so every row lines up with the temperature curve above it.
    private func row<Content: View>(@ViewBuilder _ content: @escaping (ForecastPoint) -> Content) -> some View {
        HStack(spacing: 0) {
            ForEach(points) { point in content(point).frame(maxWidth: .infinity) }
        }
    }

    private func rowTitle(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Palette.secondary)
            .padding(.top, 8)
            .padding(.bottom, 3)
    }

    /// Night hours are shaded behind every row, and the selected hour is picked out across them.
    private var columns: some View {
        GeometryReader { proxy in
            let width = proxy.size.width / CGFloat(max(points.count, 1))
            ZStack(alignment: .topLeading) {
                ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                    if point.isDaytime == false {
                        Rectangle().fill(Palette.fill.opacity(0.7))
                            .frame(width: width, height: proxy.size.height)
                            .offset(x: CGFloat(index) * width)
                    }
                }
                if let index = selectedIndex {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Palette.accent.opacity(0.14))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.accent.opacity(0.45), lineWidth: 1))
                        .frame(width: width, height: proxy.size.height)
                        .offset(x: CGFloat(index) * width)
                }
            }
        }
    }

    // MARK: Temperature

    private var temperature: some View {
        GeometryReader { proxy in
            let width = proxy.size.width, height = proxy.size.height
            let step = width / CGFloat(max(points.count, 1))
            let temps = points.compactMap(\.temp)
            let domain = tempDomain(temps)
            let y: (Double) -> CGFloat = { 18 + (1 - CGFloat(($0 - domain.lo) / (domain.hi - domain.lo))) * (height - 26) }
            let x: (Int) -> CGFloat = { (CGFloat($0) + 0.5) * step }
            let freezingY = y(freezingF)
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    if showsFreezing {
                        var line = Path()
                        line.move(to: CGPoint(x: 0, y: freezingY)); line.addLine(to: CGPoint(x: size.width, y: freezingY))
                        context.stroke(line, with: .color(Palette.cold.opacity(0.8)), style: StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
                    }
                    // Segments break over hours with no temperature rather than bridging them.
                    var curve = Path(), fill = Path()
                    var run: [CGPoint] = []
                    func flush() {
                        guard let first = run.first, let last = run.last else { return }
                        curve.move(to: first)
                        for point in run.dropFirst() { curve.addLine(to: point) }
                        fill.move(to: CGPoint(x: first.x, y: size.height))
                        for point in run { fill.addLine(to: point) }
                        fill.addLine(to: CGPoint(x: last.x, y: size.height))
                        fill.closeSubpath()
                        run = []
                    }
                    for (index, point) in points.enumerated() {
                        if let temp = point.temp { run.append(CGPoint(x: x(index), y: y(temp))) } else { flush() }
                    }
                    flush()
                    context.fill(fill, with: .linearGradient(Gradient(colors: [Palette.secondary.opacity(0.14), Palette.secondary.opacity(0.02)]),
                                                             startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))
                    // Above freezing in the label colour, at or below it in cold blue.
                    let stroke = StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round)
                    var warm = context, cold = context
                    warm.clip(to: Path(CGRect(x: 0, y: 0, width: size.width, height: freezingY)))
                    cold.clip(to: Path(CGRect(x: 0, y: freezingY, width: size.width, height: size.height - freezingY)))
                    warm.stroke(curve, with: .color(Palette.label), style: stroke)
                    cold.stroke(curve, with: .color(Palette.cold), style: stroke)
                    for (index, point) in points.enumerated() {
                        guard let temp = point.temp else { continue }
                        let center = CGPoint(x: x(index), y: y(temp))
                        let radius: CGFloat = isSelected(point) ? 4.5 : 3
                        let dot = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
                        context.fill(dot, with: .color(Palette.surface))
                        context.stroke(dot, with: .color(temp <= freezingF ? Palette.cold : Palette.label), lineWidth: 2)
                    }
                }
                ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                    if let temp = point.temp, showsLabel(point, every: tempStride) {
                        Text(Format.tempNumber(temp))
                            .font(.system(size: 11, weight: isSelected(point) ? .bold : .semibold))
                            .foregroundStyle(temp <= freezingF ? Palette.cold : Palette.label)
                            .fixedSize()
                            .position(x: x(index), y: y(temp) - 11)
                    }
                }
            }
        }
    }

    private var showsFreezing: Bool {
        let domain = tempDomain(points.compactMap(\.temp))
        return freezingF > domain.lo && freezingF < domain.hi
    }

    private var freezingKey: some View {
        HStack(spacing: 4) {
            Path { path in path.move(to: CGPoint(x: 0, y: 1)); path.addLine(to: CGPoint(x: 14, y: 1)) }
                .stroke(Palette.cold, style: StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
                .frame(width: 14, height: 2)
            Text("Freezing")
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(Palette.cold)
    }

    /// The temperatures' range, reaching to freezing when it's close, and never flatter than 8 °F.
    private func tempDomain(_ temps: [Double]) -> (lo: Double, hi: Double) {
        guard var lo = temps.min(), var hi = temps.max() else { return (freezingF - 10, freezingF + 10) }
        if freezingF > lo - 10 && freezingF < hi + 10 { lo = min(lo, freezingF - 2); hi = max(hi, freezingF + 2) }
        if hi - lo < 8 { let mid = (hi + lo) / 2; lo = mid - 4; hi = mid + 4 }
        return (lo, hi)
    }

    // MARK: Precipitation

    private var precipitation: some View {
        GeometryReader { proxy in
            let limitY = 14 + (1 - CGFloat(limits.maxPrecipChance) / 100) * precipHeight
            ZStack(alignment: .topLeading) {
                // The limit line goes under the bars, and each value knocks it out, as the metric chart does.
                Path { path in
                    path.move(to: CGPoint(x: 0, y: limitY)); path.addLine(to: CGPoint(x: proxy.size.width, y: limitY))
                }
                .stroke(Palette.label.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                row { point in
                    let chance = point.precipChance
                    let over = hour(point)?.failedRules.contains { $0.lowercased().hasPrefix("precip") } ?? false
                    VStack(spacing: 1) {
                        Spacer(minLength: 0)
                        if let chance, chance >= 1 {
                            Text("\(Int(chance.rounded()))")
                                .font(.system(size: 9, weight: over ? .bold : .medium))
                                .foregroundStyle(over ? Palette.caution : Palette.secondary)
                                .padding(.horizontal, 2)
                                .background(Palette.surface, in: Capsule())
                                .fixedSize()
                        }
                        RoundedRectangle(cornerRadius: 2)
                            .fill(over ? Palette.caution : Palette.cold.opacity(0.75))
                            .frame(height: chance.map { max(1.5, CGFloat($0) / 100 * precipHeight) } ?? 0)
                            .padding(.horizontal, 4)
                    }
                }
            }
        }
    }

    // MARK: Wind

    private func wind(_ point: ForecastPoint) -> some View {
        let gustOver = hour(point).map { !$0.approachAdjusted && $0.failedRules.contains { $0.lowercased().hasPrefix("gust") } } ?? false
        return VStack(spacing: 2) {
            if let degrees = point.windFromDegrees {
                // The arrow points where the wind blows to.
                Image(systemName: "arrow.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.label)
                    .rotationEffect(.degrees(degrees))
                    .frame(height: 14)
            } else {
                Text("·").font(.caption2).foregroundStyle(Palette.secondary).frame(height: 14)
            }
            Text(Format.windNumber(point.wind))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.label)
            Text(Format.windNumber(point.gust))
                .font(.system(size: 11, weight: gustOver ? .bold : .regular))
                .foregroundStyle(gustOver ? Palette.caution : Palette.secondary)
        }
        .lineLimit(1)
        .fixedSize()
    }

    // MARK: Hours

    private var selectedIndex: Int? {
        let label = selected ?? hours.first?.shortLabel ?? points.first?.shortLabel
        return points.firstIndex { $0.shortLabel == label }
    }

    private var selectedPoint: ForecastPoint? { selectedIndex.map { points[$0] } }

    private func isSelected(_ point: ForecastPoint) -> Bool { point.id == selectedPoint?.id }

    private func select(_ index: Int) {
        guard points.indices.contains(index) else { return }
        selected = points[index].shortLabel
    }

    /// The planned hour the backend checked at the same time.
    private func hour(_ point: ForecastPoint) -> Hour? { hours.first { $0.minutes == point.minutes } }

    private var labelStride: Int { points.count > 7 ? 2 : 1 }
    private var tempStride: Int { points.count > 10 ? 2 : 1 }

    /// Every `stride`-th hour is labelled, counting from the selected hour so it's always one of them.
    private func showsLabel(_ point: ForecastPoint, every stride: Int) -> Bool {
        guard let index = points.firstIndex(of: point) else { return false }
        return index % stride == (selectedIndex ?? 0) % stride
    }

    private var caption: String {
        var parts = ["Shaded columns are night.", "The dashed line is your \(limits.maxPrecipChance)% rain limit."]
        if hours.contains(where: \.isOver) { parts.append("Orange hours cross one of your limits.") }
        if hours.contains(where: \.approachAdjusted) { parts.append("Hours on the approach are checked lower down; tap one to read it.") }
        return parts.joined(separator: " ")
    }

    private func describe(_ point: ForecastPoint) -> String {
        var parts = [point.shortLabel, point.condition ?? "No sky forecast", Format.temp(point.temp),
                     "rain or snow chance \(Format.percent(point.precipChance))",
                     "cloud cover \(Format.percent(point.cloudCover))",
                     "wind \(Format.mph(point.wind))\(point.windDirection.map { " from \($0)" } ?? ""), gusts \(Format.mph(point.gust))"]
        if hour(point)?.isOver == true { parts.append("over a limit") }
        return parts.joined(separator: ", ")
    }

    /// The sky symbol for an hour, as the web's `weatherAppearance`: precipitation over cloud cover.
    private func symbol(_ point: ForecastPoint) -> (name: String, primary: Color, secondary: Color) {
        let text = (point.condition ?? "").lowercased()
        let night = point.isDaytime == false
        let sun = Color(hex: 0xE9A21B)
        if text.contains(/thunder|storm|lightning/) { return ("cloud.bolt.rain.fill", Palette.secondary, Palette.caution) }
        if text.contains(/snow|sleet|ice|freezing/) { return ("cloud.snow.fill", Palette.secondary, Palette.cold) }
        if text.contains(/rain|shower|drizzle/) { return ("cloud.rain.fill", Palette.secondary, Palette.cold) }
        if text.contains(/fog|mist|haze|smoke/) { return ("cloud.fog.fill", Palette.secondary, Palette.secondary.opacity(0.6)) }
        if text.contains(/partly|mostly sunny|mostly clear/) {
            return night ? ("cloud.moon.fill", Palette.secondary, Palette.secondary.opacity(0.7)) : ("cloud.sun.fill", Palette.secondary, sun)
        }
        if text.contains(/cloud|overcast/) { return ("cloud.fill", Palette.secondary, Palette.secondary) }
        if text.contains(/sun|clear|fair/) {
            return night ? ("moon.stars.fill", Palette.secondary, Palette.secondary.opacity(0.7)) : ("sun.max.fill", sun, sun)
        }
        return ("cloud.fill", Palette.secondary.opacity(0.5), Palette.secondary.opacity(0.5))
    }
}
