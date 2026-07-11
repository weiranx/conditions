import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var searchVM = SearchViewModel()
    @State private var isSearchActive = false
    @State private var selectedObjective: SearchResult?
    @State private var forecastDate = HomeView.initialDate()
    @State private var startTime = HomeView.initialStartTime()
    @State private var travelWindowHours = UserPreferences.load().travelWindowHours

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    hero
                    introduction
                    disclaimer
                }
            }
            .ignoresSafeArea(edges: .top)
            .background(Color.webBackground)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var hero: some View {
        ZStack(alignment: .leading) {
            Image("HeroRainier")
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, minHeight: 700, maxHeight: 760)
                .clipped()

            LinearGradient(
                colors: [Color.webHero.opacity(0.97), Color.webHero.opacity(0.72), Color.webHero.opacity(0.22)],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                colors: [.clear, Color.webHero.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 72)

                HStack(spacing: 10) {
                    WebBrandMark(size: 38)
                    Text("Backcountry Conditions")
                        .font(.webSans(16, weight: .bold))
                        .foregroundStyle(.white)
                }
                .padding(.bottom, 34)

                WebKicker(text: "Mountain intelligence, on your clock", systemImage: "sparkles", inverse: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.black.opacity(0.18), in: Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.2)))

                Text("Know the mountain\nbefore you move.")
                    .font(.webDisplay(horizontalSizeClass == .regular ? 62 : 48, weight: .medium))
                    .tracking(-1.8)
                    .lineSpacing(-5)
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
                    .padding(.top, 18)

                Text("Build a time-aware conditions brief for the exact place and window you plan to travel.")
                    .font(.webSans(17))
                    .foregroundStyle(.white.opacity(0.86))
                    .lineSpacing(5)
                    .frame(maxWidth: 580, alignment: .leading)
                    .padding(.top, 15)
                    .padding(.bottom, 28)

                planningConsole
                popularObjectives
                Spacer(minLength: 40)
            }
            .padding(.horizontal, horizontalSizeClass == .regular ? 38 : 20)
            .frame(maxWidth: 820, alignment: .leading)
        }
        .frame(maxWidth: .infinity, minHeight: 700)
    }

    private var planningConsole: some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 9) {
                    Circle()
                        .fill(Color(red: 0.55, green: 0.84, blue: 0.64))
                        .frame(width: 7, height: 7)
                        .shadow(color: Color.webPine.opacity(0.8), radius: 6)
                    Text("CONDITIONS BRIEF")
                        .font(.webMono(10))
                        .tracking(1.1)
                        .foregroundStyle(.white.opacity(0.88))
                }
                Spacer()
                Text("6 SIGNAL FAMILIES")
                    .font(.webMono(9))
                    .tracking(0.8)
                    .foregroundStyle(.white.opacity(0.48))
            }
            .padding(.horizontal, 15)
            .frame(height: 42)

            Divider().overlay(.white.opacity(0.12))

            VStack(spacing: 12) {
                SearchBarView(searchVM: searchVM, isSearchActive: $isSearchActive) { result in
                    selectedObjective = result
                    searchVM.query = result.name
                }

                Button {
                    buildBrief()
                } label: {
                    Label("Build brief", systemImage: "arrow.right")
                }
                .buttonStyle(WebPrimaryButtonStyle())
                .disabled(selectedObjective == nil)
                .opacity(selectedObjective == nil ? 0.55 : 1)
            }
            .padding(14)

            Divider().overlay(.white.opacity(0.12))

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 0) { parameterControls }
                VStack(spacing: 0) { parameterControls }
            }

            Divider().overlay(.white.opacity(0.12))

            HStack(spacing: 18) {
                quality("Official forecast feeds", icon: "antenna.radiowaves.left.and.right")
                quality("Cross-signal synthesis", icon: "square.3.layers.3d")
                quality("Decision-ready summary", icon: "checkmark")
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
        }
        .background(
            LinearGradient(colors: [Color.webHero.opacity(0.92), Color.webHero.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 14)
        )
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.22)))
        .shadow(color: .black.opacity(0.38), radius: 34, y: 18)
    }

    @ViewBuilder
    private var parameterControls: some View {
        homeParameter("DATE", icon: "calendar") {
            DatePicker("Date", selection: $forecastDate, in: dateRange, displayedComponents: .date)
                .labelsHidden()
                .colorScheme(.dark)
        }
        homeParameter("START", icon: "clock") {
            DatePicker("Start", selection: $startTime, displayedComponents: .hourAndMinute)
                .labelsHidden()
                .colorScheme(.dark)
        }
        homeParameter("WINDOW", icon: "waveform.path.ecg") {
            HStack(spacing: 5) {
                Text("\(Int(travelWindowHours))")
                    .font(.webMono(15))
                    .foregroundStyle(.white)
                Text("hours")
                    .font(.webSans(14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.78))
                Stepper("", value: $travelWindowHours, in: 1...24, step: 1)
                    .labelsHidden()
                    .tint(.white)
            }
        }
    }

    private func homeParameter<Content: View>(_ label: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(label, systemImage: icon)
                .font(.webMono(9))
                .foregroundStyle(.white.opacity(0.6))
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .overlay(alignment: .trailing) {
            Rectangle().fill(.white.opacity(0.11)).frame(width: 1)
        }
    }

    private func quality(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.webSans(11))
            .foregroundStyle(.white.opacity(0.66))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }

    private var popularObjectives: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("START WITH")
                .font(.webMono(10))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.65))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(PeakCatalog.popularPeaks.prefix(5)) { peak in
                        Button {
                            selectedObjective = peak
                            searchVM.query = peak.name
                            buildBrief()
                        } label: {
                            Label(shortName(peak.name), systemImage: "mountain.2")
                                .font(.webSans(14, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 13)
                                .padding(.vertical, 11)
                                .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
                                .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(.white.opacity(0.24)))
                        }
                    }
                }
            }
        }
        .padding(.top, 20)
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 22) {
            WebKicker(text: "One brief. The whole picture.", systemImage: "scope")
            Text("Know the window before you go.")
                .font(.webDisplay(38, weight: .semibold))
                .tracking(-1.1)
                .foregroundStyle(Color.webInk)
            Text("Backcountry Conditions turns scattered forecasts into a decision-ready view of your objective, matched to when and where you plan to move.")
                .font(.webSans(15))
                .foregroundStyle(Color.webInkSecondary)
                .lineSpacing(4)

            VStack(spacing: 12) {
                featureCard("01", "Your timing", "Conditions for your exact window", "See hourly weather, daylight, and changing hazards from your start through your return.")
                featureCard("02", "Your risk picture", "Critical signals, weighed together", "Weather, avalanche, snowpack, alerts, air quality, and terrain become one prioritized brief.")
                featureCard("03", "Your next move", "Planning that leads to action", "Compare start times, inspect route exposure, and carry the same context into a multi-day plan.")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 42)
    }

    private func featureCard(_ number: String, _ kicker: String, _ title: String, _ copy: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(number)  \(kicker.uppercased())")
                .font(.webMono(9))
                .tracking(0.8)
                .foregroundStyle(Color.webPineDeep)
            Text(title)
                .font(.webDisplay(22, weight: .semibold))
                .foregroundStyle(Color.webInk)
            Text(copy)
                .font(.webSans(13))
                .foregroundStyle(Color.webInkSecondary)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .webCard(padding: 18)
    }

    private var disclaimer: some View {
        Text(Configuration.appDisclaimer)
            .font(.webSans(11))
            .foregroundStyle(Color.webInkTertiary)
            .lineSpacing(3)
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
    }

    private func buildBrief() {
        guard let selectedObjective else { return }
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"
        appState.openPlanner(
            objective: selectedObjective,
            date: dateFormatter.string(from: forecastDate),
            startTime: timeFormatter.string(from: startTime),
            travelWindowHours: travelWindowHours,
            generate: true
        )
    }

    private func shortName(_ name: String) -> String {
        name.components(separatedBy: ",").first ?? name
    }

    private static func initialDate() -> Date {
        let start = initialStartTime()
        let startComponents = Calendar.current.dateComponents([.hour, .minute], from: start)
        let nowComponents = Calendar.current.dateComponents([.hour, .minute], from: Date())
        let startMinutes = (startComponents.hour ?? 0) * 60 + (startComponents.minute ?? 0)
        let nowMinutes = (nowComponents.hour ?? 0) * 60 + (nowComponents.minute ?? 0)
        return nowMinutes > startMinutes ? Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date() : Date()
    }

    private static func initialStartTime() -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.date(from: UserPreferences.load().defaultStartTime) ?? Date()
    }

    private var dateRange: ClosedRange<Date> {
        let today = Calendar.current.startOfDay(for: Date())
        return today...(Calendar.current.date(byAdding: .day, value: 7, to: today) ?? today)
    }
}

#Preview {
    HomeView().environment(AppState())
}
