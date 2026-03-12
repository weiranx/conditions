import Foundation
import Observation

@Observable
final class SearchViewModel: @unchecked Sendable {
    var query: String = ""
    var suggestions: [SearchResult] = []
    var isSearching = false
    var recentSearches: [SearchResult] = []
    var savedObjectives: [SearchResult] = []

    private let searchService = SearchService()
    private var searchTask: Task<Void, Never>?

    private static let recentSearchesKey = "summitsafe:recent-searches"
    private static let savedObjectivesKey = "summitsafe:saved-objectives"
    private static let maxRecent = 20
    private static let maxSaved = 12

    init() {
        loadRecentSearches()
        loadSavedObjectives()
    }

    // MARK: - Search

    func performSearch(_ text: String) {
        searchTask?.cancel()

        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            suggestions = []
            return
        }

        // Show local results immediately
        suggestions = PeakCatalog.localResults(for: trimmed)

        // Debounced backend search
        searchTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(AppConstants.searchDebounceMs) * 1_000_000)
            guard !Task.isCancelled, let self else { return }

            self.isSearching = true
            do {
                let results = try await self.searchService.search(query: trimmed)
                guard !Task.isCancelled else { return }

                // Merge local + backend, deduplicate
                let local = PeakCatalog.localResults(for: trimmed)
                let merged = self.deduplicateResults(local + results)
                self.suggestions = Array(merged.prefix(8))
            } catch {
                // Keep local results on network failure
            }
            self.isSearching = false
        }
    }

    func addToRecent(_ result: SearchResult) {
        recentSearches.removeAll { $0.id == result.id }
        recentSearches.insert(result, at: 0)
        if recentSearches.count > Self.maxRecent {
            recentSearches = Array(recentSearches.prefix(Self.maxRecent))
        }
        saveRecentSearches()
    }

    func removeFromRecent(_ result: SearchResult) {
        recentSearches.removeAll { $0.id == result.id }
        saveRecentSearches()
    }

    func clearRecentSearches() {
        recentSearches = []
        saveRecentSearches()
    }

    func clearSuggestions() {
        suggestions = []
        query = ""
    }

    // MARK: - Saved Objectives

    func toggleSavedObjective(_ result: SearchResult) {
        if isSaved(result) {
            savedObjectives.removeAll { $0.id == result.id }
        } else {
            savedObjectives.insert(result, at: 0)
            if savedObjectives.count > Self.maxSaved {
                savedObjectives = Array(savedObjectives.prefix(Self.maxSaved))
            }
        }
        saveSavedObjectives()
    }

    func isSaved(_ result: SearchResult) -> Bool {
        savedObjectives.contains { $0.id == result.id }
    }

    // MARK: - Persistence

    private func saveRecentSearches() {
        guard let data = try? JSONEncoder().encode(recentSearches) else { return }
        UserDefaults.standard.set(data, forKey: Self.recentSearchesKey)
    }

    private func loadRecentSearches() {
        guard let data = UserDefaults.standard.data(forKey: Self.recentSearchesKey),
              let saved = try? JSONDecoder().decode([SearchResult].self, from: data) else { return }
        recentSearches = saved
    }

    private func saveSavedObjectives() {
        guard let data = try? JSONEncoder().encode(savedObjectives) else { return }
        UserDefaults.standard.set(data, forKey: Self.savedObjectivesKey)
    }

    private func loadSavedObjectives() {
        guard let data = UserDefaults.standard.data(forKey: Self.savedObjectivesKey),
              let saved = try? JSONDecoder().decode([SearchResult].self, from: data) else { return }
        savedObjectives = saved
    }

    // MARK: - Deduplication

    private func deduplicateResults(_ results: [SearchResult]) -> [SearchResult] {
        var seen = Set<String>()
        return results.filter { result in
            let key = "\(result.name.lowercased())|\(String(format: "%.4f", result.lat))|\(String(format: "%.4f", result.lon))"
            if seen.contains(key) { return false }
            seen.insert(key)
            return true
        }
    }
}
