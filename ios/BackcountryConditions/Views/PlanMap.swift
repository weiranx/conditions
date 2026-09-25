import MapKit
import SwiftUI

/// Map layers, as the web map's Topo / Street / Satellite switch. The choice carries across maps.
enum MapLayer: String, CaseIterable, Identifiable {
    case terrain = "Terrain", satellite = "Satellite", roads = "Roads"
    var id: String { rawValue }

    static let storageKey = "mapLayer"

    var style: MapStyle {
        switch self {
        case .terrain: .standard(elevation: .realistic, emphasis: .muted, pointsOfInterest: .including([.nationalPark, .park, .campground]))
        case .satellite: .hybrid(elevation: .realistic)
        case .roads: .standard
        }
    }
}

// MARK: - What a plan's map draws

/// How a pin is coloured: by the backend's decision for that place, or plain for a place of the plan
/// that no check covers (a trailhead, an exit, a checkpoint the route check found a forecast for).
enum MapTone: Int, Comparable {
    case place, go, unchecked, caution, stop

    init(_ level: DecisionLevel) {
        switch level {
        case .go: self = .go
        case .caution: self = .caution
        case .noGo: self = .stop
        case .unknown: self = .unchecked
        }
    }

    init(_ kind: TagKind) {
        switch kind {
        case .ok, .info: self = .go
        case .over: self = .caution
        case .stop: self = .stop
        case .missing: self = .unchecked
        }
    }

    var color: Color {
        switch self {
        case .place: Palette.accent
        case .go: Palette.accent
        case .unchecked: Palette.missing
        case .caution: Palette.caution
        case .stop: Palette.stop
        }
    }

    static func < (lhs: MapTone, rhs: MapTone) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// One pin: the objective, a checkpoint, or a trip's trailhead, camp, high point, exit or bail point.
struct MapPoint: Identifiable, Hashable {
    enum Kind { case objective, checkpoint, trailhead, camp, highPoint, exit, bail }

    var id: String
    var kind: Kind
    var lat: Double
    var lon: Double
    /// Drawn in the pin: a number, "X", "B". A symbol replaces it for the objective and trailhead.
    var glyph: String
    var symbol: String?
    var title: String
    var detail: String?
    var tone: MapTone

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    /// Pins at the same place (an out-and-back's way back, a layover night) share one.
    var placeKey: String { Self.placeKey(lat, lon) }

    static func placeKey(_ lat: Double, _ lon: Double) -> String { String(format: "%.4f,%.4f", lat, lon) }
}

/// A plan's map: its route or trip line and its places, coloured by the last check
/// (the web's `FieldMap` with its trip overlay, and `RouteMap`). Nothing here decides anything;
/// tones come from the backend's decisions, night checks and route check.
struct PlanMapModel {
    var points: [MapPoint] = []
    var line: [CLLocationCoordinate2D] = []
    /// The line only joins the plan's places; it isn't a mapped path.
    var lineEstimated = false

    init(plan: Plan, report: Report?, trip: TripResult?) {
        if plan.isTrip { buildTrip(plan, trip) } else { buildDay(plan, report) }
    }

    /// Changes when the map should be framed again.
    var key: String { points.map(\.id).joined(separator: "|") + "#\(line.count)" }

    var tones: [MapTone] { Array(Set(points.map(\.tone))).sorted() }

    /// Everything on the map, with room around it.
    var camera: MapCameraPosition {
        let coordinates = points.map(\.coordinate) + line
        guard let first = coordinates.first else { return .automatic }
        var rect = MKMapRect(origin: MKMapPoint(first), size: MKMapSize(width: 0, height: 0))
        for coordinate in coordinates.dropFirst() {
            rect = rect.union(MKMapRect(origin: MKMapPoint(coordinate), size: MKMapSize(width: 0, height: 0)))
        }
        // About 6 km across for a single place; a little room around a route.
        let minimum = 6000 * MKMapPointsPerMeterAtLatitude(first.latitude)
        let width = max(rect.size.width * 1.3, minimum)
        let height = max(rect.size.height * 1.3, minimum)
        return .rect(MKMapRect(x: rect.midX - width / 2, y: rect.midY - height / 2, width: width, height: height))
    }

    // MARK: Day plan

