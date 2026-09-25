import MapKit
import SwiftUI
import UniformTypeIdentifiers

/// What the New plan sheet starts from: blank, a place from search, or an existing plan to edit.
struct NewPlanDraft: Identifiable {
    var id = UUID()
    var objective: Place?
    var editing: Plan?
    var date: String?
    var start: String?
    var hours: Int?
    var multiDay = false
}

enum PlanKind: String, CaseIterable, Identifiable {
    case day = "Day trip"
    case multi = "Multi-day"
    var id: String { rawValue }
}

/// The New plan sheet, laid out as the web's plan form with native pickers and glass controls.
struct NewPlanSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AccountStore.self) private var account
    var draft: NewPlanDraft
    var onSubmit: (Plan) -> Void

    @State private var kind: PlanKind = .day
    @State private var objective: Place?
    @State private var activity: Activity = .hiking
    @State private var customID: String?
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var startTime = Calendar.current.date(bySettingHour: 7, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var hours = 8
    @State private var limits = Activity.hiking.defaultLimits
    @State private var trailheadFt: Double?
    @State private var route: PlanRoute?
    @State private var routeName = ""
    @State private var routeSuggestions = RouteSuggestions()
    @State private var tripName = ""
    @State private var stages: [StageDraft] = []
    @State private var exit: Place?
    @State private var bailPoints: [Place] = []
    @State private var tripTrack: [TrackCoordinate]?
    @State private var picking: PlaceTarget?
    /// A trip stop being placed on the map, which opens on the route.
    @State private var mapping: PlaceTarget?
    @State private var importing = false
    /// What the file being imported is for. Kept apart from `importing`, which the importer clears
    /// before its completion runs.
    @State private var importTarget: ImportTarget = .route
    @State private var importError: String?
    /// The activity the limits card was last filled for. The sheet opens with the plan's own limits;
    /// choosing another activity then brings in that activity's limits.
    @State private var limitsKey: String?

    enum PlaceTarget: Identifiable, Hashable {
        case objective
        case stageEnd(Int)
        case checkpoint(Int)
        case exit
        case bail
        var id: String { "\(self)" }
    }

    enum ImportTarget: Identifiable {
        case route, trip
        var id: Int { self == .route ? 0 : 1 }
    }

    struct StageDraft: Identifiable, Hashable {
        var id = UUID()
        var end: Place?
        var layover = false
        var start = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: Date()) ?? Date()
        var hours = 7
        var checkpoints: [Place] = []
    }

    private var preferences: Preferences { preferencesStore.preferences }
    private var activityKey: String { customID ?? activity.rawValue }
    private var maxDate: Date { Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date() }

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(title: draft.editing == nil ? (kind == .day ? "New plan" : "New trip") : "Edit plan",
                           subtitle: kind == .day ? "An objective, a start, and your limits." : "A trailhead, a camp for each night, and how long you hike each day.")
                Spacer().frame(height: 14)
                if account.flags.tripPlanning || kind == .multi {
                    Picker("Plan type", selection: $kind) {
                        ForEach(PlanKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .disabled(draft.editing != nil)
                    Spacer().frame(height: 14)
                }
                if kind == .multi {
                    TextField("Trip name (optional)", text: $tripName)
                        .padding(12).background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 16)
                    Spacer().frame(height: 14)
                }
                objectiveCard.padding(.horizontal, 16)
                Spacer().frame(height: 14)
                activityChips
                Spacer().frame(height: 14)
                if kind == .day {
                    whenCard.padding(.horizontal, 16)
                    Spacer().frame(height: 12)
                    routeCard.padding(.horizontal, 16)
                } else {
                    tripCard.padding(.horizontal, 16)
                    Spacer().frame(height: 12)
                    exitCard.padding(.horizontal, 16)
                }
                Spacer().frame(height: 12)
                limitsCard.padding(.horizontal, 16)
                if let importError {
                    Spacer().frame(height: 12)
                    Notice(tone: .caution, text: importError)
                }
                Spacer().frame(height: 16)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .safeAreaBar(edge: .bottom) {
                VStack(spacing: 6) {
                    if let gap = gaps.first {
                        Label(gap, systemImage: "info.circle").font(.footnote).foregroundStyle(Palette.secondary)
                    }
                    Button(action: submit) {
                        Label(kind == .day ? "Check conditions" : "Check trip", systemImage: "arrow.right")
                            .labelStyle(TrailingIconLabelStyle())
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(.glassProminent).tint(Palette.prominent)
                    .disabled(!gaps.isEmpty)
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 8)
            }
            .sheet(item: $picking) { target in
                PlacePicker(title: pickerTitle(target), near: pickerNear(target), context: landmarks(excluding: target), track: routeTrack,
                            legs: tripLegs, current: currentPoint(target)) { place in
                    apply(place, to: target)
                }
            }
            .fullScreenCover(item: $mapping) { target in
                MapPicker(title: pickerTitle(target), around: pickerNear(target), context: landmarks(excluding: target),
                          track: routeTrack, legs: tripLegs, current: currentPoint(target)) { place in
                    apply(place, to: target)
                }
            }
            .fileImporter(isPresented: $importing,
                          allowedContentTypes: [UTType(filenameExtension: "gpx") ?? .xml, .xml]) { result in
                importGPX(result, for: importTarget)
            }
        }
        .onAppear(perform: load)
        .onChange(of: activityKey) { _, key in
            guard let limitsKey, key != limitsKey else { return }
            self.limitsKey = key
            limits = preferences.limits(for: key)
        }
        .onChange(of: kind) { _, value in if value == .multi && stages.isEmpty { resizeStages(to: 3) } }
    }

    private func pickerTitle(_ target: PlaceTarget) -> String {
        switch target {
        case .objective: kind == .day ? "Objective" : "Trailhead"
        case .stageEnd(let index): "Camp for night \(index + 1)"
        case .checkpoint(let index): "High point for day \(index + 1)"
        case .exit: "Exit"
        case .bail: "Bail point"
        }
    }

    /// Where a picker opens and searches: the stop before the one being chosen, so night 2's camp
    /// is found near night 1's and a day's high point near where that day starts.
    private func pickerNear(_ target: PlaceTarget) -> Place? {
        switch target {
        case .objective: nil
        case .stageEnd(let index), .checkpoint(let index): index > 0 ? campPoint(index - 1) : objective
        case .exit: stages.count > 1 ? campPoint(stages.count - 2) : objective
        case .bail: objective
        }
    }

    private func apply(_ place: Place, to target: PlaceTarget) {
        switch target {
        case .objective: objective = place
        case .stageEnd(let index):
            if stages.indices.contains(index) { stages[index].end = place.named(unlessFeature: "Night \(index + 1) camp"); stages[index].layover = false }
        case .checkpoint(let index):
            if stages.indices.contains(index) && stages[index].checkpoints.count < 2 {
                var point = place
                if point.kind == "Pin" { point.name = "Day \(index + 1) high point" }
                stages[index].checkpoints.append(point)
            }
        case .exit: exit = place.named(unlessFeature: "Exit")
        case .bail: if bailPoints.count < 4 { bailPoints.append(place.named(unlessFeature: "Bail point \(bailPoints.count + 1)")) }
        }
    }

    /// The point a stop already has, so changing it starts from there.
    private func currentPoint(_ target: PlaceTarget) -> Place? {
        switch target {
        case .objective: objective
        case .stageEnd(let index): stages.indices.contains(index) ? stages[index].end : nil
        case .exit: exit
        default: nil
        }
    }

    /// The track the plan follows: a day trip's GPX route or a trip's imported track.
    private var routeTrack: [TrackCoordinate] {
        kind == .day ? (route?.gpx?.displayTrack ?? []).map { TrackCoordinate(lat: $0.lat, lon: $0.lon) } : tripTrack ?? []
    }

    /// The trip's stops in travel order: trailhead, each day's high points and camp, then the exit
    /// (or back to the trailhead), for the map to draw the way between them.
    private var tripLegs: [Place] {
        guard kind == .multi, let objective else { return [] }
        var points = [objective]
        for (index, stage) in stages.enumerated() {
            points += stage.checkpoints
            if index < stages.count - 1, !stage.layover, let end = stage.end { points.append(end) }
        }
        points.append(exit ?? objective)
        return points.count > 2 ? points : []
    }

    /// The plan's other points, labeled on the picker's map.
    private func landmarks(excluding target: PlaceTarget) -> [PlaceLandmark] {
        var points: [PlaceLandmark] = []
        if let objective, target != .objective { points.append(PlaceLandmark(label: kind == .day ? "Objective" : "Trailhead", place: objective)) }
        guard kind == .multi else { return points }
        for (index, stage) in stages.dropLast().enumerated() where target != .stageEnd(index) && !stage.layover {
            if let end = stage.end { points.append(PlaceLandmark(label: "Night \(index + 1)", place: end)) }
        }
        for (index, stage) in stages.enumerated() {
            for point in stage.checkpoints { points.append(PlaceLandmark(label: "Day \(index + 1) high point", place: point)) }
        }
        if let exit, target != .exit { points.append(PlaceLandmark(label: "Exit", place: exit)) }
        for point in bailPoints { points.append(PlaceLandmark(label: "Bail point", place: point)) }
        return points
    }

    // MARK: Cards

    private var objectiveCard: some View {
        Card {
            CardHead(kind == .day ? "Objective" : "Trailhead")
            Button { picking = .objective } label: {
                HStack(spacing: 12) {
                    PlaceThumb(place: objective)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(objective?.shortName ?? "Choose a place").font(.headline).foregroundStyle(objective == nil ? Palette.secondary : Palette.label)
                        if let objective {
                            Text([objective.elevationFt.map(Format.feet), objective.region].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(Palette.secondary).lineLimit(2)
                        } else {
                            Text("Search, drop a pin or use your location").font(.footnote).foregroundStyle(Palette.secondary)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(objective == nil ? "Search" : "Change")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .glassEffect(.regular.interactive(), in: .capsule)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
            if kind == .multi && account.flags.gpxImport {
                Button { importTarget = .trip; importing = true } label: { Label("Build the trip from a GPX track", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.glass).controlSize(.small).padding(.top, 4)
            }
        }
    }

    private var activityChips: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Activity").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.secondary).padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Activity.allCases) { item in
                        GlassChip(title: item.shortLabel, selected: customID == nil && item == activity) { activity = item; customID = nil }
                    }
                    ForEach(preferences.customActivities) { custom in
                        GlassChip(title: custom.label, selected: customID == custom.id) { activity = custom.baseActivity; customID = custom.id }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .scrollEdgeEffectHidden(true, for: .all)
            // Unclipped, so the chips' glass doesn't leave a band at the row's edges.
            .scrollClipDisabled()
        }
    }

    private var whenCard: some View {
        Card(spacing: 8) {
            CardHead("When")
            HStack(spacing: 8) {
                FieldBox(label: "Date") {
                    DatePicker("Date", selection: $date, in: Calendar.current.startOfDay(for: Date())...maxDate, displayedComponents: .date).labelsHidden()
                }
                FieldBox(label: "Start") {
                    DatePicker("Start", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden()
                }
            }
            Stepper(value: $hours, in: 1...24) {
                Text("Duration \(Text("· \(hours) hours").foregroundStyle(Palette.secondary))").font(.subheadline)
            }
            .padding(.top, 2)
            if let estimate = route?.estimatedHours(preferences.routeTiming(for: activityKey)) {
                if estimate != hours {
                    Button("Use \(estimate) hours from your route at your pace") { hours = estimate }.font(.footnote.weight(.semibold))
                }
            }
            Divider()
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Trailhead elevation").font(.subheadline)
                    Text(trailheadFt.map(Format.feet) ?? "Estimated by the server").font(.caption).foregroundStyle(Palette.secondary)
                }
                Spacer()
                Stepper("Trailhead", value: Binding(get: { Int(trailheadFt ?? (objective?.elevationFt.map { max(0, $0 - 3000) } ?? 5000)) },
                                                    set: { trailheadFt = Double($0) }), in: 0...20000, step: 100)
                    .labelsHidden()
                if trailheadFt != nil { Button("Clear", systemImage: "xmark.circle.fill") { trailheadFt = nil }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary) }
            }
        }
    }

    private var routeCard: some View {
        Card(spacing: 8) {
            CardHead(title: "Route") { Text("Optional").font(.footnote) }
            if let route {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(route.name).font(.headline)
                        if let gpx = route.gpx {
                            Text("\(Format.miles(gpx.distanceMiles)) · \(gpx.elevationGainFt.map(Format.feet) ?? "—") gain · \(gpx.checkpoints.count) checkpoints")
                                .font(.caption).foregroundStyle(Palette.secondary)
                        } else {
                            let facts = [route.distanceRtMiles.map { "\(Format.miles($0)) round trip" }, route.elevationGainFt.map { "\(Format.feet($0)) gain" }]
                                .compactMap { $0 }.joined(separator: " · ")
                            Text(facts.isEmpty ? "Named route" : facts).font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                    Spacer()
                    Button("Remove", systemImage: "xmark.circle.fill") { self.route = nil }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary)
                }
                Divider()
            } else {
                Caption("Name your route, pick a suggested one, or import a GPX track to check the approach where you’ll be each hour.")
            }
            HStack {
                TextField("Route name, e.g. Avalanche Gulch", text: $routeName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .onSubmit(useRouteName)
                    .padding(10).background(Palette.field, in: RoundedRectangle(cornerRadius: 10))
                Button("Use", action: useRouteName)
                    .buttonStyle(.glass).controlSize(.small)
                    .disabled(routeName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.vertical, 2)
            if objective != nil {
                RouteSuggestionPicker(model: routeSuggestions, place: objective, selected: route?.gpx == nil ? route?.name : nil,
                                      timing: preferences.routeTiming(for: activityKey)) { option in
                    route = PlanRoute(name: String(option.name.prefix(200)), gpx: nil, distanceRtMiles: option.miles, elevationGainFt: option.gainFt)
                }
            }
            if account.flags.gpxImport {
                Button { importTarget = .route; importing = true } label: { Label(route?.gpx == nil ? "Import GPX" : "Replace GPX", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.glass).controlSize(.small)
            }
        }
    }

    private func useRouteName() {
        let name = routeName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        route = PlanRoute(name: String(name.prefix(200)), gpx: nil)
        routeName = ""
    }

    private var tripCard: some View {
        Card(spacing: 10) {
            CardHead("Days")
            HStack(spacing: 8) {
                FieldBox(label: "First day") {
                    DatePicker("First day", selection: $date, in: Calendar.current.startOfDay(for: Date())...maxDate, displayedComponents: .date).labelsHidden()
                }
                Stepper(value: Binding(get: { stages.count - 1 }, set: { resizeStages(to: $0 + 1) }), in: 1...6) {
                    Text("\(stages.count - 1) \(stages.count == 2 ? "night" : "nights")").font(.subheadline.weight(.semibold))
                }
            }
            ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Day \(index + 1)").font(.subheadline.weight(.semibold))
                        Text(DateText.short(DateText.iso(Calendar.current.date(byAdding: .day, value: index, to: date) ?? date)))
                            .font(.subheadline).foregroundStyle(Palette.secondary)
                        Spacer()
                        if index < stages.count - 1 {
                            Button(stage.layover ? "Layover" : stage.end?.shortName ?? "Choose camp") { mapping = .stageEnd(index) }
                                .buttonStyle(.glass).controlSize(.small).lineLimit(1)
                        } else {
                            Text(exit.map { "To \($0.shortName)" } ?? "Back to trailhead").font(.footnote).foregroundStyle(Palette.secondary)
                        }
                    }
                    if index < stages.count - 1 {
                        Toggle("Layover: stay at last night’s camp", isOn: $stages[index].layover).font(.footnote)
                    }
                    HStack {
                        DatePicker("Start", selection: $stages[index].start, displayedComponents: .hourAndMinute)
                            .font(.footnote)
                        Stepper("\(stages[index].hours) h", value: $stages[index].hours, in: 1...16).font(.footnote).fixedSize()
                    }
                    ForEach(Array(stage.checkpoints.enumerated()), id: \.offset) { checkpoint, point in
                        HStack {
                            Label(point.shortName, systemImage: "mountain.2").font(.footnote)
                            Spacer()
                            Button("Remove", systemImage: "minus.circle") { stages[index].checkpoints.remove(at: checkpoint) }
                                .labelStyle(.iconOnly).foregroundStyle(Palette.secondary)
                        }
                    }
                    if stage.checkpoints.count < 2 && !(stage.layover && index < stages.count - 1) {
                        Button("Add a high point or pass", systemImage: "plus") { mapping = .checkpoint(index) }.font(.footnote.weight(.semibold))
                    }
                }
            }
            Caption("Each day ends at a camp; the last ends at the trailhead unless you pick another exit. Every day and night is checked, and the trip is only as good as its weakest one.")
        }
    }

    private var exitCard: some View {
        Card(spacing: 8) {
            CardHead("Exit and bail points")
            HStack {
                Text(exit.map { "Exit at \($0.shortName)" } ?? "Exit at the trailhead").font(.subheadline)
                Spacer()
                Button(exit == nil ? "Choose exit" : "Change") { mapping = .exit }.buttonStyle(.glass).controlSize(.small)
                if exit != nil { Button("Clear", systemImage: "xmark.circle.fill") { exit = nil }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary) }
            }
            ForEach(Array(bailPoints.enumerated()), id: \.offset) { index, point in
                HStack {
                    Label(point.shortName, systemImage: "arrow.uturn.left").font(.footnote)
                    Spacer()
                    Button("Remove", systemImage: "minus.circle") { bailPoints.remove(at: index) }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary)
                }
            }
            if bailPoints.count < 4 {
                Button("Add a bail point", systemImage: "plus") { mapping = .bail }.font(.footnote.weight(.semibold))
            }
            Caption("Bail points are places to leave the route early. Each night’s brief names the nearest way out.")
        }
    }

    private var limitsCard: some View {
        Card(spacing: 8) {
            CardHead(title: "Your limits") {
                Text(limits == preferences.limits(for: activityKey) ? "\(customLabel ?? activity.shortLabel) defaults" : "Adjusted").font(.footnote)
            }
            HStack(spacing: 8) {
                limitBox("Gusts", value: $limits.maxGustMph, range: Limits.gustRange, step: 5) { Format.mph(Double($0)) }
                limitBox("Rain chance", value: $limits.maxPrecipChance, range: Limits.precipRange, step: 5) { "\($0)%" }
            }
            HStack(spacing: 8) {
                limitBox("Coldest feels", value: $limits.minFeelsLikeF, range: Limits.coldRange, step: 5) { Format.temp(Double($0)) }
                limitBox("Hottest feels", value: $limits.maxFeelsLikeF, range: Limits.heatRange, step: 5) { Format.temp(Double($0)) }
            }
            Caption("Hours past a limit are flagged in the brief. Gusts and rain are maximums; feels-like is the range you’ll accept.")
        }
    }

    private var customLabel: String? { preferences.customActivities.first { $0.id == customID }?.label }

    private func limitBox(_ label: String, value: Binding<Int>, range: ClosedRange<Int>, step: Int, text: @escaping (Int) -> String) -> some View {
        // The whole box opens the menu, not only the value's text.
        Menu {
            ForEach(Array(stride(from: range.lowerBound, through: range.upperBound, by: step)), id: \.self) { option in
                Button(text(option)) { value.wrappedValue = option }
            }
        } label: {
            FieldBox(label: label) {
                Text(text(value.wrappedValue)).foregroundStyle(Palette.label)
            }
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: Logic

    /// What still has to be chosen, first gap first (the web's `itineraryGaps`).
    private var gaps: [String] {
        guard objective != nil else { return [kind == .day ? "Choose an objective" : "Choose a trailhead"] }
        guard kind == .multi else { return [] }
        return stages.dropLast().enumerated().compactMap { index, _ in campPoint(index) == nil ? "Add a camp for night \(index + 1)" : nil }
    }

    /// The point a night is spent at, following layovers back to a chosen camp.
    private func campPoint(_ night: Int) -> Place? {
        var index = night
        while index >= 0 {
            let stage = stages[index]
            if !stage.layover { return stage.end }
            index -= 1
        }
        return objective
    }

    private func resizeStages(to count: Int) {
        let clamped = max(2, min(7, count))
        if stages.count < clamped {
            let template = stages.last ?? StageDraft(start: DateText.localTime(preferences.defaultStartTime) ?? Date())
            stages.append(contentsOf: (stages.count..<clamped).map { _ in StageDraft(start: template.start, hours: template.hours) })
        } else {
            stages = Array(stages.prefix(clamped))
        }
    }

    private func load() {
        guard limitsKey == nil else { return }
        if let plan = draft.editing {
            limitsKey = plan.activityKey
            objective = plan.objective
            activity = plan.activity
            customID = plan.customActivityID
            limits = plan.limits
            hours = plan.travelHours
            trailheadFt = plan.trailheadFt
            route = plan.route
            tripName = plan.tripName ?? ""
            bailPoints = plan.bailPoints ?? []
            tripTrack = plan.tripTrack
            if let parsed = DateText.localDate(plan.date) { date = parsed }
            if let time = DateText.localTime(plan.start) { startTime = time }
            if let planStages = plan.stages {
                kind = .multi
                let trailhead = planStages.first?.from ?? plan.objective
                exit = planStages.last.map(\.to).flatMap { $0 == trailhead ? nil : $0 }
                stages = planStages.enumerated().map { index, stage in
                    StageDraft(end: index == planStages.count - 1 ? nil : stage.to,
                               layover: index < planStages.count - 1 && stage.isLayover,
                               start: DateText.localTime(stage.start) ?? Date(),
                               hours: stage.travelHours,
                               checkpoints: stage.checkpoints ?? [])
                }
            }
        } else {
            let p = preferences
            limitsKey = p.activeKey
            objective = draft.objective
            activity = p.defaultActivity
            customID = p.customActivityID
            limits = p.limits
            hours = draft.hours ?? p.travelWindowHours
            if let start = draft.start ?? Optional(p.defaultStartTime), let time = DateText.localTime(start) { startTime = time }
            if let iso = draft.date, let parsed = DateText.localDate(iso), parsed >= Calendar.current.startOfDay(for: Date()) { date = parsed }
            if draft.multiDay { kind = .multi; resizeStages(to: 3) }
        }
    }

    private func importGPX(_ result: Result<URL, Error>, for target: ImportTarget) {
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let gpx = try GpxParser.parse(data: Data(contentsOf: url), fileName: url.lastPathComponent)
            importError = nil
            switch target {
            case .route:
                route = PlanRoute(name: gpx.name, gpx: gpx, elevationGainFt: gpx.elevationGainFt, shape: gpx.isLoop ? "loop" : "auto")
                if objective == nil, let last = gpx.checkpoints.max(by: { ($0.elevFt ?? 0) < ($1.elevFt ?? 0) }) {
                    objective = Place(name: gpx.name, lat: last.lat, lon: last.lon, elevationFt: last.elevFt, kind: "Route high point")
                }
                if let first = gpx.displayTrack.first?.elevFt { trailheadFt = first }
            case .trip:
                applyTrip(gpx)
            }
        } catch {
            importError = error.localizedDescription
        }
    }

    /// Splits a GPX track into days (the web's `splitGpxIntoDays`): camp-named waypoints set the nights
    /// when there are exactly enough, otherwise days of equal effort; a day climbing well above both
    /// ends gets its high point as a checkpoint.
    private func applyTrip(_ gpx: GpxRoute) {
        let track = gpx.displayTrack
        guard track.count >= 2 else { return }
        let nights = max(1, min(6, stages.count - 1))
        let timing = preferences.routeTiming(for: activityKey)
        var effort: [Double] = [0]
        for index in 1..<track.count {
            let miles = gpx.distanceMiles * (track[index].progressPercent - track[index - 1].progressPercent) / 100
            let climb = (track[index].elevFt != nil && track[index - 1].elevFt != nil) ? max(0, track[index].elevFt! - track[index - 1].elevFt!) / 1000 : 0
            effort.append(effort[index - 1] + max(0, miles) + climb)
        }
        let total = effort.last ?? 0
        let named = gpx.checkpoints.filter { $0.name.range(of: #"\b(camp|campsite|bivy|bivouac|site)\b"#, options: [.regularExpression, .caseInsensitive]) != nil }
        var cuts: [Int]
        if named.count == nights {
            cuts = named.map { camp in track.indices.min { abs(track[$0].progressPercent - camp.progressPercent) < abs(track[$1].progressPercent - camp.progressPercent) } ?? 0 }.sorted()
        } else {
            cuts = (0..<nights).map { night in
                let target = total * Double(night + 1) / Double(nights + 1)
                return effort.firstIndex { $0 >= target } ?? track.count - 1
            }
        }
        let bounds = [0] + cuts + [track.count - 1]
        let point: (TrackPoint, String) -> Place = { Place(name: $1, lat: $0.lat, lon: $0.lon, elevationFt: $0.elevFt, kind: "Route") }
        var next: [StageDraft] = []
        for day in 0..<(bounds.count - 1) {
            let startIndex = bounds[day], endIndex = max(startIndex, bounds[day + 1])
            let segment = Array(track[startIndex...endIndex])
            let distance = gpx.distanceMiles * (track[endIndex].progressPercent - track[startIndex].progressPercent) / 100
            var gain = 0.0
            for index in segment.indices.dropFirst() {
                if let a = segment[index - 1].elevFt, let b = segment[index].elevFt, b > a { gain += b - a }
            }
            let high = segment.max { ($0.elevFt ?? -.infinity) < ($1.elevFt ?? -.infinity) } ?? segment[0]
            let ends = [segment.first?.elevFt, segment.last?.elevFt].compactMap { $0 }
            var checkpoints: [Place] = []
            if let highFt = high.elevFt, ends.count == 2, highFt - (ends.max() ?? highFt) >= 800 { checkpoints = [point(high, "Day \(day + 1) high point")] }
            let dayRoute = GpxRoute(name: "", fileName: "", pointCount: segment.count, distanceMiles: max(0, distance), elevationGainFt: gain.rounded(),
                                    minElevationFt: nil, maxElevationFt: nil, checkpoints: [], displayTrack: segment, routeShape: "point-to-point")
            var stage = StageDraft(start: stages.indices.contains(day) ? stages[day].start : (DateText.localTime(preferences.defaultStartTime) ?? Date()),
                                   hours: dayRoute.estimatedHours(timing), checkpoints: checkpoints)
            if day < nights {
                stage.end = point(track[cuts[day]], named.count == nights ? named[day].name : "Camp \(day + 1)")
            }
            next.append(stage)
        }
        stages = next
        tripTrack = track.map { TrackCoordinate(lat: $0.lat, lon: $0.lon) }
        objective = point(track[0], "\(gpx.name) start")
        exit = gpx.isLoop ? nil : point(track[track.count - 1], "\(gpx.name) end")
        if tripName.isEmpty { tripName = gpx.name }
    }

    private func submit() {
        guard let objective, gaps.isEmpty else { return }
        var plan = draft.editing ?? Plan(objective: objective, activity: activity, date: DateText.iso(date), start: DateText.hhmm(startTime),
                                          travelHours: hours, limits: limits)
        plan.objective = objective
        plan.activity = activity
        plan.customActivityID = customID
        plan.customActivityLabel = customLabel
        plan.date = DateText.iso(date)
        plan.limits = limits
        if kind == .multi {
            let trailhead = objective
            let lastPoint = exit ?? trailhead
            var from = trailhead
            plan.stages = stages.enumerated().map { index, draft in
                let to: Place = index == stages.count - 1 ? lastPoint : (campPoint(index) ?? trailhead)
                defer { from = to }
                return Stage(start: DateText.hhmm(draft.start), travelHours: draft.hours, from: from, to: to,
                             layover: index < stages.count - 1 && draft.layover,
                             checkpoints: draft.checkpoints.isEmpty ? nil : Array(draft.checkpoints.prefix(2)))
            }
            plan.start = plan.stages?.first?.start ?? DateText.hhmm(startTime)
            plan.travelHours = plan.stages?.first?.travelHours ?? hours
            plan.tripName = tripName.trimmingCharacters(in: .whitespaces).isEmpty ? nil : tripName.trimmingCharacters(in: .whitespaces)
            plan.bailPoints = bailPoints.isEmpty ? nil : bailPoints
            plan.tripTrack = tripTrack
            plan.route = nil
            plan.trailheadFt = nil
        } else {
            plan.stages = nil
            plan.start = DateText.hhmm(startTime)
            plan.travelHours = hours
            plan.trailheadFt = trailheadFt
            if plan.route?.gpx != route?.gpx || plan.route?.name != route?.name { plan.route = route }
            plan.tripName = nil
            plan.bailPoints = nil
            plan.tripTrack = nil
        }
        plan.isSample = false
        onSubmit(plan)
        dismiss()
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) { configuration.title; configuration.icon }
    }
}

private extension Place {
    /// A dropped pin named only by its coordinates reads better as its role in the trip
    /// ("Night 1 camp"); a pin on a named lake or pass keeps that name.
    func named(unlessFeature role: String) -> Place {
        guard kind == "Pin", Place.coordinates(in: name) != nil else { return self }
        var place = self
        place.name = role
        return place
    }
}

/// A small map of a chosen place, or a contour tile before one is chosen. A snapshot, so the
/// tile is a picture rather than a live map with its own controls.
struct PlaceThumb: View {
    var place: Place?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image, place != nil {
                Image(uiImage: image).resizable().scaledToFill()
                Circle().fill(Palette.accent).frame(width: 10, height: 10).overlay(Circle().stroke(.white, lineWidth: 2))
            } else {
                TopoThumb()
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityHidden(true)
        .task(id: "\(place?.id ?? "")|\(colorScheme)") { await snapshot() }
    }

    private func snapshot() async {
        guard let place else { image = nil; return }
        let options = MKMapSnapshotter.Options()
        options.region = MKCoordinateRegion(center: place.coordinate, span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05))
        options.size = CGSize(width: 56, height: 56)
        options.scale = displayScale
        let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        configuration.pointOfInterestFilter = .excludingAll
        options.preferredConfiguration = configuration
        options.traitCollection = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
        image = try? await MKMapSnapshotter(options: options).start().image
    }
}

/// A small contour tile standing in for a map preview.
struct TopoThumb: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Palette.dynamic(0xE4EADF, 0x1F2A24))
            ForEach([30.0, 24, 18, 12, 6], id: \.self) { r in
                Ellipse().stroke(Palette.dynamic(0xAEBFA8, 0x3F5A4C), lineWidth: 1).frame(width: r * 1.8, height: r * 1.4).offset(x: 2, y: 3)
            }
            Image(systemName: "mappin").font(.system(size: 18, weight: .bold)).foregroundStyle(Palette.accent).offset(y: -4)
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityHidden(true)
    }
}
