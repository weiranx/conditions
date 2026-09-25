import SwiftUI

/// The Plan tab: upcoming plans with each one's sky strip and the backend's decision.
struct PlanListView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var openBrief: (UUID) -> Void
    var newPlan: () -> Void
    var newTrip: () -> Void = {}
    @State private var showSettings = false
    @State private var quickPlace: NewPlanDraft?

    /// The web workspace's quick locations.
    private static let quickLocations = [
        Place(name: "Mount Rainier, Washington · Cascades", lat: 46.8523, lon: -121.7603, elevationFt: 14411, kind: "Peak"),
        Place(name: "Grand Teton, Wyoming · Teton Range", lat: 43.7417, lon: -110.8024, elevationFt: 13775, kind: "Peak"),
        Place(name: "Mount Whitney, California · Sierra Nevada", lat: 36.5786, lon: -118.2923, elevationFt: 14505, kind: "Peak"),
    ]

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Workspace", title: "Plan", subtitle: subtitle)
                Spacer().frame(height: 24)
                if store.plans.isEmpty {
                    emptyState
                    Spacer().frame(height: 26)
                    quickLocations
                } else {
                    if !store.upcoming.isEmpty {
                        SectionHead(title: "Upcoming") {
                            if store.upcoming.contains(where: { store.loading.contains($0.id) }) { ProgressView().controlSize(.small) }
                        }
                        planList(store.upcoming)
                    }
                    Spacer().frame(height: 26)
                    quickLocations
                    Spacer().frame(height: 26)
                    SectionHead("Library")
                    NavigationLink { SavedView(embedded: true) } label: {
                        Card {
                            HStack(spacing: 12) {
                                Image(systemName: "book").font(.title3).foregroundStyle(Palette.accent)
                                    .frame(width: 36, height: 36).background(Palette.fill, in: Circle())
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Saved reports").font(.headline).foregroundStyle(Palette.label)
                                    Text(store.saved.isEmpty ? "Snapshots you keep appear here" : "\(store.saved.count) saved").font(.footnote).foregroundStyle(Palette.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Palette.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    if !store.past.isEmpty {
                        Spacer().frame(height: 26)
                        SectionHead("Past")
                        planList(store.past)
                    }
                }
            }
            .refreshable { await store.refreshAll() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: {
                        if let user = account.user {
                            Text(user.initial).font(.subheadline.weight(.semibold)).frame(width: 28, height: 28)
                                .foregroundStyle(Palette.onAccent).background(Palette.accent, in: Circle())
                        } else {
                            Image(systemName: "person.crop.circle")
                        }
                    }
                    .accessibilityLabel("Account and settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Day trip", systemImage: "sun.max", action: newPlan)
                        if account.flags.tripPlanning { Button("Multi-day trip", systemImage: "tent", action: newTrip) }
                    } label: {
                        Label("New plan", systemImage: "plus")
                    } primaryAction: { newPlan() }
                    .buttonStyle(.glassProminent).tint(Palette.prominent)
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(item: $quickPlace) { draft in
                NewPlanSheet(draft: draft) { plan in
                    store.add(plan)
                    openBrief(plan.id)
                    Task { await store.refresh(plan) }
                }
            }
        }
    }

    private var quickLocations: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead("Quick locations")
            VStack(spacing: 8) {
                ForEach(Self.quickLocations) { place in
                    Button { quickPlace = NewPlanDraft(objective: place) } label: {
                        Card(spacing: 0) {
                            HStack(spacing: 12) {
                                Image(systemName: "mountain.2").foregroundStyle(Palette.accent)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(place.shortName).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.label)
                                    Text(place.region ?? "").font(.caption).foregroundStyle(Palette.secondary)
                                }
                                Spacer()
                                Image(systemName: "arrow.right").foregroundStyle(Palette.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var subtitle: String {
        let count = store.upcoming.count
        let watched = store.watched.count
        if store.plans.isEmpty { return "Check an objective against your limits." }
        let plans = count == 0 ? "No upcoming plans" : count == 1 ? "1 upcoming plan" : "\(count) upcoming plans"
        return watched > 0 ? "\(plans) · \(watched) on your watchlist" : plans
    }

    private func planList(_ plans: [Plan]) -> some View {
        VStack(spacing: 12) {
            ForEach(plans) { plan in
                Button { openBrief(plan.id) } label: { PlanCard(plan: plan) }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Check again", systemImage: "arrow.clockwise") { Task { await store.refresh(plan) } }
                        Button(plan.watched ? "Stop watching" : "Watch", systemImage: plan.watched ? "bell.slash" : "bell") { store.toggleWatch(plan.id) }
                        Button("Delete", systemImage: "trash", role: .destructive) { store.delete(plan.id) }
                    }
            }
        }
        .padding(.horizontal, 16)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Card {
                CardHead("No plans yet")
                Text("Pick an objective, a start time and your limits. Conditions checks weather, avalanche, alerts, air quality and daylight against them.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.label)
                HStack(spacing: 10) {
                    Button("New plan", systemImage: "plus", action: newPlan).buttonStyle(.glassProminent).tint(Palette.prominent)
                    Button("Try a sample") { store.addSamplePlan() }.buttonStyle(.glass)
                }
                .padding(.top, 6)
            }
            Caption("The sample uses a saved Mount Shasta report, so it works without a server.")
                .padding(.horizontal, 6)
        }
        .padding(.horizontal, 16)
    }
}

/// One plan: name, decision, when, the day's sky and the leading reason.
struct PlanCard: View {
    @Environment(PlanStore.self) private var store
    var plan: Plan

    var body: some View {
        let level = store.level(plan)
        let report = store.report(plan)
        ItemCard(
            title: plan.title,
            level: store.loading.contains(plan.id) && level == .unknown ? nil : level,
            meta: meta,
            tiles: tiles,
            stripStart: labels.0,
            stripEnd: labels.1,
            caption: caption,
            captionTone: level == .caution || level == .noGo ? Palette.caution : Palette.secondary,
            captionEmphasized: level == .caution || level == .noGo,
            levelLabel: plan.isTrip && store.trip(plan) != nil && store.trip(plan)?.itinerary == nil ? "No trip verdict" : nil
        ) {
            if store.loading.contains(plan.id) && report == nil && store.trip(plan) == nil {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Caption("Checking conditions…") }
            }
        }
    }

    private var meta: String {
        if plan.isSample { return "Sample · \(plan.activityLabel) · \(DateText.short(plan.date))" }
        if plan.isTrip, let stages = plan.stages {
            return "\(plan.activityLabel) · \(DateText.range(plan.date, plan.endDate)) · \(stages.count) days"
        }
        return "\(plan.activityLabel) · \(DateText.short(plan.date)) · \(DateText.clock(plan.start))"
    }

    private var tiles: [SkyTile] {
        if plan.isTrip { return TripTiles.tiles(plan: plan, trip: store.trip(plan)) }
        return store.report(plan)?.skyTiles ?? []
    }

    private var labels: (String?, String?) {
        if plan.isTrip { return ("Day 1", "Day \(plan.stages?.count ?? 0)") }
        guard let labels = store.report(plan)?.stripLabels else { return (nil, nil) }
        return (labels.0, labels.1)
    }

    private var caption: String? {
        if let error = store.errors[plan.id] { return error }
        return store.summary(plan) ?? (store.loading.contains(plan.id) ? nil : "Not checked yet. Pull to check.")
    }
}
