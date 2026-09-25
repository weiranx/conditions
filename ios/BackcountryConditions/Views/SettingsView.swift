import SafariServices
import SwiftUI
import UserNotifications

/// Settings: account, display units, the default plan, activities and limits, route timing, the
/// server, and the app's status and policies. Signed in, preferences sync with the web app.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    @Environment(PreferencesStore.self) private var preferencesStore
    @AppStorage(AppSettings.serverKey) private var server = AppSettings.defaultServer
    @State private var status: String?
    @State private var testing = false

    private var p: Binding<Preferences> { Binding(get: { preferencesStore.preferences }, set: { preferencesStore.preferences = $0 }) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink { AccountView() } label: {
                        HStack(spacing: 12) {
                            Text(account.user?.initial ?? "?")
                                .font(.headline).foregroundStyle(account.user == nil ? Palette.secondary : Palette.onAccent)
                                .frame(width: 36, height: 36)
                                .background(account.user == nil ? Palette.fill : Palette.accent, in: Circle())
                            VStack(alignment: .leading, spacing: 1) {
                                Text(account.user?.displayName ?? "Sign in or create an account").font(.headline)
                                Text(account.user.map { "\($0.email) · \(account.tierLabel ?? "Free")" } ?? "Save reports, sync preferences, and use AI tools")
                                    .font(.caption).foregroundStyle(Palette.secondary)
                            }
                        }
                    }
                }
                Section {
                    Text(summary).font(.footnote).foregroundStyle(Palette.secondary)
                }
                Section("Display") {
                    Picker("Appearance", selection: p.themeMode) {
                        Text("Auto").tag(ThemeMode.system)
                        Text("Light").tag(ThemeMode.light)
                        Text("Dark").tag(ThemeMode.dark)
                    }
                    Picker("Temperature", selection: p.temperatureUnit) {
                        Text("°F").tag(TemperatureUnit.f)
                        Text("°C").tag(TemperatureUnit.c)
                    }
                    Picker("Wind speed", selection: p.windUnit) {
                        Text("mph").tag(WindUnit.mph)
                        Text("km/h").tag(WindUnit.kph)
                    }
                    Picker("Elevation and distance", selection: p.elevationUnit) {
                        Text("ft · mi").tag(ElevationUnit.ft)
                        Text("m · km").tag(ElevationUnit.m)
                    }
                    Picker("Clock", selection: p.timeStyle) {
                        Text("12-hour").tag(TimeStyle.ampm)
                        Text("24-hour").tag(TimeStyle.twentyFour)
                    }
                }
                Section("Default plan") {
                    DatePicker("Departure time", selection: Binding(
                        get: { DateText.localTime(p.wrappedValue.defaultStartTime) ?? Date() },
                        set: { p.wrappedValue.defaultStartTime = DateText.hhmm($0) }), displayedComponents: .hourAndMinute)
                    Stepper("Travel window · \(p.wrappedValue.travelWindowHours) hours", value: p.travelWindowHours, in: 1...24)
                }
                Section {
                    NavigationLink { ActivitiesView() } label: {
                        LabeledContent("Activity and limits", value: p.wrappedValue.activeLabel)
                    }
                    Toggle("Check the approach at trailhead elevation", isOn: p.approachElevationAdjustment)
                } header: {
                    Text("Activities and limits")
                } footer: {
                    Text("With the approach on, the first hours are checked where you’ll be, often far below the summit, instead of at the objective.")
                }
                Section {
                    TextField("Server URL", text: $server)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button(testing ? "Testing…" : "Test connection") { Task { await test() } }.disabled(testing)
                    if let status { Text(status).font(.footnote).foregroundStyle(Palette.secondary) }
                } header: {
                    Text("Conditions server")
                } footer: {
                    Text("The app asks this server for every report, decision and comparison. Leave it empty to use \(AppSettings.defaultServer). To use a backend on your Mac from a phone, enter the Mac’s network address, like http://192.168.1.20:3001.")
                }
                Section("Try it") {
                    Button("Add the sample plan") { store.addSamplePlan(); dismiss() }
                }
                if account.isAdmin {
                    Section {
                        NavigationLink { AdminView() } label: { Label("Administration", systemImage: "checkmark.shield") }
                    }
                }
                Section {
                    NavigationLink { StatusView() } label: { Label("Service status", systemImage: "waveform.path.ecg") }
                    NavigationLink { LegalView(kind: .privacy) } label: { Label("Privacy", systemImage: "hand.raised") }
                    NavigationLink { LegalView(kind: .terms) } label: { Label("Terms", systemImage: "doc.text") }
                    Link(destination: URL(string: "\(AppSettings.webOrigin)/welcome")!) { Label("About Conditions", systemImage: "info.circle") }
                } header: {
                    Text("About")
                } footer: {
                    Text("Conditions is planning evidence, not a guarantee of safety. Missing data never means conditions are clear. Check the official forecasts and use your judgment in the field.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done", systemImage: "checkmark") { dismiss() }.buttonStyle(.glassProminent).tint(Palette.prominent) }
            }
            .onChange(of: unitsKey) { Task { await store.reevaluateAll() } }
            .onChange(of: server) { Task { await account.refresh() } }
        }
    }

    /// Units and approach change the evaluation's text and hours, so loaded reports are re-evaluated.
    private var unitsKey: String {
        let p = preferencesStore.preferences
        return "\(p.temperatureUnit)|\(p.windUnit)|\(p.elevationUnit)|\(p.timeStyle)|\(p.approachElevationAdjustment)"
    }

    private var summary: String {
        let p = preferencesStore.preferences
        let limits = p.limits
        return "You plan as \(p.activeLabel) for \(p.travelWindowHours) hours from \(DateText.clock(p.defaultStartTime)), turning back when gusts pass \(Format.mph(Double(limits.maxGustMph))), rain chance passes \(limits.maxPrecipChance)%, or it feels colder than \(Format.temp(Double(limits.minFeelsLikeF)))."
    }

    private func test() async {
        testing = true
        defer { testing = false }
        do {
            let health = try await APIClient().health()
            let state = health["status"].string ?? (health["ok"].bool == true ? "ok" : nil)
            status = "Connected." + (state.map { " Status: \($0)." } ?? "")
        } catch {
            status = error.localizedDescription
        }
    }
}