    private mutating func buildDay(_ plan: Plan, _ report: Report?) {
        let objective = plan.objective
        let level = report?.level ?? .unknown
        points.append(MapPoint(
            id: "objective", kind: .objective, lat: objective.lat, lon: objective.lon, glyph: "", symbol: "mountain.2.fill",
            title: objective.shortName,
            detail: [(report?.objectiveElevationFt ?? objective.elevationFt).map(Format.feet), report == nil ? "Not checked yet" : level.label]
                .compactMap { $0 }.joined(separator: " · "),
            tone: MapTone(level)))
        guard let route = plan.route else { return }

        if let gpx = route.gpx, gpx.displayTrack.count >= 2 {
            line = gpx.displayTrack.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        } else {
            line = (route.analysis?["routeGeometry"].array ?? []).compactMap { point in
                guard let lat = point["lat"].double, let lon = point["lon"].double else { return nil }
                return CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
        }

        // The route check's checkpoints (with arrivals), or the GPX's own before it runs.
        let waypoints = route.analysis?["waypoints"].array ?? []
        let summaries = route.analysis?["summaries"].array ?? []
        var checkpoints: [MapPoint] = waypoints.enumerated().compactMap { index, waypoint in
            guard let lat = waypoint["lat"].double, let lon = waypoint["lon"].double else { return nil }
            let summary = summaries.indices.contains(index) ? summaries[index] : .null
            let missing = summary["dataAvailable"].bool == false
            let detail = [(waypoint["elev_ft"].double ?? summary["elev_ft"].double).map(Format.feet),
                          summary["etaTime"].string.map { "about \(DateText.clock($0))" },
                          summary["leg"].string == "return" ? "on the way back" : nil,
                          missing ? "no forecast" : nil,
                          summary["locationEstimated"].bool == true || waypoint["locationEstimated"].bool == true ? "location estimated" : nil]
            return MapPoint(id: "checkpoint-\(index)", kind: .checkpoint, lat: lat, lon: lon, glyph: String(index + 1), symbol: nil,
                            title: waypoint["name"].string ?? "Checkpoint \(index + 1)",
                            detail: detail.compactMap { $0 }.joined(separator: " · "),
                            tone: missing ? .unchecked : .place)
        }
        if checkpoints.isEmpty, let gpx = route.gpx {
            checkpoints = gpx.checkpoints.enumerated().map { index, checkpoint in
                MapPoint(id: "checkpoint-\(index)", kind: .checkpoint, lat: checkpoint.lat, lon: checkpoint.lon, glyph: String(index + 1), symbol: nil,
                         title: checkpoint.name,
                         detail: [checkpoint.elevFt.map(Format.feet), Format.miles(checkpoint.distanceMiles)].compactMap { $0 }.joined(separator: " · "),
                         tone: .place)
            }
        }
        if line.count < 2, checkpoints.count >= 2 {
            line = checkpoints.map(\.coordinate)
            lineEstimated = true
        }
        // A checkpoint at the objective (the summit) is told on the objective's pin instead of covering it.
        let top = CLLocation(latitude: objective.lat, longitude: objective.lon)
        let atTop = checkpoints.filter { CLLocation(latitude: $0.lat, longitude: $0.lon).distance(from: top) < 150 }
        if !atTop.isEmpty, let detail = points[0].detail {
            points[0].detail = detail + "\nCheckpoint " + atTop.map(\.glyph).joined(separator: ", ")
        }
        points.append(contentsOf: Self.merged(checkpoints.filter { checkpoint in !atTop.contains { $0.id == checkpoint.id } }))
    }

    // MARK: Multi-day trip

    private mutating func buildTrip(_ plan: Plan, _ trip: TripResult?) {
        guard let stages = plan.stages, let first = stages.first, let last = stages.last else { return }
        let assessedDays = trip?.itinerary?.at("assessment.days")

        let trailhead = first.from
        let exit = last.to
        let loop = MapPoint.placeKey(trailhead.lat, trailhead.lon) == MapPoint.placeKey(exit.lat, exit.lon)
        points.append(MapPoint(id: "trailhead", kind: .trailhead, lat: trailhead.lat, lon: trailhead.lon, glyph: "", symbol: "figure.hiking",
                               title: trailhead.shortName, detail: loop ? "Trailhead and exit" : "Trailhead", tone: .place))

        var camps: [MapPoint] = []
        var path = [trailhead.coordinate]
        for index in stages.indices.dropLast() {
            let camp = stages[index].to
            if !stages[index].isLayover { path.append(camp.coordinate) }
            let night = TripNight(trip: trip, index: index)
            camps.append(MapPoint(id: "camp-\(index)", kind: .camp, lat: camp.lat, lon: camp.lon, glyph: String(index + 1), symbol: nil,
                                  title: camp.shortName,
                                  detail: "Night \(index + 1)\(stages[index].isLayover ? " (layover)" : "") · \(night.word)",
                                  tone: trip == nil ? .place : MapTone(night.kind)))
        }
        points.append(contentsOf: Self.merged(camps))
        if !loop {
            path.append(exit.coordinate)
            points.append(MapPoint(id: "exit", kind: .exit, lat: exit.lat, lon: exit.lon, glyph: "X", symbol: nil,
                                   title: exit.shortName, detail: "Exit, day \(stages.count)", tone: .place))
        } else {
            path.append(trailhead.coordinate)
        }

        for (dayIndex, stage) in stages.enumerated() {
            for (index, checkpoint) in (stage.checkpoints ?? []).enumerated() {
                var tone = MapTone.place
                var word: String?
                if trip != nil {
                    let level = DecisionLevel(assessedDays?[dayIndex]["checkpoints"][index].at("day.decisionLevel").string)
                    tone = MapTone(level)
                    word = level.label
                }
                points.append(MapPoint(id: "high-\(dayIndex)-\(index)", kind: .highPoint, lat: checkpoint.lat, lon: checkpoint.lon, glyph: "▲", symbol: nil,
                                       title: checkpoint.shortName,
                                       detail: ["High point, day \(dayIndex + 1)", checkpoint.elevationFt.map(Format.feet), word].compactMap { $0 }.joined(separator: " · "),
                                       tone: tone))
            }
        }

        for (index, bail) in (plan.bailPoints ?? []).enumerated() {
            points.append(MapPoint(id: "bail-\(index)", kind: .bail, lat: bail.lat, lon: bail.lon, glyph: "B", symbol: nil,
                                   title: bail.shortName, detail: "Way out", tone: .place))
        }

        if let track = plan.tripTrack, track.count >= 2 {
            line = track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        } else {
            line = path
            lineEstimated = true
        }
    }

    /// One pin per place: "1·5" for a checkpoint passed twice, "2·3" for a layover's nights,
    /// coloured by the worst of them.
    private static func merged(_ points: [MapPoint]) -> [MapPoint] {
        var order: [String] = []
        var byPlace: [String: [MapPoint]] = [:]
        for point in points {
            if byPlace[point.placeKey] == nil { order.append(point.placeKey) }
            byPlace[point.placeKey, default: []].append(point)
        }
        return order.compactMap { key in
            guard let group = byPlace[key], var point = group.first else { return nil }
            guard group.count > 1 else { return point }
            point.glyph = group.map(\.glyph).joined(separator: "·")
            point.tone = group.map(\.tone).max() ?? point.tone
            point.detail = group.compactMap(\.detail).joined(separator: "\n")
            return point
        }
    }
}

// MARK: - Drawing

/// The line, then the pins, so pins sit above it.
struct PlanMapContent: MapContent {
    var model: PlanMapModel
    var selection: String?
    var titles: Visibility = .automatic

