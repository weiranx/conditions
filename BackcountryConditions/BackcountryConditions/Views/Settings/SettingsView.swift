import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var settingsVM: SettingsViewModel?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    WebPageHeader(
                        kicker: "Planning preferences",
                        title: "Settings",
                        subtitle: "Defaults for this device. Shared planner links can still override any value for a single report.",
                        systemImage: "slider.horizontal.3"
                    )
                    if let vm = settingsVM { settingsContent(vm) }
                }
                .padding(16)
            }
            .background(Color.webBackground)
            .scrollDismissesKeyboard(.interactively)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                if settingsVM == nil {
                    settingsVM = SettingsViewModel(preferences: appState.preferences)
                }
            }
            .onChange(of: settingsVM?.preferences) { _, _ in
                settingsVM?.save(to: appState)
            }
        }
    }

    @ViewBuilder
    private func settingsContent(_ vm: SettingsViewModel) -> some View {
        @Bindable var settings = vm

        settingsCard("Default timing", icon: "clock", copy: "Applied when you start a new objective without shared time values.") {
            HStack {
                Text("Alpine start time").font(.webSans(14, weight: .medium))
                Spacer()
                DatePicker("", selection: defaultStartTimeBinding(vm), displayedComponents: .hourAndMinute).labelsHidden()
            }
            thresholdRow("Travel window length", value: $settings.preferences.travelWindowHours, range: 1...24, unit: "h")
        }

        settingsCard("Appearance", icon: "eye", copy: "Theme follows your system by default.") {
            Picker("Theme", selection: $settings.preferences.themeMode) {
                ForEach(UserPreferences.ThemeMode.allCases, id: \.self) { mode in Text(mode.rawValue.capitalized).tag(mode) }
            }
            .pickerStyle(.segmented)
        }

        settingsCard("Units & time", icon: "ruler", copy: "Controls display units in report cards and exported summaries.") {
            settingPicker("Temperature", selection: $settings.preferences.temperatureUnit) {
                Text("°F").tag(UserPreferences.TemperatureUnit.fahrenheit)
                Text("°C").tag(UserPreferences.TemperatureUnit.celsius)
            }
            settingPicker("Elevation", selection: $settings.preferences.elevationUnit) {
                Text("Feet").tag(UserPreferences.ElevationUnit.feet)
                Text("Meters").tag(UserPreferences.ElevationUnit.meters)
            }
            settingPicker("Wind speed", selection: $settings.preferences.windSpeedUnit) {
                Text("mph").tag(UserPreferences.WindSpeedUnit.mph)
                Text("kph").tag(UserPreferences.WindSpeedUnit.kph)
            }
            settingPicker("Time style", selection: $settings.preferences.timeStyle) {
                Text("12-hour").tag(UserPreferences.TimeStyle.ampm)
                Text("24-hour").tag(UserPreferences.TimeStyle.twentyFourHour)
            }
        }

        settingsCard("Travel window thresholds", icon: "gauge.with.dots.needle.50percent", copy: "An hour is clean only if it clears every threshold.") {
            thresholdRow("Max wind gust", value: windGustDisplayBinding(vm), range: windDisplayRange(vm), unit: settings.preferences.windSpeedUnit.symbol)
            thresholdRow("Max precip chance", value: $settings.preferences.maxPrecipChance, range: 0...100, unit: "%")
            thresholdRow("Min feels-like", value: feelsLikeDisplayBinding(vm), range: feelsLikeRange(vm), unit: settings.preferences.temperatureUnit.symbol)
            thresholdRow("Max heat", value: heatCeilingDisplayBinding(vm), range: heatRange(vm), unit: settings.preferences.temperatureUnit.symbol)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(UserPreferences.ThresholdPreset.allCases) { preset in
                        Button {
                            settings.preferences.applyPreset(preset)
                        } label: {
                            HStack(spacing: 5) {
                                if isPresetActive(preset, preferences: settings.preferences) { Image(systemName: "checkmark") }
                                Text(preset.label)
                            }
                            .font(.webSans(12, weight: .semibold))
                            .foregroundStyle(isPresetActive(preset, preferences: settings.preferences) ? .white : Color.webPineDeep)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(isPresetActive(preset, preferences: settings.preferences) ? Color.webPineDeep : Color.webPineSoft, in: Capsule())
                        }
                    }
                }
            }
        }

        settingsCard("Saved data & operations", icon: "externaldrive", copy: "Review offline reports or inspect restricted request activity.") {
            NavigationLink { ReportHistoryView() } label: { settingsLink("Saved reports", icon: "clock.arrow.circlepath") }
            NavigationLink { ReportLogsView() } label: { settingsLink("Report logs", icon: "doc.text.magnifyingglass") }
            Button(role: .destructive) { settings.preferences.reset() } label: { settingsLink("Reset to defaults", icon: "arrow.counterclockwise") }
        }

        VStack(alignment: .leading, spacing: 8) {
            Text(Configuration.appDisclaimer).font(.webSans(11)).foregroundStyle(Color.webInkTertiary).lineSpacing(3)
            Text(Configuration.appCredit).font(.webMono(9)).foregroundStyle(Color.webInkTertiary)
        }
        .padding(4)
    }

    private func settingsCard<Content: View>(_ title: String, icon: String, copy: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icon).foregroundStyle(Color.webPineDeep).frame(width: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.webSans(16, weight: .semibold)).foregroundStyle(Color.webInk)
                    Text(copy).font(.webSans(12)).foregroundStyle(Color.webInkTertiary).lineSpacing(2)
                }
            }
            Divider().overlay(Color.webLine)
            VStack(spacing: 16) { content() }
        }
        .webCard(padding: 18)
    }

    private func settingPicker<Value: Hashable, Content: View>(_ label: String, selection: Binding<Value>, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.webSans(13, weight: .medium)).foregroundStyle(Color.webInk)
            Picker(label, selection: selection, content: content).pickerStyle(.segmented)
        }
    }

    private func thresholdRow(_ label: String, value: Binding<Double>, range: ClosedRange<Double>, unit: String) -> some View {
        VStack(spacing: 7) {
            HStack {
                Text(label).font(.webSans(13, weight: .medium)).foregroundStyle(Color.webInk)
                Spacer()
                Text("\(Int(value.wrappedValue.rounded())) \(unit)").font(.webMono(11)).foregroundStyle(Color.webPineDeep)
            }
            Slider(value: value, in: range, step: 1).tint(.webPine)
            HStack {
                Text("\(Int(range.lowerBound))\(unit)")
                Spacer()
                Text("\(Int(range.upperBound))\(unit)")
            }
            .font(.webMono(8, weight: .regular))
            .foregroundStyle(Color.webInkTertiary)
        }
    }

    private func settingsLink(_ title: String, icon: String) -> some View {
        HStack {
            Label(title, systemImage: icon).font(.webSans(14, weight: .medium))
            Spacer()
            Image(systemName: "chevron.right").font(.caption)
        }
        .foregroundStyle(Color.webInk)
        .padding(.vertical, 4)
    }

    // MARK: - Display-Unit Bindings
    // Thresholds are stored in canonical units (°F, mph).
    // These bindings convert to/from the user's display unit.

    private func windGustDisplayBinding(_ vm: SettingsViewModel) -> Binding<Double> {
        Binding(
            get: {
                convertWindMphToDisplay(vm.preferences.maxWindGustMph, unit: vm.preferences.windSpeedUnit).rounded()
            },
            set: { newValue in
                vm.preferences.maxWindGustMph = convertDisplayWindToMph(newValue, unit: vm.preferences.windSpeedUnit)
            }
        )
    }

    private func defaultStartTimeBinding(_ vm: SettingsViewModel) -> Binding<Date> {
        Binding(
            get: {
                let formatter = DateFormatter()
                formatter.dateFormat = "HH:mm"
                return formatter.date(from: vm.preferences.defaultStartTime) ?? formatter.date(from: "07:00")!
            },
            set: { newValue in
                let formatter = DateFormatter()
                formatter.dateFormat = "HH:mm"
                vm.preferences.defaultStartTime = formatter.string(from: newValue)
            }
        )
    }

    private func isPresetActive(_ preset: UserPreferences.ThresholdPreset, preferences: UserPreferences) -> Bool {
        preferences.maxWindGustMph == preset.maxWindGustMph &&
        preferences.maxPrecipChance == preset.maxPrecipChance &&
        preferences.minFeelsLikeF == preset.minFeelsLikeF &&
        preferences.maxFeelsLikeF == preset.maxFeelsLikeF &&
        preferences.travelWindowHours == preset.travelWindowHours
    }

    private func feelsLikeDisplayBinding(_ vm: SettingsViewModel) -> Binding<Double> {
        Binding(
            get: {
                convertTempFToDisplay(vm.preferences.minFeelsLikeF, unit: vm.preferences.temperatureUnit).rounded()
            },
            set: { newValue in
                vm.preferences.minFeelsLikeF = convertDisplayTempToF(newValue, unit: vm.preferences.temperatureUnit)
            }
        )
    }


    private func heatCeilingDisplayBinding(_ vm: SettingsViewModel) -> Binding<Double> {
        Binding(
            get: {
                convertTempFToDisplay(vm.preferences.maxFeelsLikeF, unit: vm.preferences.temperatureUnit).rounded()
            },
            set: { newValue in
                vm.preferences.maxFeelsLikeF = convertDisplayTempToF(newValue, unit: vm.preferences.temperatureUnit)
            }
        )
    }

    private func windDisplayRange(_ vm: SettingsViewModel) -> ClosedRange<Double> {
        return convertWindMphToDisplay(10, unit: vm.preferences.windSpeedUnit).rounded()...convertWindMphToDisplay(80, unit: vm.preferences.windSpeedUnit).rounded()
    }

    private func feelsLikeRange(_ vm: SettingsViewModel) -> ClosedRange<Double> {
        return convertTempFToDisplay(-40, unit: vm.preferences.temperatureUnit).rounded()...convertTempFToDisplay(60, unit: vm.preferences.temperatureUnit).rounded()
    }

    private func heatRange(_ vm: SettingsViewModel) -> ClosedRange<Double> {
        return convertTempFToDisplay(70, unit: vm.preferences.temperatureUnit).rounded()...convertTempFToDisplay(120, unit: vm.preferences.temperatureUnit).rounded()
    }
}

#Preview {
    SettingsView()
        .environment(AppState())
}
