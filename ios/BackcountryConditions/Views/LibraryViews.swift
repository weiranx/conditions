import SwiftUI

/// Saved snapshots: reports kept as they were, which never update.
struct SavedView: View {
    @Environment(PlanStore.self) private var store
    /// Pushed inside another navigation stack rather than owning one.
    var embedded = false

    var body: some View {
        if embedded { content } else { NavigationStack { content } }
    }

    private var content: some View {
            Page {
                PageHeader(kicker: "Library", title: "Saved", subtitle: store.saved.isEmpty ? nil : (store.saved.count == 1 ? "1 saved report" : "\(store.saved.count) saved reports"))
                Spacer().frame(height: 24)
                if store.saved.isEmpty {
                    Notice(tone: .info, text: "Save a brief to keep it as it was. Saved reports don’t update, so they’re a record of what you knew when you decided.")
                } else {
                    VStack(spacing: 12) {
                        ForEach(store.saved) { item in
                            let report = try? Report(data: item.reportData)
                            NavigationLink {
                                if let report { BriefView(plan: item.plan, snapshot: report, savedAt: item.savedAt) }
                            } label: {
                                ItemCard(title: item.plan.objective.shortName, level: report?.level,
                                         meta: "\(DateText.short(item.plan.date)) · saved \(item.savedAt.formatted(date: .abbreviated, time: .shortened))",
                                         tiles: report?.skyTiles ?? [], stripStart: report?.stripLabels?.0, stripEnd: report?.stripLabels?.1,
                                         caption: report?.limitingChecks.first ?? report?.headline)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Delete", systemImage: "trash", role: .destructive) { store.deleteSaved(item.id) }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
    }
}

/// Watched plans: checked again on refresh, with any change in the backend's decision called out.
struct WatchlistView: View {
    @Environment(PlanStore.self) private var store
    var openBrief: (UUID) -> Void

    private var changed: [Plan] { store.watched.filter { !($0.watch?.reviewed ?? true) } }
    private var steady: [Plan] { store.watched.filter { $0.watch?.reviewed ?? true } }

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Workspace", title: "Watchlist",
                           subtitle: "Pull to check watched plans again. Any change in the decision shows here.")
                Spacer().frame(height: 24)
                if store.watched.isEmpty {
                    Notice(tone: .info, text: "Watch a plan from its brief to keep an eye on it. Each check compares the new decision with the last one.")
                }
                if !changed.isEmpty {
                    SectionHead(title: "Changed") { Text("Not reviewed") }
                    cards(changed, showChange: true)
                    Spacer().frame(height: 28)
                }
                if !steady.isEmpty {
                    SectionHead(changed.isEmpty ? "Watching" : "No change")
                    cards(steady, showChange: false)
                }
            }
            .refreshable { await store.refreshAll(store.watched) }
            .toolbar {
                if !store.watched.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Check all", systemImage: "arrow.clockwise") { Task { await store.refreshAll(store.watched) } }
                    }
                }
            }
        }
    }

    private func cards(_ plans: [Plan], showChange: Bool) -> some View {
        VStack(spacing: 12) {
            ForEach(plans) { plan in
                let watch = plan.watch
                ItemCard(title: plan.objective.shortName,
                         level: showChange ? nil : store.level(plan),
                         meta: plan.isTrip ? DateText.range(plan.date, plan.endDate) : "\(DateText.short(plan.date)) · \(DateText.clock(plan.start))",
                         tiles: plan.isTrip ? TripTiles.tiles(plan: plan, trip: store.trip(plan)) : store.report(plan)?.skyTiles ?? [],
                         caption: showChange ? nil : caption(plan)) {
                    if showChange, let watch {
                        HStack(spacing: 8) {
                            if let previous = watch.previousLevel { LevelTag(level: previous) }
                            Image(systemName: "arrow.right").font(.caption).foregroundStyle(Palette.secondary)
                            LevelTag(level: watch.level)
                        }
                        .padding(.top, 2)
                        if let reason = watch.reason { Caption(reason) }
                    }
                    Divider().padding(.top, 6)
                    HStack {
                        Text(watch.map { "Checked \(DateText.relative($0.checkedAt))" } ?? "Not checked yet")
                            .font(.footnote).foregroundStyle(Palette.secondary)
                        Spacer()
                        if store.loading.contains(plan.id) { ProgressView().controlSize(.small) }
                        if showChange {
                            Button("Mark reviewed") { store.markReviewed(plan.id) }.buttonStyle(.glass).controlSize(.small)
                        }
                        Button("Open") { store.markReviewed(plan.id); openBrief(plan.id) }.buttonStyle(.glassProminent).tint(Palette.prominent).controlSize(.small)
                    }
                    .padding(.top, 4)
                }
                .contextMenu {
                    Button("Stop watching", systemImage: "bell.slash") { store.toggleWatch(plan.id) }
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func caption(_ plan: Plan) -> String? {
        if let error = store.errors[plan.id] { return error }
        if plan.watch?.incomplete == true { return "Some source data was missing, so a change may not show. \(store.summary(plan) ?? "")" }
        return store.summary(plan)
    }
}

/// Server and sample settings.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PlanStore.self) private var store
    @AppStorage(AppSettings.serverKey) private var server = AppSettings.defaultServer
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
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
                Section {
                    Text("Conditions is planning evidence, not a guarantee of safety. Missing data never means conditions are clear. Check the official forecasts and use your judgment in the field.")
                        .font(.footnote)
                } header: { Text("About") }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done", systemImage: "checkmark") { dismiss() }.buttonStyle(.glassProminent).tint(Palette.prominent) }
            }
        }
    }

    private func test() async {
        testing = true
        defer { testing = false }
        do {
            let health = try await APIClient().health()
            status = "Connected. \(health["status"].string.map { "Status: \($0)." } ?? "")"
        } catch {
            status = error.localizedDescription
        }
    }
}