    var body: some MapContent {
        if model.line.count >= 2 {
            if model.lineEstimated {
                MapPolyline(coordinates: model.line)
                    .stroke(Palette.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round, dash: [6, 6]))
            } else {
                MapPolyline(coordinates: model.line)
                    .stroke(Palette.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
        }
        ForEach(model.points) { point in
            Annotation(point.title, coordinate: point.coordinate, anchor: .center) {
                MapPin(point: point, selected: selection == point.id)
            }
            .annotationTitles(titles)
            .tag(point.id)
        }
    }
}

/// A round pin in the tone's colour, with a number, a letter or a symbol.
struct MapPin: View {
    var point: MapPoint
    var selected = false

    private var size: CGFloat {
        switch point.kind {
        case .objective: 32
        case .trailhead, .camp: 26
        default: 24
        }
    }

    /// Places no check covers are white with a green rim, so they don't read as "not checked".
    private var plain: Bool { point.tone == .place }

    var body: some View {
        ZStack {
            Circle().fill(plain ? Palette.surface : point.tone.color)
            if let symbol = point.symbol {
                Image(systemName: symbol).font(.system(size: size * 0.45, weight: .semibold))
            } else {
                Text(point.glyph)
                    .font(.system(size: point.glyph.count > 2 ? 9 : 12, weight: .bold))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(.horizontal, 2)
            }
        }
        .foregroundStyle(plain ? Palette.accent : Palette.onAccent)
        .frame(width: point.glyph.count > 3 ? size + 10 : size, height: size)
        .overlay(Circle().stroke(plain ? Palette.accent : Palette.surface, lineWidth: 2))
        .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
        .scaleEffect(selected ? 1.3 : 1)
        .animation(.snappy(duration: 0.2), value: selected)
        .accessibilityLabel([point.title, point.detail].compactMap { $0 }.joined(separator: ", "))
    }
}

// MARK: - Preview and full screen

/// A still map of the plan in a card; tapping it opens the map full screen.
struct PlanMapPreview: View {
    var title: String
    var model: PlanMapModel
    var height: CGFloat = 200
    @AppStorage(MapLayer.storageKey) private var layer: MapLayer = .terrain
    @State private var open = false

