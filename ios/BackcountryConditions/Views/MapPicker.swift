import CoreLocation
import MapKit
import SwiftUI

/// Picks a point on a map: tap to drop a pin, then use it (the web's objective map).
struct MapPicker: View {
    @Environment(\.dismiss) private var dismiss
    var title: String
    var around: Place?
    /// Other points of the plan, drawn for context (trailhead, camps).
    var context: [Place] = []
    var onPick: (Place) -> Void

    enum Style: String, CaseIterable, Identifiable {
        case terrain = "Terrain", satellite = "Satellite", roads = "Roads"
        var id: String { rawValue }
    }

    @State private var pin: CLLocationCoordinate2D?
    @State private var style: Style = .terrain
    @State private var position: MapCameraPosition = .automatic
    @State private var name = ""
    @State private var elevation: Double?

    var body: some View {
        NavigationStack {
            MapReader { proxy in
                Map(position: $position) {
                    ForEach(Array(context.enumerated()), id: \.offset) { _, place in
                        Marker(place.shortName, systemImage: "mappin", coordinate: CLLocationCoordinate2D(latitude: place.lat, longitude: place.lon))
                            .tint(Palette.secondary)
                    }
                    if let pin {
                        Marker(name.isEmpty ? "Dropped pin" : name, systemImage: "mappin.and.ellipse", coordinate: pin).tint(Palette.accent)
                    }
                    UserAnnotation()
                }
                .mapStyle(mapStyle)
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                    MapScaleView()
                }
                .onTapGesture { point in
                    if let coordinate = proxy.convert(point, from: .local) {
                        pin = coordinate
                        name = ""
                        elevation = nil
                        Task { await describe(coordinate) }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    Picker("Map layer", selection: $style) {
                        ForEach(Style.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if let pin {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(name.isEmpty ? String(format: "%.4f°, %.4f°", pin.latitude, pin.longitude) : name).font(.headline)
                                Text(String(format: "%.4f°, %.4f°", pin.latitude, pin.longitude)).font(.caption).foregroundStyle(Palette.secondary)
                            }
                            Spacer()
                            Button("Use this point") {
                                onPick(Place(name: name.isEmpty ? String(format: "%.4f, %.4f", pin.latitude, pin.longitude) : name,
                                             lat: (pin.latitude * 1e5).rounded() / 1e5, lon: (pin.longitude * 1e5).rounded() / 1e5,
                                             elevationFt: elevation, kind: "Pin"))
                                dismiss()
                            }
                            .buttonStyle(.glassProminent).tint(Palette.prominent)
                        }
                    } else {
                        Text("Tap the map to select a point. Move or zoom it with two fingers.").font(.footnote).foregroundStyle(Palette.secondary)
                    }
                }
                .padding(14)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel", systemImage: "xmark") { dismiss() } } }
            .onAppear {
                if let around {
                    position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: around.lat, longitude: around.lon),
                                                          span: MKCoordinateSpan(latitudeDelta: 0.25, longitudeDelta: 0.25)))
                } else {
                    position = .userLocation(fallback: .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 39.5, longitude: -110),
                                                                                    span: MKCoordinateSpan(latitudeDelta: 20, longitudeDelta: 20))))
                }
                LocationProvider.shared.requestPermission()
            }
        }
    }

    private var mapStyle: MapStyle {
        switch style {
        case .terrain: .standard(elevation: .realistic, emphasis: .muted, pointsOfInterest: .including([.nationalPark, .park, .campground]))
        case .satellite: .hybrid(elevation: .realistic)
        case .roads: .standard
        }
    }

    /// Names a dropped pin after the nearest place, when there is one.
    private func describe(_ coordinate: CLLocationCoordinate2D) async {
        guard let request = MKReverseGeocodingRequest(location: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)),
              let item = try? await request.mapItems.first else { return }
        guard pin?.latitude == coordinate.latitude else { return }
        name = item.name ?? ""
    }
}

/// The traveler's location, for "Use my location".
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    static let shared = LocationProvider()
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestPermission() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
    }

    func current() async -> CLLocation? {
        requestPermission()
        return await withCheckedContinuation { continuation in
            self.continuation?.resume(returning: nil)
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        Task { @MainActor in
            self.continuation?.resume(returning: location)
            self.continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.continuation?.resume(returning: nil)
            self.continuation = nil
        }
    }
}
