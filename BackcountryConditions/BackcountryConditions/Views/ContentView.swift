import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        TabView(selection: $state.selectedTab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(AppState.AppTab.home)

            PlannerView()
                .tabItem { Label("Planner", systemImage: "map") }
                .tag(AppState.AppTab.planner)

            TripPlannerView()
                .tabItem { Label("Trip", systemImage: "calendar.badge.clock") }
                .tag(AppState.AppTab.trip)

            NavigationStack {
                StatusView()
            }
                .tabItem { Label("Status", systemImage: "waveform.path.ecg") }
                .tag(AppState.AppTab.status)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppState.AppTab.settings)
        }
        .tint(.webPineDeep)
        .preferredColorScheme(appState.preferences.themeMode.colorScheme)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
