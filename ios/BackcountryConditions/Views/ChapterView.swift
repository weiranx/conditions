import Charts
import SwiftUI

/// A report chapter, with glass chips to move between chapters.
struct ChapterView: View {
    var plan: Plan
    var report: Report?
    var snapshot: Bool
    @State var chapter: Chapter

    init(plan: Plan, report: Report?, snapshot: Bool, chapter: Chapter) {
        self.plan = plan
        self.report = report
        self.snapshot = snapshot
        _chapter = State(initialValue: chapter)
    }

    var body: some View {
        Page {
            PageHeader(kicker: "\(plan.objective.shortName) · \(DateText.short(plan.date))", title: chapter.rawValue, subtitle: subtitle)
            Spacer().frame(height: 16)
            ChapterChips(selection: $chapter, chapters: Chapter.ordered(for: plan.activity))
            Spacer().frame(height: 16)
            if let report {
                switch chapter {
                case .weather: WeatherChapter(plan: plan, report: report)
                case .terrain: TerrainChapter(plan: plan, report: report, snapshot: snapshot)
                case .timing: TimingChapter(plan: plan, report: report, snapshot: snapshot)
                case .route: RouteChapter(plan: plan, report: report, snapshot: snapshot)
                case .checks: ChecksChapter(plan: plan, report: report, snapshot: snapshot)
                case .gear: GearActionsSection(report: report)
                }
                pager(report)
            } else {
                Notice(tone: .missing, text: "This plan hasn’t been checked yet.")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Previous and next chapter, as the web's chapter pager.
    private func pager(_ report: Report) -> some View {
        let chapters = Chapter.ordered(for: plan.activity)
        let index = chapters.firstIndex(of: chapter) ?? 0
        return HStack {
            if index > 0 {
                Button { withAnimation(.snappy) { chapter = chapters[index - 1] } } label: {
                    Label(chapters[index - 1].rawValue, systemImage: "chevron.left")
                }
                .buttonStyle(.glass)
            }
            Spacer()
            if index + 1 < chapters.count {
                Button { withAnimation(.snappy) { chapter = chapters[index + 1] } } label: {
                    Label(chapters[index + 1].rawValue, systemImage: "chevron.right").labelStyle(TrailingIconLabelStyle())
                }
                .buttonStyle(.glass)
            }
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 16)
        .padding(.top, 28)
    }

    private var subtitle: String? {
        switch chapter {
        case .weather:
            guard let low = report?.hours.compactMap(\.elevationFt).min(), let high = report?.objectiveElevationFt else { return "Hour by hour against your limits." }
            return "Checked along your climb, \(Format.feet(low).replacingOccurrences(of: " \(Units.current.elevationSymbol)", with: ""))–\(Format.feet(high))."
        case .terrain: return report?.objectiveElevationFt.map { "Your objective is \(Format.feet($0))." }
        case .timing: return "Daylight, turnaround and other departures."
        case .checks: return "Every check behind the decision, and where the data came from."
        case .route: return plan.route.map { "Checkpoints along \($0.name)." } ?? "Check the forecast along your way up."
        case .gear: return "What the conditions call for."
        }
    }
}

// MARK: - Weather

struct WeatherChapter: View {
    var plan: Plan
    var report: Report

    enum Metric: String, CaseIterable, Identifiable {
        case wind = "Wind", cold = "Cold", rain = "Rain", temp = "Temp"
        var id: String { rawValue }
    }

    @State private var metric: Metric = .wind
    @State private var selected: String?

    private var limits: Limits { report.limits ?? plan.limits }

    var body: some View {
        let hours = report.hours
        VStack(alignment: .leading, spacing: 12) {
            Picker("Metric", selection: $metric) {
                ForEach(Metric.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)

            Card(spacing: 8) {
                CardHead(title: title) {
                    if let limitText { Text(limitText).font(.footnote.weight(.medium)) }
                }
                if hours.isEmpty {
                    Caption("No hourly forecast covers this plan.")
                } else {
                    chart(hours).frame(height: 180)
                    Caption("Tap an hour to read it.")
                }
            }
            .padding(.horizontal, 16)

            if let hour = hours.first(where: { $0.shortLabel == selectedLabel(hours) }) {
                readout(hour)
            }
            if let summary = report.windowSummary {
                Caption(summary).padding(.horizontal, 20)
            }
            Spacer().frame(height: 16)
            HourlyTableSection(report: report)
            Spacer().frame(height: 16)
            PrecipitationSection(report: report)
            Spacer().frame(height: 16)
            BeyondWeatherSection(report: report)
        }
        .onAppear { if selected == nil { selected = (hours.first(where: \.isOver) ?? hours.first)?.shortLabel } }
    }

    private func selectedLabel(_ hours: [Hour]) -> String? { selected ?? hours.first?.shortLabel }

    private var title: String {
        switch metric {
        case .wind: "Gusts, \(Units.current.windSymbol)"
        case .cold: "Feels like, \(Units.current.tempSymbol)"
        case .rain: "Rain or snow chance, %"
        case .temp: "Temperature, \(Units.current.tempSymbol)"
        }
    }

    private var limitValue: Double? {
        switch metric {
        case .wind: Units.current.wind(Double(limits.maxGustMph))
        case .cold: Units.current.temp(Double(limits.minFeelsLikeF))
        case .rain: Double(limits.maxPrecipChance)
        case .temp: nil
        }
    }

    private var limitText: String? {
        switch metric {
        case .wind: "Your limit \(Format.mph(Double(limits.maxGustMph)))"
        case .cold: "Your floor \(Format.temp(Double(limits.minFeelsLikeF)))"
        case .rain: "Your limit \(limits.maxPrecipChance)%"
        case .temp: nil
        }
    }

    private func value(_ hour: Hour) -> Double? {
        switch metric {
        case .wind: hour.gust.map(Units.current.wind)
        case .cold: hour.feelsLike.map(Units.current.temp)
        case .rain: hour.precipChance
        case .temp: hour.temp.map(Units.current.temp)
        }
    }

    private func chart(_ hours: [Hour]) -> some View {
        Chart {
            ForEach(hours) { hour in
                if let v = value(hour) {
                    BarMark(x: .value("Hour", hour.shortLabel), y: .value(metric.rawValue, v))
                        .foregroundStyle(hour.isOver && overForMetric(hour) ? Palette.caution : hour.shortLabel == selectedLabel(hours) ? Palette.accent : Palette.within)
                        .cornerRadius(4)
                        .annotation(position: .top, spacing: 2) {
                            Text("\(Int(v.rounded()))").font(.caption2.weight(hour.shortLabel == selectedLabel(hours) ? .bold : .regular))
                                .foregroundStyle(hour.shortLabel == selectedLabel(hours) ? Palette.label : Palette.secondary)
                        }
                }
            }
            if let limitValue {
                RuleMark(y: .value("Limit", limitValue))
                    .foregroundStyle(Palette.label)
                    .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
            }
        }
        .chartXSelection(value: $selected)
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel().font(.caption2)
            }
        }
    }

    /// Whether this metric is the one the backend flagged for the hour.
    private func overForMetric(_ hour: Hour) -> Bool {
        let rules = hour.failedRules.joined(separator: " ").lowercased()
        switch metric {
        case .wind: return rules.contains("gust")
        case .cold: return rules.contains("feels") && rules.contains("<")
        case .rain: return rules.contains("precip")
        case .temp: return false
        }
    }

    private func readout(_ hour: Hour) -> some View {
        Card(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(hour.shortLabel).font(.title3.weight(.semibold)).foregroundStyle(Palette.label)
                if let ft = hour.elevationFt {
                    Text("near \(Format.roundFeet(ft))").font(.subheadline).foregroundStyle(Palette.secondary)
                }
                Spacer()
                StatusTag(kind: hour.isMissing ? .missing : hour.isOver ? .over : .ok,
                          text: hour.isMissing ? "Incomplete" : hour.isOver ? "Over a limit" : "Within limits")
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    fact("Gust", Format.mph(hour.gust), over: overRule(hour, "gust"))
                    fact("Wind", Format.mph(hour.wind))
                    fact("Rain chance", Format.percent(hour.precipChance), over: overRule(hour, "precip"))
                }
                GridRow {
                    fact("Temp", Format.temp(hour.temp))
                    fact("Feels like", Format.temp(hour.feelsLike), over: overRule(hour, "feels"))
                    fact("Sky", hour.condition ?? "—")
                }
            }
            Divider().padding(.top, 4)
            Caption(hour.failedRules.isEmpty ? "Within your gust, rain and cold limits this hour." : hour.failedRules.map(Format.plainRule).joined(separator: " · ") + ".",
                    tone: hour.isOver ? Palette.caution : Palette.secondary, emphasized: hour.isOver)
        }
        .padding(.horizontal, 16)
    }