    var body: some View {
        Map(initialPosition: model.camera, interactionModes: []) {
            PlanMapContent(model: model, titles: .hidden)
        }
        .mapStyle(layer.style)
        .id(model.key)
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay {
            // Above the map, so the tap reaches the button rather than MapKit.
            Button { open = true } label: { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityLabel("Open the map of \(title)")
        }
        .overlay(alignment: .topTrailing) {
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.footnote.weight(.semibold))
                .padding(8)
                .glassEffect(.regular, in: Circle())
                .padding(8)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .fullScreenCover(isPresented: $open) { PlanMapScreen(title: title, model: model) }
    }
}

/// The plan's map full screen: move and zoom it, switch layers, tap a pin for what it is.
struct PlanMapScreen: View {
    @Environment(\.dismiss) private var dismiss
    var title: String
    var model: PlanMapModel
    @AppStorage(MapLayer.storageKey) private var layer: MapLayer = .terrain
    @State private var position: MapCameraPosition = .automatic
    @State private var selection: String?

    private var selected: MapPoint? { model.points.first { $0.id == selection } }

    var body: some View {
        NavigationStack {
            Map(position: $position, selection: $selection) {
                PlanMapContent(model: model, selection: selection)
                UserAnnotation()
            }
            .mapStyle(layer.style)
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapPitchToggle()
                MapScaleView()
            }
            .safeAreaInset(edge: .bottom) { panel }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Show the whole plan", systemImage: "arrow.down.right.and.arrow.up.left") {
                        withAnimation { position = model.camera }
                    }
                }
            }
            .onAppear {
                position = model.camera
                LocationProvider.shared.requestPermission()
            }
        }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let selected {
                HStack(alignment: .top, spacing: 12) {
                    MapPin(point: selected)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(selected.title).font(.headline).lineLimit(2)
                        if let detail = selected.detail, !detail.isEmpty {
                            Text(detail).font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    Button("Directions", systemImage: "arrow.triangle.turn.up.right.diamond") { directions(to: selected) }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .accessibilityLabel("Directions in Maps")
                }
            } else {
                MapLegend(tones: model.tones, estimated: model.lineEstimated && model.line.count >= 2)
            }
            Picker("Map layer", selection: $layer) {
                ForEach(MapLayer.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(14)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .animation(.snappy(duration: 0.2), value: selection)
    }

    private func directions(to point: MapPoint) {
        let item = MKMapItem(location: CLLocation(latitude: point.lat, longitude: point.lon), address: nil)
        item.name = point.title
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }
}

/// What the pin colours mean, for the tones on this map.
struct MapLegend: View {
    var tones: [MapTone]
    var estimated = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if tones.contains(where: { $0 != .place }) {
                HStack(spacing: 12) {
                    ForEach(tones.filter { $0 != .place }, id: \.self) { tone in
                        HStack(spacing: 5) {
                            Circle().fill(tone.color).frame(width: 10, height: 10)
                            Text(Self.label(tone)).font(.caption)
                        }
                    }
                }
            }
            Text(estimated ? "Tap a pin for details. The dashed line joins the plan’s places; it isn’t a mapped trail."
                           : "Tap a pin for details. Move or zoom the map with your fingers.")
                .font(.caption)
                .foregroundStyle(Palette.secondary)
        }
    }