// MARK: - Activities and limits

/// Every activity, built-in or the traveler's own. The selected one's weather limits and route
/// timing are edited below; each activity keeps its own.
struct ActivitiesView: View {
    @Environment(PreferencesStore.self) private var preferencesStore
    @State private var creating = false
    @State private var newName = ""
    @State private var newBase: Activity = .hiking
    @State private var renaming = ""
    @State private var confirmDelete = false

    private var p: Binding<Preferences> { Binding(get: { preferencesStore.preferences }, set: { preferencesStore.preferences = $0 }) }

    var body: some View {
        let prefs = preferencesStore.preferences
        Form {
            Section("Activity") {
                ForEach(Activity.allCases) { activity in
                    Button { p.wrappedValue.select(activity: activity) } label: {
                        activityRow(symbol: activity.symbol, title: activity.label, detail: activity.description,
                                    selected: prefs.customActivityID == nil && prefs.defaultActivity == activity)
                    }
                }
                ForEach(prefs.customActivities) { custom in
                    Button { p.wrappedValue.select(custom: custom); renaming = custom.label } label: {
                        activityRow(symbol: custom.baseActivity.symbol, title: custom.label, detail: "Your activity · planned like \(custom.baseActivity.label.lowercased())",
                                    selected: prefs.customActivityID == custom.id)
                    }
                }
                if prefs.customActivities.count < CustomActivity.maxCount {
                    Button("New activity", systemImage: "plus") { newBase = prefs.defaultActivity; creating = true }
                } else {
                    Text("You can keep up to \(CustomActivity.maxCount) activities of your own. Delete one to add another.").font(.footnote)
                }
            }
            if let custom = prefs.activeCustom {
                Section("Your activity") {
                    TextField("Name", text: $renaming, onCommit: { p.wrappedValue.renameCustomActivity(custom.id, to: renaming) })
                        .onAppear { renaming = custom.label }
                    Button("Delete \(custom.label)", role: .destructive) { confirmDelete = true }
                }
                .confirmationDialog("Delete “\(custom.label)” and its limits?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete", role: .destructive) { p.wrappedValue.deleteCustomActivity(custom.id) }
                }
            }
            LimitsSection(limits: p.limits, activityLabel: prefs.activeLabel,
                          defaults: (prefs.activeCustom?.baseActivity ?? prefs.defaultActivity).defaultLimits)
            Section {
                let timing = p.routeTiming
                Stepper("Travel pace · \(timing.wrappedValue.paceMinutesPerMile) min/mi", value: timing.paceMinutesPerMile, in: RouteTiming.paceRange)
                Stepper("Ascent · \(timing.wrappedValue.ascentMinutesPer1000Ft) min per 1,000 ft", value: timing.ascentMinutesPer1000Ft, in: RouteTiming.ascentRange, step: 5)
                Stepper("Stops and transitions · \(timing.wrappedValue.stopMinutes) min", value: timing.stopMinutes, in: RouteTiming.stopRange, step: 5)
                let defaults = (prefs.activeCustom?.baseActivity ?? prefs.defaultActivity).defaultRouteTiming
                if timing.wrappedValue != defaults {
                    Button("Reset to \((prefs.activeCustom?.baseActivity ?? prefs.defaultActivity).label.lowercased()) defaults") { timing.wrappedValue = defaults }
                }
            } header: {
                Text("Route timing for \(prefs.activeLabel)")
            } footer: {
                Text("Sets when you reach each checkpoint on a route and where you are on the approach each hour.")
            }
        }
        .navigationTitle("Activities and limits")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $creating) {
            NavigationStack {
                Form {
                    TextField("e.g. Winter peak bagging", text: $newName)
                    Picker("Plan it like", selection: $newBase) {
                        ForEach(Activity.allCases) { Text($0.label).tag($0) }
                    }
                    Text("It starts with your \(newBase.label.lowercased()) limits and route timing. Change them once it’s created.").font(.footnote)
                }
                .navigationTitle("New activity")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { creating = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") {
                            _ = p.wrappedValue.addCustomActivity(label: newName, base: newBase)
                            newName = ""
                            creating = false
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func activityRow(symbol: String, title: String, detail: String, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).frame(width: 26).foregroundStyle(Palette.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                Text(detail).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
            }
            Spacer()
            if selected { Image(systemName: "checkmark").foregroundStyle(Palette.accent) }
        }
    }
}