    private func overRule(_ hour: Hour, _ key: String) -> Bool {
        hour.failedRules.contains { $0.lowercased().hasPrefix(key) }
    }

    private func fact(_ label: String, _ value: String, over: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(Palette.secondary)
            Text(value).font(.body.weight(.semibold)).foregroundStyle(over ? Palette.caution : Palette.label).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Terrain & snow

struct TerrainChapter: View {
    @Environment(PlanStore.self) private var store
    var plan: Plan
    var report: Report
    var snapshot: Bool

    @State private var hourIndex = 0
    @State private var targetFt: Int = 0
    @State private var target: [ElevationBand] = []
    @State private var checking = false
    @State private var targetError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            mountain
            Spacer().frame(height: 28)
            ApproachSection(plan: plan, report: report, snapshot: snapshot)
            Spacer().frame(height: 28)
            SurfaceSection(report: report)
            Spacer().frame(height: 28)
            WindLoadingSection(report: report)
            Spacer().frame(height: 28)
            if AccountStore.shared.flags.terrainWindow { TerrainWindowSection(report: report); Spacer().frame(height: 28) }
            avalanche
            Spacer().frame(height: 28)
            snowpack
            Spacer().frame(height: 28)
            SnowObservationsSection(report: report)
            Spacer().frame(height: 28)
            SnowVisionSection(plan: plan, report: report, snapshot: snapshot)
        }
        .onAppear {
            if targetFt == 0 {
                let objective = report.objectiveElevationFt ?? 10000
                targetFt = Int(((objective - 2000) / 500).rounded() * 500)
            }
            hourIndex = min(hourIndex, max(0, report.bandsByHour.count - 1))
        }
        .task(id: targetFt) { await checkTarget() }
    }

