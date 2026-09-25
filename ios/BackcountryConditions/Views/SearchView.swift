import SwiftUI

/// Searches `/api/search`: the local peak catalog first, then OpenStreetMap places.
@Observable
final class PlaceSearch {
    var query = ""
    private(set) var results: [Place] = []
    private(set) var searching = false
    private(set) var error: String?
    private(set) var searched = ""
    private var task: Task<Void, Never>?
    private var generation = 0
    /// Biases results toward a place, such as the trailhead when choosing a camp.
    var near: Place?

    /// Searches for the current query, after a pause in typing unless `now`.
    func run(now: Bool = false) {
        task?.cancel()
        generation += 1
        let current = generation
        let text = query.trimmingCharacters(in: .whitespaces)
        task = Task {
            try? await Task.sleep(for: .milliseconds(text.isEmpty || now ? 0 : 300))
            guard current == generation else { return }
            searching = true
            do {
                let found = try await APIClient().search(text, near: near.map { ($0.lat, $0.lon) })
                guard current == generation else { return }
                results = found
                error = nil
            } catch {
                guard current == generation else { return }
                self.error = error.localizedDescription
                results = []
            }
            searched = text
            searching = false
        }
    }

    /// True once a typed query has come back with nothing.
    var noMatches: Bool {
        !searching && error == nil && results.isEmpty && !searched.isEmpty && searched == query.trimmingCharacters(in: .whitespaces)
    }
}

