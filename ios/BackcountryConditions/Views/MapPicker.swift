import CoreLocation
import MapKit
import SwiftUI

/// Another point of the plan, drawn on a picker's map for context: "Trailhead", "Night 1".
struct PlaceLandmark: Hashable {
    var label: String
    var place: Place
}

/// Picks a point on a map: tap to drop a pin, or search to jump to a place (the web's objective map).
struct MapPicker: View {
    @Environment(\.dismiss) private var dismiss
    var title: String
    /// Where to bias the search and measure from, such as last night's camp when choosing the next.
    var around: Place?
    /// Other points of the plan (trailhead, camps).
    var context: [PlaceLandmark] = []
    /// An imported trip's track, so camps can be dropped along it.
    var track: [TrackCoordinate] = []
    /// The trip's stops in order. Without a track, a dashed line joins them to show the way.
    var legs: [Place] = []
    /// The point being changed, shown selected when the map opens.
    var current: Place? = nil
    var onPick: (Place) -> Void

    @AppStorage(MapLayer.storageKey) private var layer: MapLayer = .terrain
    @State private var position: MapCameraPosition = .automatic
    @State private var chosen: Place?
    /// A dropped pin is being named after the nearest place.
    @State private var naming = false
    @State private var search = PlaceSearch()
    @State private var searching = false

    var body: some View {
        NavigationStack {
            MapReader { proxy in
                Map(position: $position) {
                    if trackCoordinates.count > 1 {
                        MapPolyline(coordinates: trackCoordinates)
                            .stroke(Palette.accent.opacity(0.7), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    } else if legs.count > 1 {
                        MapPolyline(coordinates: legs.map(\.coordinate))
                            .stroke(Palette.accent.opacity(0.6), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round, dash: [6, 6]))
                    }
                    ForEach(context, id: \.self) { landmark in
                        Marker(landmark.label, systemImage: "mappin", coordinate: landmark.place.coordinate)
                            .tint(Palette.secondary)
                    }
                    if let chosen {
                        Marker(label(chosen), systemImage: "mappin.and.ellipse", coordinate: chosen.coordinate)
                            .tint(Palette.accent)
                    }
                    UserAnnotation()
                }
                .mapStyle(layer.style)
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                    MapScaleView()
                }
                .onTapGesture { point in
                    if let coordinate = snapped(point, proxy: proxy) ?? proxy.convert(point, from: .local) { drop(at: coordinate) }
                }
            }
            .safeAreaInset(edge: .bottom) { panel }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search.query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Jump to a place or coordinates")
            .searchSuggestions { suggestions }
            .onChange(of: search.query) { search.run() }
            .onSubmit(of: .search) {
                if let first = Place.coordinates(in: search.query) ?? search.results.first { choose(first) } else { search.run(now: true) }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                if routeRegion != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Show the route", systemImage: "arrow.down.right.and.arrow.up.left") {
                            if let routeRegion { withAnimation { position = .region(routeRegion) } }
                        }
                    }
                }
            }
            .onAppear {
                search.near = around
                search.showsPopular = false
                chosen = current
                position = initialPosition
                LocationProvider.shared.requestPermission()
            }
        }
    }

    private var trackCoordinates: [CLLocationCoordinate2D] {
        track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
    }

    /// The whole trip: its track and stops so far, and the point being changed. A lone point opens
    /// wide enough to see the country around it.
    private var routeRegion: MKCoordinateRegion? {
        let points = trackCoordinates + (legs + context.map(\.place) + [around, current].compactMap { $0 }).map(\.coordinate)
        return MKCoordinateRegion(fitting: points, minimumSpan: 0.2)
    }

    private var initialPosition: MapCameraPosition {
        if let routeRegion { return .region(routeRegion) }
        if let here = LocationProvider.shared.lastKnown {
            return .region(MKCoordinateRegion(center: here.coordinate, span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)))
        }
        return .userLocation(fallback: .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 39.5, longitude: -110),
                                                                  span: MKCoordinateSpan(latitudeDelta: 20, longitudeDelta: 20))))
    }

    @ViewBuilder private var suggestions: some View {
        if let typed = Place.coordinates(in: search.query) {
            Button { choose(typed) } label: { Label("Go to \(typed.name)", systemImage: "scope") }
        }
        ForEach(search.results) { place in
            Button { choose(place) } label: { PlaceRow(place: place, from: around) }
                .buttonStyle(.plain)
        }
        if search.noMatches && Place.coordinates(in: search.query) == nil {
            Text("No places match “\(search.searched)”. Try a nearby peak or lake, or enter latitude, longitude.")
                .font(.footnote).foregroundStyle(Palette.secondary)
        }
    }

    private var panel: some View {
        VStack(spacing: 10) {
            Picker("Map layer", selection: $layer) {
                ForEach(MapLayer.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            if let chosen {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(label(chosen)).font(.headline).lineLimit(1)
                        Text(details(chosen)).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Button("Use this point") {
                        onPick(chosen)
                        dismiss()
                    }
                    .buttonStyle(.glassProminent).tint(Palette.prominent)
                    .fixedSize()
                }
            } else {
                Text(trackCoordinates.count > 1 ? "Tap along the route to drop a pin; taps near the track snap onto it. Or search to jump to a place."
                                                : "Tap the map to drop a pin, or search to jump to a place.")
                    .font(.footnote).foregroundStyle(Palette.secondary)
            }
        }
        .padding(14)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    /// A pin with no nearby feature name is just a dropped pin; its coordinates are in the details.
    private func label(_ place: Place) -> String {
        naming || Place.coordinates(in: place.name) != nil ? "Dropped pin" : place.shortName
    }

    private func details(_ place: Place) -> String {
        var parts = [place.elevationFt.map(Format.feet), String(format: "%.4f, %.4f", place.lat, place.lon)]
        if let around, around.id != place.id { parts.append("\(Format.miles(place.miles(from: around))) from \(around.shortName)") }
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    /// A search result or typed coordinates: select it and move the map there.
    private func choose(_ place: Place) {
        searching = false
        search.query = ""
        withAnimation {
            position = .region(MKCoordinateRegion(center: place.coordinate, span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)))
        }
        if place.kind == "Pin" { drop(at: place.coordinate) } else { chosen = place; naming = false }
    }

    /// The track point nearest a tap, when the tap lands within a finger's width of the track.
    private func snapped(_ point: CGPoint, proxy: MapProxy) -> CLLocationCoordinate2D? {
        var best: (coordinate: CLLocationCoordinate2D, distance: CGFloat)?
        for coordinate in trackCoordinates {
            guard let screen = proxy.convert(coordinate, to: .local) else { continue }
            let distance = hypot(screen.x - point.x, screen.y - point.y)
            if distance < (best?.distance ?? 22) { best = (coordinate, distance) }
        }
        return best?.coordinate
    }

    private func drop(at coordinate: CLLocationCoordinate2D) {
        let pin = Place.pin(lat: (coordinate.latitude * 1e5).rounded() / 1e5, lon: (coordinate.longitude * 1e5).rounded() / 1e5)
        chosen = pin
        naming = true
        Task { await describe(pin) }
    }

    /// Names a dropped pin after the nearest place, when there is one.
    private func describe(_ pin: Place) async {
        let name = await pin.nearbyName()
        guard chosen == pin else { return }
        if let name { chosen?.name = name }
        naming = false
    }
}

extension Place {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }

    func miles(from other: Place) -> Double {
        CLLocation(latitude: lat, longitude: lon).distance(from: CLLocation(latitude: other.lat, longitude: other.lon)) / 1609.344
    }

    /// The nearest named place MapKit knows: a feature's name, or else, with `town`, the town
    /// ("Near Bishop, CA"). Only where you stand gets the town: in the backcountry the nearest one
    /// can be forty miles off.
    func nearbyName(town includeTown: Bool = false) async -> String? {
        guard let request = MKReverseGeocodingRequest(location: CLLocation(latitude: lat, longitude: lon)),
              let item = try? await request.mapItems.first else { return nil }
        let town = item.addressRepresentations?.cityWithContext
        // A street address says little about a mountain plan; the town says where it is.
        let address = [item.address?.fullAddress, item.address?.shortAddress].compactMap { $0 }
        if let name = item.name, !name.isEmpty, name != town, name.first?.isNumber != true, !address.contains(where: { $0.hasPrefix(name) }) { return name }
        return includeTown ? town.map { "Near \($0)" } : nil
    }

    /// Typed coordinates as a pin, like the web's `parseCoordinates`: "37.5, -118.2", "37.5 -118.2" or "37.5° N, 118.2° W".
    static func coordinates(in text: String) -> Place? {
        let pattern = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSns])?(?:\s*,\s*|\s+)(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWew])?\s*$/
        guard let match = text.wholeMatch(of: pattern), var lat = Double(match.1), var lon = Double(match.3) else { return nil }
        if match.2?.uppercased() == "S" { lat = -abs(lat) }
        if match.4?.uppercased() == "W" { lon = -abs(lon) }
        guard (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
        return .pin(lat: lat, lon: lon)
    }
}