    // The mountain in cross-section at the chosen hour.
    private var mountain: some View {
        let bandsByHour = report.bandsByHour
        let hours = report.hours
        return VStack(alignment: .leading, spacing: 0) {
            SectionHead(hourIndex == 0 ? "The mountain at your start" : "The mountain at \(hours.indices.contains(hourIndex) ? hours[hourIndex].shortLabel : "")")
            Caption("Forecast by elevation. Heights are to scale; the ridge is illustrative.").padding(.horizontal, 20).padding(.top, -6).padding(.bottom, 10)
            Card(spacing: 10) {
                if bandsByHour.isEmpty {
                    Caption("Elevation bands are unavailable for this plan.")
                } else {
                    if hours.count > 1 {
                        HourChips(hours: hours, selection: $hourIndex)
                    }
                    MountainSection(
                        bands: bandsByHour[min(hourIndex, bandsByHour.count - 1)],
                        objectiveFt: report.objectiveElevationFt,
                        freezingFt: report.freezingLevelFt,
                        snowFt: report.snowLevelFt,
                        target: target.indices.contains(hourIndex) ? target[hourIndex] : nil,
                        sky: hours.indices.contains(hourIndex)
                            ? SkyKind.at(minute: hours[hourIndex].minutes, sunrise: report.sunriseMinutes, sunset: report.sunsetMinutes, condition: hours[hourIndex].condition)
                            : .day)
                    .frame(height: 290)
                    elevationCheck
                    if let note = report.elevationNote { Divider(); Caption(note) }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var elevationCheck: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Check an elevation").font(.subheadline.weight(.semibold))
                    Text(snapshot ? "Saved snapshots can’t be re-checked." : "Re-evaluated by the server").font(.caption).foregroundStyle(Palette.secondary)
                }
                Spacer()
                Stepper(value: $targetFt, in: 1000...20000, step: 500) {
                    Text(Format.feet(Double(targetFt))).font(.body.weight(.semibold)).monospacedDigit()
                }
                .fixedSize()
                .disabled(snapshot)
            }
            if let band = target.indices.contains(hourIndex) ? target[hourIndex] : nil {
                HStack {
                    fact("Temperature", Format.temp(band.temp))
                    fact("Feels like", Format.temp(band.feelsLike))
                    fact("Wind", Format.mph(band.wind))
                    fact("Gust", Format.mph(band.gust))
                }
            } else if checking {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Caption("Checking \(Format.feet(Double(targetFt)))…") }
            } else if let targetError {
                Caption(targetError, tone: Palette.caution)
            }
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(Palette.secondary)
            Text(value).font(.body.weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func checkTarget() async {
        guard !snapshot, targetFt > 0 else { return }
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        checking = true
        defer { checking = false }
        do {
            let evaluated = try await store.evaluate(plan, targetElevationFt: targetFt)
            target = evaluated.elevationTarget?.byHour ?? []
            targetError = nil
        } catch {
            target = []
            targetError = error.localizedDescription
        }
    }

    // Avalanche danger and problems, as the backend interpreted the bulletin.
    @ViewBuilder
    private var avalanche: some View {
        SectionHead(title: "Avalanche") {
            if let center = report.avalancheCenter { Text(center).lineLimit(1) }
        }
        VStack(spacing: 12) {
            if !report.avalancheRelevant && !report.avalancheUnknown {
                Card { CardHead("Not in play"); Caption(report.avalancheCaption ?? "Avalanche terrain isn’t part of this plan.") }
            } else if report.avalancheUnknown || report.avalancheRows.isEmpty {
                Card(missing: true) {
                    CardHead(title: "Danger by elevation") { StatusTag(kind: .missing, text: "No rating") }
                    Caption(report.avalancheCaption ?? "No current avalanche rating covers this plan. Missing data doesn’t mean conditions are safe.")
                    if let link = report.avalancheLink { Link("Open the avalanche center", destination: link).font(.subheadline.weight(.semibold)) }
                }
            } else {
                Card {
                    CardHead(title: "Danger by elevation") { StatusTag(kind: (report.check("avalanche")?.ok ?? true) ? .ok : .over, text: DangerScale.name(report.avalancheLevel)) }
                    HStack(spacing: 18) {
                        DangerTriangle(ratings: report.avalancheRows.map(\.rating)).frame(width: 118, height: 108)
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(report.avalancheRows.enumerated()), id: \.offset) { _, row in
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(row.label).font(.caption).foregroundStyle(Palette.secondary)
                                    Text(row.rating.map { "\($0) · \(DangerScale.name($0))" } ?? "Not rated").font(.subheadline.weight(.semibold))
                                }
                            }
                        }
                    }
                    .padding(.top, 6)
                    if let caption = report.avalancheCaption { Caption(caption) }
                }
                ForEach(Array(report.avalancheProblems.enumerated()), id: \.offset) { index, problem in
                    Card {
                        CardHead(title: problem.name) { Text("Problem \(index + 1) of \(report.avalancheProblems.count)").font(.footnote) }
                        HStack(spacing: 18) {
                            AspectRose(aspects: Set(problem.aspects)).frame(width: 110, height: 110)
                            Caption(problem.description)
                        }
                    }
                }
            }
            if let bottomLine = report.avalancheBottomLine {
                Card { CardHead("Bottom line"); Text(bottomLine).font(.subheadline).foregroundStyle(Palette.label).lineLimit(8) }
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var snowpack: some View {
        SectionHead(title: "Snowpack") {
            if let station = report.snowStation { Text(station).lineLimit(1) }
        }
        HStack(alignment: .top, spacing: 12) {
            Card(missing: report.snowDepthIn == nil) {
                CardHead("Snow depth")
                BigValue(text: report.snowDepthIn.map { Format.inches($0) } ?? "—")
                Caption(report.sweIn.map { "Snow water equivalent \(Format.inches($0))." } ?? "No depth reading at the nearest station.")
            }
            Card {
                CardHead("Freezing level")
                BigValue(text: report.freezingLevelFt.map(Format.feet) ?? "—", small: true)
                Caption(report.snowLevelFt.map { "Snow level \(Format.feet($0))." } ?? "No snow level in the forecast.")
            }
        }
        .padding(.horizontal, 16)
        if let summary = report.snowpackSummary {
            Caption(summary).padding(.horizontal, 20).padding(.top, 10)
        }
    }
}

/// The mountain in cross-section: bands by elevation on the right, freezing and snow levels across the
/// slope, the objective on the ridge. Heights are to scale; the ridge shape is illustrative
/// (`frontend/src/field/sky/MountainSection.tsx`).
struct MountainSection: View {
    var bands: [ElevationBand]
    var objectiveFt: Double?
    var freezingFt: Double?
    var snowFt: Double?
    var target: ElevationBand?
    var sky: SkyKind

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width, height = proxy.size.height
            let side: CGFloat = 132
            let plotW = width - side
            let heights = bands.map(\.elevationFt) + [objectiveFt].compactMap { $0 }
            let top = heights.max() ?? 10000, base = heights.min() ?? 5000
            let inView: (Double?) -> Double? = { ft in ft.flatMap { $0 > base - 3000 && $0 < top + 4000 ? $0 : nil } }
            let freezingFt = inView(self.freezingFt), snowFt = inView(self.snowFt)
            let levels = [freezingFt, snowFt].compactMap { $0 }
            let lo = min(base, levels.min() ?? base) - 600
            let hi = max(top, levels.max() ?? top) + 900
            let y: (Double) -> CGFloat = { 16 + (1 - CGFloat(($0 - lo) / (hi - lo))) * (height - 32) }
            let span = top - base, peakX = plotW * 0.62
            let ridge: [CGPoint] = [
                CGPoint(x: 0, y: y(base - 200)), CGPoint(x: plotW * 0.18, y: y(base + span * 0.22)), CGPoint(x: plotW * 0.34, y: y(base + span * 0.48)),
                CGPoint(x: plotW * 0.47, y: y(base + span * 0.8)), CGPoint(x: peakX, y: y(top + 250)), CGPoint(x: peakX + (plotW - peakX) * 0.32, y: y(base + span * 0.72)),
                CGPoint(x: peakX + (plotW - peakX) * 0.63, y: y(base + span * 0.5)), CGPoint(x: plotW, y: y(base + span * 0.34)),
            ]
            let ridgeX: (Double) -> CGFloat = { ft in
                let yy = y(ft)
                for i in 1..<5 {
                    let a = ridge[i - 1], b = ridge[i]
                    if yy <= a.y && yy >= b.y { return a.x + (a.y - yy) / max(0.001, a.y - b.y) * (b.x - a.x) }
                }
                return yy > ridge[0].y ? 0 : peakX
            }
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    let plot = CGRect(x: 0, y: 0, width: plotW, height: height)
                    let (zenith, horizon) = sky.colors
                    context.fill(Path(plot), with: .linearGradient(Gradient(colors: [zenith.opacity(0.82), horizon.opacity(0.6)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: height)))
                    var shape = Path()
                    shape.move(to: ridge[0])
                    for point in ridge.dropFirst() { shape.addLine(to: point) }
                    shape.addLine(to: CGPoint(x: plotW, y: height)); shape.addLine(to: CGPoint(x: 0, y: height)); shape.closeSubpath()
                    context.fill(shape, with: .color(Color(hex: 0x3B4A42)))
                    if let snowFt {
                        var snowContext = context
                        snowContext.clip(to: shape)
                        snowContext.fill(Path(CGRect(x: 0, y: 0, width: plotW, height: y(snowFt))), with: .color(Color(hex: 0xF4F7F8).opacity(0.94)))
                    }
                    context.stroke(shape, with: .color(.black.opacity(0.22)), lineWidth: 1)
                    for (ft, color) in [(freezingFt, Palette.cold), (snowFt, Palette.secondary)] {
                        guard let ft, ft > lo, ft < hi else { continue }
                        var line = Path(); line.move(to: CGPoint(x: 0, y: y(ft))); line.addLine(to: CGPoint(x: plotW, y: y(ft)))
                        context.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    }
                    // Leaders from each band on the ridge out to its label.
                    let labelYs = spread(bands.map { y($0.elevationFt) }, gap: 40, min: 22, max: height - 22)
                    for (index, band) in bands.enumerated() {
                        var leader = Path()
                        leader.move(to: CGPoint(x: ridgeX(band.elevationFt), y: y(band.elevationFt)))
                        leader.addLine(to: CGPoint(x: plotW, y: y(band.elevationFt)))
                        leader.addLine(to: CGPoint(x: plotW + 8, y: labelYs[index]))
                        leader.addLine(to: CGPoint(x: width, y: labelYs[index]))
                        context.stroke(leader, with: .color(Palette.label.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    }
                    if let target {
                        let point = CGPoint(x: ridgeX(target.elevationFt), y: y(target.elevationFt))
                        var line = Path(); line.move(to: point); line.addLine(to: CGPoint(x: plotW, y: point.y))
                        context.stroke(line, with: .color(Palette.accent), style: StrokeStyle(lineWidth: 1.5, dash: [2, 3]))
                        context.fill(Path(ellipseIn: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10)), with: .color(Palette.accent))
                    }
                    if let objectiveFt {
                        let point = CGPoint(x: ridgeX(objectiveFt), y: y(objectiveFt))
                        context.fill(Path(ellipseIn: CGRect(x: point.x - 7, y: point.y - 7, width: 14, height: 14)), with: .color(.white))
                        context.stroke(Path(ellipseIn: CGRect(x: point.x - 7, y: point.y - 7, width: 14, height: 14)), with: .color(Palette.label), lineWidth: 3)
                    }
                }
                // Text on top of the drawing.
                if let freezingFt, freezingFt > lo, freezingFt < hi {
                    levelLabel("Freezing level \(Format.feet(freezingFt))", color: Palette.cold).position(x: 80, y: y(freezingFt) - 9)
                }
                if let snowFt, snowFt > lo, snowFt < hi {
                    levelLabel("Snow level \(Format.feet(snowFt))", color: Palette.label).position(x: 72, y: y(snowFt) + 11)
                }
                if let objectiveFt {
                    Text("Objective").font(.caption.weight(.bold)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.6), radius: 2)
                        .position(x: max(40, ridgeX(objectiveFt) - 44), y: y(objectiveFt) - 12)
                }
                if let target {
                    Text("\(Format.feet(target.elevationFt)) · \(Format.temp(target.temp))")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Palette.surface.opacity(0.85), in: Capsule())
                        .position(x: min(plotW - 58, ridgeX(target.elevationFt) + 62), y: y(target.elevationFt) + 16)
                }
                let labelYs = spread(bands.map { y($0.elevationFt) }, gap: 40, min: 22, max: height - 22)
                ForEach(Array(bands.enumerated()), id: \.offset) { index, band in
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(bandName(band.label)) · \(Format.feet(band.elevationFt))").font(.system(size: 11)).foregroundStyle(Palette.secondary)
                        Text("\(Format.temp(band.temp)) · gust \(Format.windNumber(band.gust))")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle((band.temp ?? 99) <= 32 ? Palette.cold : Palette.label)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: side - 12, alignment: .leading)
                    .position(x: plotW + 12 + (side - 12) / 2, y: labelYs[index] + 4)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Conditions by elevation. " + bands.map { "\($0.label) \(Format.feet($0.elevationFt)): \(Format.temp($0.temp)), gusts \(Format.mph($0.gust))" }.joined(separator: ". "))
    }

