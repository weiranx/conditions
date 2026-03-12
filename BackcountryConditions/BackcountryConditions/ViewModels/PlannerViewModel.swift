import Foundation
import Observation

@Observable
final class PlannerViewModel {
    // Input state
    var objectiveName: String = ""
    var lat: Double?
    var lon: Double?
    var forecastDate: String = PlannerViewModel.initialForecastDate()
    var startTime: String = UserPreferences.load().defaultStartTime

    /// If the user's default start time has already passed today, default to tomorrow.
    private static func initialForecastDate() -> String {
        let prefs = UserPreferences.load()
        guard let startMinutes = DateFormatting.parseTimeInputMinutes(prefs.defaultStartTime) else {
            return DateFormatting.formatDateInput(Date())
        }
        let now = Calendar.current.dateComponents([.hour, .minute], from: Date())
        let nowMinutes = (now.hour ?? 0) * 60 + (now.minute ?? 0)
        if nowMinutes > startMinutes {
            // Start time already passed today — use tomorrow
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            return DateFormatting.formatDateInput(tomorrow)
        }
        return DateFormatting.formatDateInput(Date())
    }
    var endTime: String?
    var targetElevation: String = ""

    // Output state
    var safetyData: SafetyData?
    var decision: SummitDecision?
    var isLoading = false
    var error: String?

    // AI brief
    var aiBrief: String?
    var isLoadingBrief = false

    private let safetyService = SafetyService()
    private let briefService = BriefService()

    var hasObjective: Bool {
        lat != nil && lon != nil
    }

    var hasReport: Bool {
        safetyData != nil
    }

    // MARK: - Load Report

    @MainActor
    func loadReport(preferences: UserPreferences) async {
        guard let lat, let lon else {
            error = "No location selected"
            return
        }

        isLoading = true
        error = nil
        aiBrief = nil
        safetyData = nil
        decision = nil

        do {
            let elevation = Int(targetElevation)
            let data = try await safetyService.loadReport(
                lat: lat,
                lon: lon,
                date: forecastDate,
                startTime: startTime,
                endTime: endTime,
                elevation: elevation,
                travelWindowHours: Int(preferences.travelWindowHours)
            )
            safetyData = data
            decision = DecisionEngine.evaluate(data: data, preferences: preferences)
            isLoading = false

            // Haptic feedback based on decision severity
            if let decision {
                switch decision.level {
                case .go: Haptics.notification(.success)
                case .caution: Haptics.notification(.warning)
                case .noGo: Haptics.notification(.error)
                }

                // Auto-save for offline access
                let report = SavedReport(
                    objectiveName: objectiveName,
                    lat: lat,
                    lon: lon,
                    forecastDate: forecastDate,
                    startTime: startTime,
                    data: data,
                    decisionLevel: decision.level,
                    headline: decision.headline
                )
                Task.detached {
                    try? await ReportStore.shared.save(report)
                }
            }
        } catch {
            self.error = error.localizedDescription
            isLoading = false
            Haptics.notification(.error)
        }
    }

    // MARK: - AI Brief

    @MainActor
    func loadAiBrief() async {
        guard let data = safetyData, let decision else { return }

        isLoadingBrief = true
        do {
            let request = AiBriefRequest(
                score: data.safety.score,
                confidence: data.safety.confidence,
                primaryHazard: data.safety.primaryHazard,
                decisionLevel: decision.level.rawValue,
                factors: (data.safety.factors ?? []).map {
                    AiBriefRequest.BriefFactor(hazard: $0.hazard, name: nil, impact: $0.impact ?? 0)
                }
            )
            let response = try await briefService.fetchAiBrief(request: request)
            aiBrief = response.narrative
        } catch {
            aiBrief = nil
        }
        isLoadingBrief = false
    }

    // MARK: - Set Objective

    func setObjective(result: SearchResult) {
        objectiveName = result.name
        lat = result.lat
        lon = result.lon
    }

    func clear() {
        objectiveName = ""
        lat = nil
        lon = nil
        safetyData = nil
        decision = nil
        error = nil
        aiBrief = nil
    }
}