struct PlaceRow: View {
    var place: Place

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: place.kind?.localizedCaseInsensitiveContains("peak") == true ? "mountain.2" : "mappin.and.ellipse")
                .font(.body)
                .foregroundStyle(Palette.accent)
                .frame(width: 36, height: 36)
                .background(Palette.fill, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(place.shortName).font(.body.weight(.semibold)).foregroundStyle(Palette.label)
                Text([place.kind, place.elevationFt.map(Format.feet), place.region].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Palette.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

/// A sheet for choosing an objective or camp: search, the map, your location, or a recent place.
struct PlacePicker: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var store
    var title: String
    /// Where to center the map and bias the search.
    var near: Place? = nil
    var context: [Place] = []
    var onPick: (Place) -> Void
    @State private var search = PlaceSearch()
    @State private var mapOpen = false
    @State private var locating = false
    @State private var locationError: String?

    private var recents: [Place] {
        var seen = Set<String>()
        return store.plans.sorted { $0.createdAt > $1.createdAt }.map(\.objective).filter { seen.insert($0.id).inserted }.prefix(5).map { $0 }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error = search.error {
                    Text(error).font(.footnote).foregroundStyle(Palette.caution)
                }
                if search.query.isEmpty {
                    Section {
                        Button { mapOpen = true } label: { Label("Choose on the map", systemImage: "map") }
                        Button { Task { await useLocation() } } label: {
                            Label(locating ? "Finding you…" : "Use my location", systemImage: "location")
                        }
                        .disabled(locating)
                        if let locationError { Text(locationError).font(.footnote).foregroundStyle(Palette.caution) }
                    }
                    if !recents.isEmpty {
                        Section("Recent") {
                            ForEach(recents) { place in
                                Button { onPick(place); dismiss() } label: { PlaceRow(place: place) }
                            }
                        }
                    }
                }
                Section(search.query.isEmpty ? "Popular peaks" : "Results") {
                    ForEach(search.results) { place in
                        Button { onPick(place); dismiss() } label: { PlaceRow(place: place) }
                    }
                    if search.searching && search.results.isEmpty { ProgressView() }
                    if search.noMatches {
                        Text("No places match “\(search.searched)”. Try a nearby peak, lake or trailhead, or choose on the map.")
                            .font(.footnote).foregroundStyle(Palette.secondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.bg)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Peak, trailhead or place")
            .onChange(of: search.query) { search.run() }
            .onSubmit(of: .search) { search.run(now: true) }
            .onAppear { search.near = near; search.run() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel", systemImage: "xmark") { dismiss() } }
            }
            .fullScreenCover(isPresented: $mapOpen) {
                MapPicker(title: title, around: near, context: context) { place in
                    onPick(place)
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func useLocation() async {
        locating = true
        defer { locating = false }
        guard let place = await Place.current() else {
            locationError = Place.locationUnavailable
            return
        }
        onPick(place)
        dismiss()
    }
}

extension Place {
    /// Where the phone is now, as a place to plan from.
    static func current() async -> Place? {
        guard let location = await LocationProvider.shared.current() else { return nil }
        return Place(name: "My location", lat: (location.coordinate.latitude * 1e5).rounded() / 1e5, lon: (location.coordinate.longitude * 1e5).rounded() / 1e5,
                     elevationFt: location.verticalAccuracy >= 0 ? location.altitude * 3.28084 : nil, kind: "Location")
    }

    static let locationUnavailable = "Your location isn’t available. Allow location access for Conditions in Settings, or choose on the map."
}

/// The Search tab: find an objective, then plan it.
struct SearchView: View {
    var onPlan: (Place) -> Void
    @State private var search = PlaceSearch()
    @State private var mapOpen = false
    @State private var pinned: Place?
    @State private var locating = false
    @State private var locationError: String?

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Search", title: "Find an objective", subtitle: "Peaks, trailheads and places across the US.")
                Spacer().frame(height: 22)
                if search.query.isEmpty {
                    HStack(spacing: 10) {
                        Button { mapOpen = true } label: { Label("On the map", systemImage: "map").frame(maxWidth: .infinity) }
                        Button { Task { await useLocation() } } label: {
                            Label(locating ? "Finding you…" : "My location", systemImage: "location").frame(maxWidth: .infinity)
                        }
                        .disabled(locating)
                    }
                    .buttonStyle(.glass)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 16)
                    if let locationError {
                        Caption(locationError, tone: Palette.caution).padding(.horizontal, 20).padding(.top, 8)
                    }
                    Spacer().frame(height: 26)
                }
                SectionHead(title: search.query.isEmpty ? "Popular peaks" : "Results") {
                    if search.searching { ProgressView().controlSize(.small) }
                }
                if let error = search.error {
                    Notice(tone: .caution, text: error)
                }
                if search.noMatches {
                    Caption("No places match “\(search.searched)”. Try a nearby peak, lake or trailhead, or choose on the map.")
                        .padding(.horizontal, 20)
                }
                VStack(spacing: 0) {
                    ForEach(Array(search.results.enumerated()), id: \.element.id) { index, place in
                        if index > 0 { Divider().padding(.leading, 66) }
                        Button { onPlan(place) } label: {
                            HStack(spacing: 8) {
                                PlaceRow(place: place)
                                Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Palette.accent)
                            }
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Starts a new plan")
                    }
                }
                .background {
                    if !search.results.isEmpty {
                        RoundedRectangle(cornerRadius: 20).fill(Palette.surface)
                            .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
                            .shadow(color: .black.opacity(0.07), radius: 14, y: 8)
                    }
                }
                .padding(.horizontal, 16)
            }
            .searchable(text: $search.query, prompt: "Peak, trailhead or place")
            .onChange(of: search.query) { search.run() }
            .onSubmit(of: .search) { search.run(now: true) }
            .onAppear { if search.results.isEmpty { search.run() } }
            // The new plan sheet opens once the map has gone.
            .fullScreenCover(isPresented: $mapOpen, onDismiss: {
                if let pinned { self.pinned = nil; onPlan(pinned) }
            }) {
                MapPicker(title: "Objective") { pinned = $0 }
            }
        }
    }

    private func useLocation() async {
        locating = true
        defer { locating = false }
        guard let place = await Place.current() else {
            locationError = Place.locationUnavailable
            return
        }
        locationError = nil
        onPlan(place)
    }
}
