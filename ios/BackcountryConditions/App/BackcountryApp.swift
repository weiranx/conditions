import BackgroundTasks
import SwiftUI
import UserNotifications

@main
struct BackcountryApp: App {
    @State private var store = PlanStore()
    @State private var account = AccountStore.shared
    @State private var preferences = PreferencesStore.shared
    @Environment(\.scenePhase) private var scenePhase

    nonisolated static let watchCheckTask = "app.summitsafe.conditions.watch-check"

    init() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(account)
                .environment(preferences)
                .tint(Palette.accent)
                .preferredColorScheme(preferences.preferences.colorScheme)
                .task { await account.refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Self.scheduleWatchCheck() }
            if phase == .active { Task { await account.refresh() } }
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

extension DeepLink {
    /// A shared report's token from `conditions://report/<token>` or `https://…/report/<token>`.
    static func reportToken(from text: String) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "conditions", url.host() == "report", let token = parts.first { return token }
        if let index = parts.firstIndex(of: "report"), parts.indices.contains(index + 1) { return parts[index + 1] }
        return nil
    }
}

/// The Liquid Glass tab bar, with the web app's sections and search as its own tab.
struct RootView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var tab: AppTab = .plan
    @State private var newPlanDraft: NewPlanDraft?
    @State private var sharedReport: RemoteReport?
    @State private var accountPrompt: String?

    var body: some View {
        TabView(selection: $tab) {
            Tab("Plan", systemImage: "safari", value: .plan) {
                PlanListView(openBrief: openBrief, newPlan: { newPlanDraft = NewPlanDraft() }, newTrip: { newPlanDraft = NewPlanDraft(multiDay: true) })
            }
            Tab("Brief", systemImage: "map", value: .brief) {
                BriefTab(newPlan: { newPlanDraft = NewPlanDraft() })
            }
            if account.flags.tripPlanning {
                Tab("Compare", systemImage: "sunrise", value: .compare) {
                    CompareView()
                }
            }
            if account.flags.objectiveWatch {
                Tab("Watchlist", systemImage: "bell", value: .watchlist) {
                    WatchlistView(openBrief: openBrief, newPlan: { newPlanDraft = $0 })
                }
                .badge(store.watched.filter { !($0.watch?.reviewed ?? true) }.count)
            }
            Tab(value: .search, role: .search) {
                SearchView { place in newPlanDraft = NewPlanDraft(objective: place) }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .onOpenURL { url in
            if let id = DeepLink.planID(from: url) { openPlan(id) }
            else if let token = DeepLink.reportToken(from: url.absoluteString) { sharedReport = RemoteReport(source: .shared(token)) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openPlan)) { note in
            if let id = note.object as? UUID { sharedReport = nil; openPlan(id) }
        }
        .sheet(item: $newPlanDraft) { draft in
            NewPlanSheet(draft: draft) { plan in
                store.add(plan)
                openBrief(plan.id)
                Task { await store.refresh(plan) }
            }
        }
        .sheet(item: $sharedReport) { remote in
            NavigationStack {
                RemoteReportView(remote: remote)
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { sharedReport = nil } } }
            }
        }
        .sheet(item: Binding(get: { accountPrompt.map(PromptReason.init) }, set: { accountPrompt = $0?.text })) { reason in
            NavigationStack {
                AccountView(reason: reason.text)
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { accountPrompt = nil } } }
            }
        }
        .alert(account.signedIn ? "Planning allowance reached" : "Sign in to continue",
               isPresented: Binding(get: { store.blocker != nil }, set: { if !$0 { store.blocker = nil } })) {
            Button(account.signedIn ? "Open account" : "Sign in") {
                accountPrompt = store.blocker
                store.blocker = nil
            }
            Button("Not now", role: .cancel) { store.blocker = nil }
        } message: {
            Text(store.blocker ?? "")
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

private struct PromptReason: Identifiable {
    var text: String
    var id: String { text }
}