/// Weather limits in the traveler's display units; stored in °F and mph as the backend reads them.
struct LimitsSection: View {
    @Binding var limits: Limits
    var activityLabel: String
    var defaults: Limits

    var body: some View {
        Section {
            Stepper(value: $limits.maxGustMph, in: Limits.gustRange) {
                LabeledContent("Gusts up to", value: Format.mph(Double(limits.maxGustMph)))
            }
            Stepper(value: $limits.maxPrecipChance, in: Limits.precipRange, step: 5) {
                LabeledContent("Rain or snow chance up to", value: "\(limits.maxPrecipChance)%")
            }
            Stepper(value: $limits.minFeelsLikeF, in: Limits.coldRange) {
                LabeledContent("Feels-like at least", value: Format.temp(Double(limits.minFeelsLikeF)))
            }
            Stepper(value: $limits.maxFeelsLikeF, in: Limits.heatRange) {
                LabeledContent("Feels-like at most", value: Format.temp(Double(limits.maxFeelsLikeF)))
            }
            if limits != defaults {
                Button("Reset to defaults") { limits = defaults }
            }
        } header: {
            Text("Limits for \(activityLabel)")
        } footer: {
            Text("Hours past a limit are flagged in the brief. On a sample hour: gusts of \(Format.mph(32)) are \(32 < limits.maxGustMph ? "within" : "over") your limit; a feels-like of \(Format.temp(16)) is \(16 > limits.minFeelsLikeF ? "within" : "below") your floor.")
        }
    }
}

// MARK: - Service status

/// The server's health and what this iPhone allows (the web's Service status page).
struct StatusView: View {
    struct Check: Identifiable {
        var id: String { label }
        var label: String
        var status: String
        var detail: String
        var meta: String?
    }

