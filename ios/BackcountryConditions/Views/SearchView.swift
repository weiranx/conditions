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
                let found = try await APIClient().search(text)
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

/// A sheet for choosing an objective or camp.
struct PlacePicker: View {
    @Environment(\.dismiss) private var dismiss
    var title: String
    var onPick: (Place) -> Void
    @State private var search = PlaceSearch()

    var body: some View {
        NavigationStack {
            List {
                if let error = search.error {
                    Text(error).font(.footnote).foregroundStyle(Palette.caution)
                }
                Section(search.query.isEmpty ? "Popular peaks" : "Results") {
                    ForEach(search.results) { place in
                        Button { onPick(place); dismiss() } label: { PlaceRow(place: place) }
                    }
                    if search.searching && search.results.isEmpty { ProgressView() }
                    if search.noMatches {
                        Text("No places match “\(search.searched)”. Try a nearby peak, lake or trailhead.")
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
            .onAppear { search.run() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel", systemImage: "xmark") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The Search tab: find an objective, then plan it.
struct SearchView: View {
    var onPlan: (Place) -> Void
    @State private var search = PlaceSearch()

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Search", title: "Find an objective", subtitle: "Peaks, trailheads and places across the US.")
                Spacer().frame(height: 22)
                SectionHead(title: search.query.isEmpty ? "Popular peaks" : "Results") {
                    if search.searching { ProgressView().controlSize(.small) }
                }
                if let error = search.error {
                    Notice(tone: .caution, text: error)
                }
                if search.noMatches {
                    Caption("No places match “\(search.searched)”. Try a nearby peak, lake or trailhead.")
                        .padding(.horizontal, 20)
                }
                VStack(spacing: 10) {
                    ForEach(search.results) { place in
                        Card {
                            PlaceRow(place: place)
                            Button("Plan this", systemImage: "plus") { onPlan(place) }
                                .buttonStyle(.glass).controlSize(.small).padding(.top, 4)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            .searchable(text: $search.query, prompt: "Peak, trailhead or place")
            .onChange(of: search.query) { search.run() }
            .onSubmit(of: .search) { search.run(now: true) }
            .onAppear { if search.results.isEmpty { search.run() } }
        }
    }
}
