import Foundation
import Observation

@Observable
final class AppState {
    var selectedTab: AppTab = .home
    var preferences: UserPreferences = .load()
    var selectedObjective: SearchResult?
    var plannerForecastDate: String?
    var plannerStartTime: String?
    var plannerTravelWindowHours: Double?
    var shouldGeneratePlannerReport = false

    enum AppTab: Int, CaseIterable {
        case home, planner, trip, status, settings
    }

    func openPlanner(objective: SearchResult? = nil, date: String? = nil, startTime: String? = nil, travelWindowHours: Double? = nil, generate: Bool = false) {
        if let objective { selectedObjective = objective }
        if let date { plannerForecastDate = date }
        if let startTime { plannerStartTime = startTime }
        if let travelWindowHours { plannerTravelWindowHours = travelWindowHours }
        shouldGeneratePlannerReport = generate
        selectedTab = .planner
    }
}
