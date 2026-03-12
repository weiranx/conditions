import SwiftUI
import MapKit

struct MapCard: View {
    let lat: Double
    let lon: Double
    let objectiveName: String
    var elevationFt: Double?
    var elevationUnit: UserPreferences.ElevationUnit = .feet
    var onTapLocation: ((Double, Double) -> Void)?

    @State private var mapStyle: MapStyleOption = .standard
    @State private var position: MapCameraPosition

    init(lat: Double, lon: Double, objectiveName: String, elevationFt: Double? = nil, elevationUnit: UserPreferences.ElevationUnit = .feet, onTapLocation: ((Double, Double) -> Void)? = nil) {
        self.lat = lat
        self.lon = lon
        self.objectiveName = objectiveName
        self.elevationFt = elevationFt
        self.elevationUnit = elevationUnit
        self.onTapLocation = onTapLocation
        _position = State(initialValue: .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
        )))
    }

    var body: some View {
        VStack(spacing: 0) {
            Map(position: $position, interactionModes: [.pan, .zoom]) {
                Annotation("", coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon)) {
                    VStack(spacing: 2) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.red)
                            .background(Circle().fill(.white).frame(width: 18, height: 18))

                        Text(objectiveName)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.ultraThinMaterial, in: Capsule())
                            .lineLimit(1)
                    }
                }
            }
            .mapStyle(mapStyle.style)
            .frame(height: 220)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
            .overlay(alignment: .topTrailing) {
                mapStyleToggle
                    .padding(8)
            }
            .overlay(alignment: .bottomTrailing) {
                recenterButton
                    .padding(8)
            }

            coordinateBar
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .onChange(of: lat) { _, _ in recenter() }
        .onChange(of: lon) { _, _ in recenter() }
    }

    private func recenter() {
        withAnimation {
            position = .region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
            ))
        }
    }

    private var mapStyleToggle: some View {
        Menu {
            ForEach(MapStyleOption.allCases) { option in
                Button {
                    withAnimation { mapStyle = option }
                } label: {
                    Label(option.label, systemImage: option.icon)
                }
            }
        } label: {
            Image(systemName: "map")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 32, height: 32)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private var recenterButton: some View {
        Button {
            withAnimation {
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
                ))
            }
        } label: {
            Image(systemName: "location.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.blue)
                .frame(width: 32, height: 32)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private var coordinateBar: some View {
        HStack {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            Text(String(format: "%.4f°%@, %.4f°%@", abs(lat), lat >= 0 ? "N" : "S", abs(lon), lon >= 0 ? "E" : "W"))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Spacer()
            if let elev = elevationFt {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .semibold))
                    Text(formatElevation(elev, unit: elevationUnit))
                        .font(.caption.weight(.medium))
                }
                .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Map Style Options

private enum MapStyleOption: String, CaseIterable, Identifiable {
    case standard
    case satellite
    case hybrid

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: "Standard"
        case .satellite: "Satellite"
        case .hybrid: "Hybrid"
        }
    }

    var icon: String {
        switch self {
        case .standard: "map"
        case .satellite: "globe.americas"
        case .hybrid: "square.stack.3d.up"
        }
    }

    var style: MapStyle {
        switch self {
        case .standard: .standard(elevation: .realistic)
        case .satellite: .imagery(elevation: .realistic)
        case .hybrid: .hybrid(elevation: .realistic)
        }
    }
}
