import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var settingsVM: SettingsViewModel?

    var body: some View {
        NavigationStack {
            Form {
                if let vm = settingsVM {
                    @Bindable var settings = vm

                    // Appearance
                    Section("Appearance") {
                        Picker("Theme", selection: $settings.preferences.themeMode) {
                            ForEach(UserPreferences.ThemeMode.allCases, id: \.self) { mode in
                                Text(mode.rawValue.capitalized).tag(mode)
                            }
                        }
                    }

                    // Units
                    Section("Units") {
                        Picker("Temperature", selection: $settings.preferences.temperatureUnit) {
                            Text("Fahrenheit").tag(UserPreferences.TemperatureUnit.fahrenheit)
                            Text("Celsius").tag(UserPreferences.TemperatureUnit.celsius)
                        }

                        Picker("Elevation", selection: $settings.preferences.elevationUnit) {
                            Text("Feet").tag(UserPreferences.ElevationUnit.feet)
                            Text("Meters").tag(UserPreferences.ElevationUnit.meters)
                        }

                        Picker("Wind Speed", selection: $settings.preferences.windSpeedUnit) {
                            Text("mph").tag(UserPreferences.WindSpeedUnit.mph)
                            Text("kph").tag(UserPreferences.WindSpeedUnit.kph)
                        }

                        Picker("Time Format", selection: $settings.preferences.timeStyle) {
                            Text("12-hour").tag(UserPreferences.TimeStyle.ampm)
                            Text("24-hour").tag(UserPreferences.TimeStyle.twentyFourHour)
                        }
                    }

                    // Threshold Presets
                    Section {
                        ForEach(UserPreferences.ThresholdPreset.allCases) { preset in
                            Button {
                                settings.preferences.applyPreset(preset)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(preset.label)
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(.primary)
                                        Text(preset.description)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if isPresetActive(preset, preferences: settings.preferences) {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.blue)
                                    }
                                }
                            }
                        }
                    } header: {
                        Text("Threshold Presets")
                    } footer: {
                        Text("Apply a preset or customize individual thresholds below.")
                    }

                    // Thresholds
                    Section("Travel Window Thresholds") {
                        HStack {
                            Text("Max Wind Gusts")
                            Spacer()
                            TextField("40", value: windGustDisplayBinding(vm), format: .number)
                                .keyboardType(.numberPad)
                                .frame(width: 60)
                                .multilineTextAlignment(.trailing)
                            Text(settings.preferences.windSpeedUnit.symbol)
                                .foregroundStyle(.secondary)
                        }

                        HStack {
                            Text("Max Precip Chance")
                            Spacer()
                            TextField("40", value: $settings.preferences.maxPrecipChance, format: .number)
                                .keyboardType(.numberPad)
                                .frame(width: 60)
                                .multilineTextAlignment(.trailing)
                            Text("%")
                                .foregroundStyle(.secondary)
                        }

                        HStack {
                            Text("Min Feels Like")
                            Spacer()
                            TextField("15", value: feelsLikeDisplayBinding(vm), format: .number)
                                .keyboardType(.numberPad)
                                .frame(width: 60)
                                .multilineTextAlignment(.trailing)
                            Text(settings.preferences.temperatureUnit.symbol)
                                .foregroundStyle(.secondary)
                        }

                        HStack {
                            Text("Travel Window Hours")
                            Spacer()
                            TextField("12", value: $settings.preferences.travelWindowHours, format: .number)
                                .keyboardType(.numberPad)
                                .frame(width: 60)
                                .multilineTextAlignment(.trailing)
                            Text("hours")
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Default start time
                    Section("Defaults") {
                        HStack {
                            Text("Start Time")
                            Spacer()
                            DatePicker("", selection: defaultStartTimeBinding(vm), displayedComponents: .hourAndMinute)
                                .labelsHidden()
                        }
                    }

                    // Status
                    Section {
                        NavigationLink("Backend Status") {
                            StatusView()
                        }
                    }

                    // About
                    Section("About") {
                        Text(Configuration.appDisclaimer)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Text(Configuration.appCredit)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
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
                return formatter.date(from: vm.preferences.defaultStartTime) ?? formatter.date(from: "04:30")!
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
}

#Preview {
    SettingsView()
        .environment(AppState())
}