extension MKCoordinateRegion {
    /// The region around some points, with a margin and at least `minimumSpan` degrees; nil without any.
    init?(fitting points: [CLLocationCoordinate2D], minimumSpan: Double = 0.08) {
        guard let first = points.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude, minLon = first.longitude, maxLon = first.longitude
        for point in points {
            minLat = min(minLat, point.latitude); maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude); maxLon = max(maxLon, point.longitude)
        }
        self.init(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
                  span: MKCoordinateSpan(latitudeDelta: max(minimumSpan, (maxLat - minLat) * 1.5), longitudeDelta: max(minimumSpan, (maxLon - minLon) * 1.5)))
    }
}

/// The traveler's location, for "Use my location".
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    static let shared = LocationProvider()
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private var authorization: CheckedContinuation<Void, Never>?
    private var request = 0
    private(set) var status: CLAuthorizationStatus

    override private init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// The last fix the phone had, when access is on.
    var lastKnown: CLLocation? { manager.location }

    /// Location access was turned off, so only Settings can bring it back.
    var isDenied: Bool { status == .denied || status == .restricted }

    func requestPermission() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
    }

    /// Where the phone is, asking for access first if it hasn't been asked. Nil when access is off
    /// or no fix arrives within 15 seconds.
    func current() async -> CLLocation? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { continuation in
                authorization?.resume()
                authorization = continuation
                manager.requestWhenInUseAuthorization()
            }
        }
        status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return nil }
        // A fix from the last couple of minutes is as good as a new one, and instant.
        if let recent = manager.location, recent.timestamp.timeIntervalSinceNow > -120, recent.horizontalAccuracy >= 0, recent.horizontalAccuracy < 500 {
            return recent
        }
        request += 1
        let id = request
        return await withCheckedContinuation { continuation in
            self.continuation?.resume(returning: nil)
            self.continuation = continuation
            manager.requestLocation()
            Task {
                try? await Task.sleep(for: .seconds(15))
                if request == id { finish(nil) }
            }
        }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        Task { @MainActor in self.finish(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.status = status
            guard status != .notDetermined else { return }
            self.authorization?.resume()
            self.authorization = nil
        }
    }
}
