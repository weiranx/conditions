import BackgroundTasks
import SwiftUI
import UserNotifications

@main
struct BackcountryApp: App {
    @State private var store = PlanStore()
    @Environment(\.scenePhase) private var scenePhase

    nonisolated static let watchCheckTask = "app.summitsafe.conditions.watch-check"

    init() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Palette.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Self.scheduleWatchCheck() }
        }
        // Watched plans are checked again in the background; a changed decision posts a notification.
        .backgroundTask(.appRefresh(Self.watchCheckTask)) {
            Self.scheduleWatchCheck()
            await store.refreshWatched()
        }
    }

    nonisolated static func scheduleWatchCheck() {
        let request = BGAppRefreshTaskRequest(identifier: watchCheckTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3 * 3600)
        try? BGTaskScheduler.shared.submit(request)
    }
}

enum AppTab: Hashable {
    case plan, brief, compare, saved, watchlist, search
}

/// The Liquid Glass tab bar, with the web app's sections and search as its own tab.
struct RootView: View {
    @Environment(PlanStore.self) private var store
    @State private var tab: AppTab = .plan
    @State private var newPlanDraft: NewPlanDraft?

    var body: some View {
        TabView(selection: $tab) {
            Tab("Plan", systemImage: "safari", value: .plan) {
                PlanListView(openBrief: openBrief, newPlan: { newPlanDraft = NewPlanDraft() })
            }
            Tab("Brief", systemImage: "map", value: .brief) {
                BriefTab(newPlan: { newPlanDraft = NewPlanDraft() })
            }
            Tab("Compare", systemImage: "sunrise", value: .compare) {
                CompareView()
            }
            Tab("Watchlist", systemImage: "bell", value: .watchlist) {
                WatchlistView(openBrief: openBrief)
            }
            .badge(store.watched.filter { !($0.watch?.reviewed ?? true) }.count)
            Tab(value: .search, role: .search) {
                SearchView { place in newPlanDraft = NewPlanDraft(objective: place) }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .onOpenURL { url in
            if let id = DeepLink.planID(from: url) { openPlan(id) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openPlan)) { note in
            if let id = note.object as? UUID { openPlan(id) }
        }
        .sheet(item: $newPlanDraft) { draft in
            NewPlanSheet(draft: draft) { plan in
                store.add(plan)
                openBrief(plan.id)
                Task { await store.refresh(plan) }
            }
        }
    }

    private func openBrief(_ id: UUID) {
        store.briefPlanID = id
        tab = .brief
    }

    /// From a widget or notification: the plan's brief, if the plan still exists.
    private func openPlan(_ id: UUID) {
        newPlanDraft = nil
        if store.plan(id) != nil { openBrief(id) } else { tab = .plan }
    }
}