    private func bandName(_ label: String) -> String {
        switch label {
        case "Objective Elevation": "Summit"
        case "Near Objective": "Near top"
        case "Mid Mountain", "Mid Route": "Mid route"
        case "Approach Terrain", "Trailhead": "Start"
        default: label
        }
    }

    private func levelLabel(_ text: String, color: Color) -> some View {
        Text(text).font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
            .padding(.horizontal, 4)
            .background(Palette.surface.opacity(0.75), in: Capsule())
            .fixedSize()
    }

    /// Nudges label anchors apart so none sit closer than `gap` (the web's `spreadLabels`).
    private func spread(_ desired: [CGFloat], gap: CGFloat, min lower: CGFloat, max upper: CGFloat) -> [CGFloat] {
        let order = desired.indices.sorted { desired[$0] < desired[$1] }
        var ys = order.map { desired[$0] }
        for k in ys.indices { ys[k] = Swift.max(ys[k], k == 0 ? lower : ys[k - 1] + gap) }
        for k in ys.indices.reversed() { ys[k] = Swift.min(ys[k], k == ys.count - 1 ? upper : ys[k + 1] - gap) }
        var out = desired
        for (k, index) in order.enumerated() { out[index] = ys[k] }
        return out
    }
}

/// The hours of the plan as small glass chips.
struct HourChips: View {
    var hours: [Hour]
    @Binding var selection: Int

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(hours.enumerated()), id: \.offset) { index, hour in
                    let on = index == selection
                    Button(index == 0 ? "Start" : hour.shortLabel) { withAnimation(.snappy) { selection = index } }
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 11)
                        .frame(height: 30)
                        .foregroundStyle(on ? Palette.onAccent : Palette.label)
                        .background(on ? Palette.accent : Palette.fill, in: Capsule())
                        .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        .scrollEdgeEffectHidden(true, for: .all)
    }
}

