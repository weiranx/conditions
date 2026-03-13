import SwiftUI

struct TripDayDetailView: View {
    @Environment(AppState.self) private var appState
    let dayResult: TripPlannerView.DayResult
    let objectiveName: String

    @State private var aiBrief: String?
    @State private var isLoadingBrief = false

    private let briefService = BriefService()

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    if let error = dayResult.error {
                        ErrorBannerView(message: error, onRetry: nil)
                            .padding(.horizontal)
                    }

                    if let data = dayResult.data, let decision = dayResult.decision {
                        let prefs = appState.preferences
                        let visibleCards = PlannerCardType.allCases.filter { $0.isVisible(for: data) }
                        LazyVStack(spacing: 12) {
                            ForEach(visibleCards) { cardType in
                                PlannerCardFactory.view(
                                    for: cardType,
                                    data: data,
                                    decision: decision,
                                    preferences: prefs,
                                    aiBrief: aiBrief,
                                    isLoadingBrief: isLoadingBrief,
                                    onRequestBrief: { Task { await loadBrief(data: data, decision: decision) } },
                                    objectiveName: objectiveName,
                                    forecastDate: dayResult.date,
                                    startTime: nil,
                                    onScrollToCard: { target in
                                        withAnimation {
                                            proxy.scrollTo(target, anchor: .top)
                                        }
                                    }
                                )
                                .id(cardType)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical, 8)
            }
            .background(Color(.systemGroupedBackground))
        }
        .navigationTitle(dayResult.displayDate)
        .navigationBarTitleDisplayMode(.large)
    }

    @MainActor
    private func loadBrief(data: SafetyData, decision: SummitDecision) async {
        guard !isLoadingBrief, aiBrief == nil else { return }
        isLoadingBrief = true
        defer { isLoadingBrief = false }
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
            // silently fail - brief is optional
        }
    }
}
