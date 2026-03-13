import Foundation
import Observation

@Observable
final class AppState {
    var selectedTab: AppTab = .planner
    var preferences: UserPreferences = .load()

    enum AppTab: Int, CaseIterable {
        case planner, trip, history, settings
    }
}