/// Danger by elevation drawn as the web's mountain of three bands.
struct DangerTriangle: View {
    /// Above, near and below treeline.
    var ratings: [Int?]

    var body: some View {
        Canvas { context, size in
            let w = size.width, h = size.height
            let hw: (CGFloat) -> CGFloat = { w / 2 * $0 / h }
            for band in 0..<3 {
                let y0 = h / 3 * CGFloat(band), y1 = h / 3 * CGFloat(band + 1)
                var path = Path()
                path.move(to: CGPoint(x: w / 2 - hw(y0), y: y0)); path.addLine(to: CGPoint(x: w / 2 + hw(y0), y: y0))
                path.addLine(to: CGPoint(x: w / 2 + hw(y1), y: y1)); path.addLine(to: CGPoint(x: w / 2 - hw(y1), y: y1)); path.closeSubpath()
                let rating = ratings.indices.contains(band) ? ratings[band] : nil
                context.fill(path, with: .color(Palette.danger(rating)))
                context.stroke(path, with: .color(.white), lineWidth: 2)
                context.draw(Text(rating.map(String.init) ?? "–").font(.system(size: 14, weight: .bold)).foregroundStyle(Color(hex: 0x18201C)),
                             at: CGPoint(x: w / 2, y: (y0 + y1) / 2 + (band == 0 ? 8 : 2)))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Aspects an avalanche problem covers, shaded on a compass rose.
struct AspectRose: View {
    var aspects: Set<String>
    private let order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

    var body: some View {
        Canvas { context, size in
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let r1 = min(size.width, size.height) / 2 - 12
            for (index, aspect) in order.enumerated() {
                let a0 = Angle(degrees: Double(index) * 45 - 22.5 - 90), a1 = Angle(degrees: Double(index) * 45 + 22.5 - 90)
                var sector = Path()
                sector.move(to: c)
                sector.addArc(center: c, radius: r1, startAngle: a0, endAngle: a1, clockwise: false)
                sector.closeSubpath()
                context.fill(sector, with: .color(aspects.contains(aspect) ? Palette.caution : Palette.fill))
                context.stroke(sector, with: .color(Palette.surface), lineWidth: 1.5)
            }
            for (label, point) in [("N", CGPoint(x: c.x, y: 5)), ("E", CGPoint(x: size.width - 4, y: c.y)), ("S", CGPoint(x: c.x, y: size.height - 5)), ("W", CGPoint(x: 4, y: c.y))] {
                context.draw(Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.secondary), at: point)
            }
        }
        .accessibilityLabel(aspects.isEmpty ? "Aspects not stated" : "Aspects: " + order.filter(aspects.contains).joined(separator: ", "))
    }
}

// MARK: - Timing

struct TimingChapter: View {
    @Environment(PlanStore.self) private var store
    var plan: Plan
    var report: Report
    var snapshot: Bool
    @State private var scenarios: JSON?
    @State private var loading = false
    @State private var error: String?
    @State private var extended = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Card {
                    CardHead("Sunrise")
                    BigValue(text: report.sunriseText ?? "—", small: true)
                    Caption(report.sunsetText.map { "Sunset \($0)." } ?? "No solar data.")
                }
                Card {
                    CardHead("Turnaround")
                    BigValue(text: report.turnaround.map(DateText.clock) ?? "—", small: true)
                    Caption(report.daylightFromStart.map { "Daylight from start: \($0)." } ?? "Back by the end of your window.")
                }
            }
            .padding(.horizontal, 16)
            if let daylight = report.check("daylight") {
                // The check's label and action read as sentences; its detail is a compact data line.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: daylight.ok ? "checkmark" : "exclamationmark.triangle")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(daylight.ok ? Palette.secondary : Palette.caution)
                    Caption(daylight.ok ? daylight.label : (daylight.action ?? daylight.label),
                            tone: daylight.ok ? Palette.secondary : Palette.caution, emphasized: !daylight.ok)
                }
                .padding(.horizontal, 20).padding(.top, 10)
            }
            if !report.evaluation.at("criticalWindow.peak").isNull, report.evaluation.at("criticalWindow.peak.level").string != "stable" {
                let peak = report.evaluation.at("criticalWindow.peak")
                Spacer().frame(height: 28)
                SectionHead("The hour to watch")
                Card(spacing: 6) {
                    CardHead(title: (report.evaluation.at("criticalWindow.peakTime").string ?? peak["time"].string).map(DateText.clock) ?? "—") {
                        StatusTag(kind: peak["level"].string == "high" ? .over : peak["level"].string == "watch" ? .over : .ok,
                                  text: (peak["level"].string ?? "stable").capitalized)
                    }
                    ForEach(peak["reasons"].strings, id: \.self) { reason in Caption("• \(reason)") }
                    HStack {
                        FactRow(label: "Temp", value: Format.temp(peak["temp"].double))
                        Spacer(minLength: 16)
                        FactRow(label: "Gust", value: Format.mph(peak["gust"].double))
                    }
                }
                .padding(.horizontal, 16)
            }
            Spacer().frame(height: 28)
            SectionHead(title: "Other departures") {
                if loading { ProgressView().controlSize(.small) }
            }
            scenarioList
            if !snapshot && !plan.isSample && scenarios != nil && !extended {
                Button("Check more departures") { extended = true; scenarios = nil; Task { await load() } }
                    .buttonStyle(.glass).padding(.horizontal, 20).padding(.top, 10)
            }
            Spacer().frame(height: 28)
            SectionHead("Your limits")
            Card(spacing: 6) {
                let limits = report.limits ?? plan.limits
                FactRow(label: "Gusts up to", value: Format.mph(Double(limits.maxGustMph)))
                FactRow(label: "Rain chance up to", value: "\(limits.maxPrecipChance)%")
                FactRow(label: "Feels-like at least", value: Format.temp(Double(limits.minFeelsLikeF)))
                FactRow(label: "Feels-like at most", value: Format.temp(Double(limits.maxFeelsLikeF)))
                Caption("\(plan.activityLabel) limits. Change them in Edit plan or Settings.")
            }
            .padding(.horizontal, 16)
            Spacer().frame(height: 28)
            ContingencySection(report: report, plan: plan)
        }
        .task { await load() }
    }

    /// Moves the plan to another departure and checks it again.
    private func use(start: String) {
        guard var next = store.plan(plan.id) else { return }
        next.start = start
        store.update(next)
        scenarios = nil
        Task { await store.refresh(next) }
    }

    @ViewBuilder
    private var scenarioList: some View {
        let comparison = scenarios?["comparison"] ?? .null
        let best = comparison["bestStartTime"].string
        VStack(spacing: 12) {
            // Notice pads itself to the page gutter; the cards below take the same gutter.
            if snapshot || plan.isSample {
                Notice(tone: .info, text: "Other departures are checked live, so they aren’t available for a saved or sample report.")
            } else if let error {
                Notice(tone: .caution, text: error, actionTitle: "Try again") { Task { await load() } }
            }
            VStack(spacing: 12) {
                if let reason = comparison["recommendationReason"].string, error == nil, !snapshot, !plan.isSample {
                    Caption(reason).padding(.horizontal, 4)
                }
                ForEach(Array(comparison["scenarios"].array.enumerated()), id: \.offset) { _, scenario in
                    let start = scenario["startTime"].string ?? ""
                    ItemCard(
                        title: "\(DateText.clock(start)) start\(start == plan.start ? " (yours)" : "")",
                        level: DecisionLevel(scenario.at("decision.level").string),
                        meta: [scenario["returnTime"].string.map { "Back \(DateText.clock($0))" },
                               scenario["peakGustMph"].double.map { "peak gust \(Format.mph($0))" },
                               scenario["score"].double.map { "score \(Int($0.rounded()))" }].compactMap { $0 }.joined(separator: " · "),
                        caption: start == best ? "Suggested departure" : scenario.at("decision.headline").string,
                        captionTone: start == best ? Palette.accent : Palette.secondary,
                        captionEmphasized: start == best) {
                        if start != plan.start && !snapshot && store.plan(plan.id) != nil {
                            Button("Use \(DateText.clock(start)) start", systemImage: "arrow.right") { use(start: start) }
                                .buttonStyle(.glass).controlSize(.small).padding(.top, 4)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func load() async {
        guard !snapshot, !plan.isSample, scenarios == nil, AccountStore.shared.flags.startTimeComparisons else { return }
        loading = true
        defer { loading = false }
        do {
            scenarios = try await APIClient().startTimeScenarios(place: plan.objective, params: plan.planParams, extended: extended)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Checks & sources

struct ChecksChapter: View {
    var plan: Plan
    var report: Report
    var snapshot: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(title: "Every check") {
                Text("\(report.checks.filter(\.ok).count) of \(report.checks.count) pass")
            }
            VStack(spacing: 10) {
                ForEach(report.checks.sorted { !$0.ok && $1.ok }) { check in
                    Card(spacing: 4) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: check.ok ? "checkmark" : "exclamationmark.triangle")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(check.ok ? Palette.secondary : Palette.caution)
                                .frame(width: 18)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(check.label).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                                if let detail = check.detail { Caption(detail) }
                                if !check.ok, let action = check.action { Caption(action, tone: Palette.caution, emphasized: true) }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            Spacer().frame(height: 28)
            SectionHead(title: "How fresh is each source") {
                if report.evaluation.at("interpretation.sourceFreshness.hasWarning").bool == true { Text("Check sources").foregroundStyle(Palette.caution) }
            }
            Card(spacing: 10) {
                ForEach(Array(report.sources.enumerated()), id: \.offset) { _, source in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(source.label).font(.subheadline)
                            if let issued = source.issued { Text(DateText.stamp(issued) ?? issued).font(.caption2).foregroundStyle(Palette.secondary) }
                        }
                        Spacer()
                        StatusTag(kind: source.state == "fresh" ? .ok : source.state == "stale" ? .over : .missing,
                                  text: source.state.capitalized)
                    }
                }
                if let warning = report.evaluation.at("interpretation.sourceFreshness.warningSummary").string { Caption(warning, tone: Palette.caution) }
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(report.sourceLinks, id: \.label) { link in
                        Link(link.label, destination: link.url).font(.subheadline.weight(.semibold))
                    }
                }
            }
            .padding(.horizontal, 16)
            Spacer().frame(height: 28)
            DayOverDaySection(plan: plan, report: report, snapshot: snapshot)
            Spacer().frame(height: 28)
            if AccountStore.shared.flags.scoreBreakdown {
                ScoreSection(report: report)
                Spacer().frame(height: 28)
            }
            SupplementalSection(report: report)
            Spacer().frame(height: 28)
            AlertsSection(report: report)
            Spacer().frame(height: 28)
            SectionHead("Forecast provenance")
            Card(spacing: 6) {
                Caption([report.weatherProvider.map { "\($0) forecast" }, report.json.at("weather.forecastSource").string].compactMap { $0 }.joined(separator: " · "))
                RawDataDisclosure(title: "Weather field sources and forecast context", value: .object([
                    "sources": report.json.at("weather.sourceDetails"),
                    "evidence": report.json.at("safety.weatherProvenance"),
                    "forecast": report.json["forecast"],
                ]))
                RawDataDisclosure(title: "Complete report data", value: report.json)
                ShareLink(item: ReportExport(report: report, name: plan.objective.shortName), preview: SharePreview("\(plan.objective.shortName) report data")) {
                    Label("Export report data", systemImage: "square.and.arrow.up")
                }
                .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 16)
            Caption("Planning evidence, not a guarantee of safety.").padding(.horizontal, 20).padding(.top, 12)
        }
    }
}
