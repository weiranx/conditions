import Foundation
import Observation

@Observable
final class SettingsViewModel {
    var preferences: UserPreferences

    init(preferences: UserPreferences) {
        self.preferences = preferences
    }

    func save(to appState: AppState) {
        appState.preferences = preferences
        preferences.save()
    }
}