    private static func label(_ tone: MapTone) -> String {
        switch tone {
        case .place: "Place"
        case .go: "Go"
        case .unchecked: "Not checked"
        case .caution: "Caution"
        case .stop: "No-go"
        }
    }
}

// MARK: - Every plan

/// The Plan tab's map: each plan at its objective, coloured by the backend's decision.
/// Plans at the same place (the same peak on different dates) share a pin that lists them all.
struct PlansMapScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var store
    var openBrief: (UUID) -> Void
    @AppStorage(MapLayer.storageKey) private var layer: MapLayer = .terrain
    @State private var position: MapCameraPosition = .automatic
    @State private var selection: String?
    @State private var includePast = false

    private struct PlanGroup: Identifiable {
        var id: String
        var plans: [Plan]
        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: plans[0].objective.lat, longitude: plans[0].objective.lon) }
    }

    private var plans: [Plan] { includePast ? store.upcoming + store.past : store.upcoming }

    /// Plans within about 100 m of each other, in list order.
    private var groups: [PlanGroup] {
        var order: [String] = []
        var byPlace: [String: [Plan]] = [:]
        for plan in plans {
            let key = String(format: "%.3f,%.3f", plan.objective.lat, plan.objective.lon)
            if byPlace[key] == nil { order.append(key) }
            byPlace[key, default: []].append(plan)
        }
        return order.compactMap { key in byPlace[key].map { PlanGroup(id: key, plans: $0) } }
    }

    private var selected: PlanGroup? { groups.first { $0.id == selection } }

    var body: some View {
        NavigationStack {
            Map(position: $position, selection: $selection) {
                ForEach(groups) { group in
                    Annotation(title(group), coordinate: group.coordinate, anchor: .center) {
                        MapPin(point: pin(group), selected: selection == group.id)
                    }
                    .tag(group.id)
                }
                UserAnnotation()
            }
            .mapStyle(layer.style)
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
            }
            .safeAreaInset(edge: .bottom) { panel }
            .navigationTitle("Your plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                if !store.past.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Toggle("Past plans", systemImage: "clock.arrow.circlepath", isOn: $includePast.animation())
                    }
                }
            }
            .onChange(of: includePast) {
                if selected == nil { selection = nil }
                withAnimation { position = .automatic }
            }
        }
    }

    private func tone(_ plan: Plan) -> MapTone {
        let checked = plan.isTrip ? store.trip(plan) != nil : store.report(plan) != nil
        return checked ? MapTone(store.level(plan)) : .unchecked
    }

    private func title(_ group: PlanGroup) -> String {
        group.plans.count == 1 ? group.plans[0].title : "\(group.plans[0].objective.shortName) · \(group.plans.count) plans"
    }

    /// One plan shows its kind; several show how many, in the worst tone among them.
    private func pin(_ group: PlanGroup) -> MapPoint {
        let first = group.plans[0]
        let several = group.plans.count > 1
        return MapPoint(id: group.id, kind: .objective, lat: first.objective.lat, lon: first.objective.lon,
                        glyph: several ? String(group.plans.count) : "",
                        symbol: several ? nil : first.isTrip ? "tent.fill" : "mountain.2.fill",
                        title: title(group), detail: nil,
                        tone: group.plans.map(tone).max() ?? .unchecked)
    }

    private func card(_ plan: Plan) -> some View {
        Button {
            dismiss()
            openBrief(plan.id)
        } label: {
            PlanCard(plan: plan)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the brief")
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let selected {
                if selected.plans.count == 1 {
                    card(selected.plans[0])
                } else {
                    Text("\(selected.plans.count) plans here").font(.subheadline.weight(.semibold))
                    ScrollView {
                        VStack(spacing: 8) { ForEach(selected.plans) { card($0) } }
                    }
                    .frame(maxHeight: 340)
                    .scrollBounceBehavior(.basedOnSize)
                }
            } else if plans.isEmpty {
                Text(includePast ? "No plans to show." : "No upcoming plans. Turn on past plans to see the rest.")
                    .font(.footnote).foregroundStyle(Palette.secondary)
            } else {
                MapLegend(tones: Array(Set(plans.map(tone))).sorted())
            }
            Picker("Map layer", selection: $layer) {
                ForEach(MapLayer.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(14)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .animation(.snappy(duration: 0.2), value: selection)
    }
}
