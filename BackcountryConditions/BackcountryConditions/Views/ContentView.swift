import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        TabView(selection: $state.selectedTab) {
            PlannerView()
                .tabItem { Label("Planner", systemImage: "map") }
                .tag(AppState.AppTab.planner)

            TripPlannerView()
                .tabItem { Label("Trip", systemImage: "calendar.badge.clock") }
                .tag(AppState.AppTab.trip)

            ReportHistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(AppState.AppTab.history)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppState.AppTab.settings)

            StatusView()
                .tabItem { Label("Status", systemImage: "server.rack") }
                .tag(AppState.AppTab.status)
        }
        .preferredColorScheme(appState.preferences.themeMode.colorScheme)
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