    @State private var checks: [Check] = []
    @State private var loading = false
    @State private var error: String?
    @State private var checkedAt: Date?

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    Text(note).font(.footnote).foregroundStyle(Palette.secondary)
                    if let checkedAt { Text("Checked \(DateText.relative(checkedAt))").font(.caption).foregroundStyle(Palette.secondary) }
                }
                Button(loading ? "Checking…" : "Run checks", systemImage: "arrow.clockwise") { Task { await run() } }.disabled(loading)
            }
            if let error { Section { Text(error).foregroundStyle(Palette.caution).font(.footnote) } }
            if !checks.isEmpty {
                Section("Services") {
                    ForEach(checks) { check in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: check.status == "ok" ? "checkmark.circle" : check.status == "warn" ? "exclamationmark.triangle" : "xmark.circle")
                                .foregroundStyle(check.status == "ok" ? Palette.accent : Palette.caution)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(check.label).font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text(check.status == "ok" ? "Operational" : check.status == "warn" ? "Degraded" : "Unavailable").font(.caption).foregroundStyle(Palette.secondary)
                                }
                                Text(check.detail).font(.footnote)
                                if let meta = check.meta { Text(meta).font(.caption).foregroundStyle(Palette.secondary) }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Service status")
        .navigationBarTitleDisplayMode(.inline)
        .task { await run() }
    }

    private var title: String {
        if checks.isEmpty { return loading ? "Checking services…" : "No checks yet" }
        let issues = checks.filter { $0.status != "ok" }.count
        return issues == 0 ? "All systems operational" : "\(issues) of \(checks.count) services need attention"
    }

    private var note: String {
        checks.isEmpty ? "Run the checks to see each service."
            : checks.allSatisfy { $0.status == "ok" } ? "\(checks.count) services responding normally."
            : "Reports keep working with partial data where a source is unavailable."
    }

    private func run() async {
        loading = true
        defer { loading = false; checkedAt = Date() }
        var next: [Check] = []
        let started = Date()
        do {
            let health = try await APIClient().health()
            let latency = Int(Date().timeIntervalSince(started) * 1000)
            let ok = health["ok"].bool ?? (health["status"].string == "ok")
            let uptime = health["uptime"].double.map { seconds -> String in
                let d = Int(seconds) / 86400, h = Int(seconds) % 86400 / 3600, m = Int(seconds) % 3600 / 60
                return d > 0 ? "\(d)d \(h)h \(m)m" : h > 0 ? "\(h)h \(m)m" : "\(m)m"
            }
            next.append(Check(label: "Backend API", status: ok ? "ok" : "down",
                              detail: ok ? "\(health["service"].string ?? "Conditions backend") responded healthy (\(health["env"].string ?? "unknown"))." : "The health endpoint returned not-ok.",
                              meta: uptime.map { "Up for \($0) · Node \(health["nodeVersion"].string ?? "?")" }))
            next.append(Check(label: "API latency", status: latency < 400 ? "ok" : latency < 1200 ? "warn" : "down",
                              detail: "Response in \(latency) ms\(latency < 400 ? " — within normal range." : latency < 1200 ? " — slower than expected." : " — very slow, possible network issue.")",
                              meta: "Round trip to /api/healthz"))
            let ai = health["ai"]
            if let provider = ai["provider"].string {
                let configured = ai["configured"].bool ?? false, fallback = ai["fallbackConfigured"].bool ?? false
                next.append(Check(label: "AI provider", status: configured || fallback ? "ok" : "warn",
                                  detail: configured ? "\(provider.capitalized) is preferred; \(fallback ? "automatic failover is ready" : "no fallback provider is configured")."
                                      : fallback ? "\(provider.capitalized) is unavailable; requests use \(ai["fallbackProvider"].string?.capitalized ?? "the fallback")." : "No AI provider has an API key configured.",
                                  meta: [ai["primaryModel"].string.map { "Preferred: \($0)" }, ai["fallbackPrimaryModel"].string.map { "Fallback: \($0)" }].compactMap { $0 }.joined(separator: " · ")))
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        next.append(Check(label: "Notifications", status: settings.authorizationStatus == .authorized ? "ok" : "warn",
                          detail: settings.authorizationStatus == .authorized ? "Watch alerts can reach this iPhone." : "Notifications are off, so watch changes only show in the app."))
        next.append(Check(label: "Background refresh", status: UIApplication.shared.backgroundRefreshStatus == .available ? "ok" : "warn",
                          detail: UIApplication.shared.backgroundRefreshStatus == .available ? "Watched plans can be checked in the background." : "Background App Refresh is off for Conditions."))
        checks = next
    }
}

// MARK: - Policies

/// The privacy policy and terms, as published on the web.
struct LegalView: View {
    enum Kind { case privacy, terms }
    var kind: Kind

    var body: some View {
        SafariView(url: URL(string: "\(AppSettings.webOrigin)/\(kind == .privacy ? "privacy" : "terms")")!)
            .ignoresSafeArea()
            .navigationTitle(kind == .privacy ? "Privacy" : "Terms")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct SafariView: UIViewControllerRepresentable {
    var url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
