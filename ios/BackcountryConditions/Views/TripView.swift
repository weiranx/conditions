import SwiftUI

/// One tile per day and camp night of a trip, marked by what the backend found.
enum TripTiles {
    static func tiles(plan: Plan, trip: TripResult?) -> [SkyTile] {
        let count = plan.stages?.count ?? 0
        return (0..<count).flatMap { index -> [SkyTile] in
            let day = TripDay(trip: trip, index: index)
            var tiles = [SkyTile(kind: day.level == .unknown ? .day : .day, over: day.level == .caution || day.level == .noGo, missing: trip == nil || day.level == .unknown)]
            if index < count - 1 {
                let night = TripNight(trip: trip, index: index)
                tiles.append(SkyTile(kind: .night, over: night.kind == .over || night.kind == .stop, missing: trip == nil || night.kind == .missing))
            }
            return tiles
        }
    }
}

/// A trip day as the itinerary check (or its per-day fallback) evaluated it.
struct TripDay {
    var level: DecisionLevel
    var reason: String?
    var report: Report?

    init(trip: TripResult?, index: Int) {
        report = trip?.stageReport(index)
        if let itinerary = trip?.itinerary {
            let day = itinerary.at("assessment.days")[index]
            level = DecisionLevel(day["level"].string)
            reason = day["limitingChecks"].strings.first ?? day.at("day.decisionHeadline").string
        } else if let report {
            level = report.level
            reason = report.limitingChecks.first ?? report.reason
        } else {
            level = .unknown
            reason = trip == nil ? nil : "This day could not be checked."
        }
    }
}

/// A camp night: the backend's night-at-camp check.
struct TripNight {
    var kind: TagKind
    var word: String
    var summary: String?
    var coldestF: Double?

    init(trip: TripResult?, index: Int) {
        let data: JSON
        var state: String?
        if let itinerary = trip?.itinerary {
            let night = itinerary.at("assessment.nights")[index]
            data = night["data"]
            state = night["state"].string
        } else {
            data = trip?.stageReport(index)?.campNight ?? .null
            switch data["severity"].string {
            case "high": state = "serious"
            case "moderate": state = "hard"
            case "low": state = "ok"
            default: state = data["status"].string == "ok" ? "ok" : "unavailable"
            }
        }
        summary = data["summary"].string
        coldestF = data["minFeelsLikeF"].double
        switch state {
        case "serious": kind = .stop; word = "Serious"
        case "hard": kind = .over; word = "Hard night"
        case "ok", "fine", "comfortable": kind = .ok; word = "Fine"
        default: kind = .missing; word = trip == nil ? "Not checked" : "Unavailable"
        }
    }
}

/// A multi-day trip's brief: the trip verdict, then each day and camp night.
struct TripView: View {
    @Environment(PlanStore.self) private var store
    var plan: Plan
    @State private var editing: NewPlanDraft?
    @State private var dayDetail: DayDetail?

    struct DayDetail: Identifiable, Hashable {
        var id: Int { index }
        var index: Int
        var plan: Plan
    }

    private var trip: TripResult? { store.trip(plan) }
    private var stages: [Stage] { plan.stages ?? [] }

    var body: some View {
        Page {
            PageHeader(kicker: "\(plan.activity.label) · \(stages.count) days",
                       title: plan.objective.shortName,
                       subtitle: "\(DateText.range(plan.date, plan.endDate)) · from \(stages.first?.from.shortName ?? plan.objective.shortName)")
            Spacer().frame(height: 20)
            verdict.padding(.horizontal, 16)
            Spacer().frame(height: 28)
            SectionHead(title: "Days and nights") {
                if store.loading.contains(plan.id) { ProgressView().controlSize(.small) }
            }
            VStack(spacing: 10) {
                ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                    dayCard(index, stage)
                    if index < stages.count - 1 { nightCard(index, stage) }
                }
            }
            .padding(.horizontal, 16)
            Caption("Planning evidence, not a guarantee of safety. Check again closer to the trip; forecasts beyond a few days are less certain.")
                .padding(.horizontal, 20).padding(.top, 16)
        }
        .refreshable { await store.refresh(plan) }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { PlanSwitcher() }
            ToolbarItem(placement: .topBarTrailing) { Button("Edit plan") { editing = NewPlanDraft(editing: plan) } }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(plan.watched ? "Stop watching" : "Watch", systemImage: plan.watched ? "bell.fill" : "bell") { store.toggleWatch(plan.id) }
                Menu {
                    Button("Check again", systemImage: "arrow.clockwise") { Task { await store.refresh(plan) } }
                    Button("Delete trip", systemImage: "trash", role: .destructive) { store.delete(plan.id) }
                } label: { Label("More", systemImage: "ellipsis") }
            }
        }
        .navigationDestination(item: $dayDetail) { detail in
            BriefView(plan: detail.plan, snapshot: trip?.stageReport(detail.index), note: "This day was checked with your trip and won’t update on its own. Check the trip again for newer forecasts.")
        }
        .sheet(item: $editing) { draft in
            NewPlanSheet(draft: draft) { updated in
                store.update(updated)
                Task { await store.refresh(updated) }
            }
        }
        .task { if trip == nil && !store.loading.contains(plan.id) { await store.refresh(plan) } }
    }

    private var verdict: some View {
        Card(spacing: 6) {
            if let trip {
                HStack {
                    VerdictPill(level: trip.itinerary == nil ? .unknown : trip.level, label: trip.itinerary == nil ? "No trip verdict" : nil)
                    Spacer()
                    Text("Checked \(DateText.relative(trip.checkedAt))").font(.caption).foregroundStyle(Palette.secondary)
                }
                if trip.itinerary != nil {
                    Text(trip.headline ?? "The trip is its weakest day or night.")
                        .font(.title3.weight(.semibold)).foregroundStyle(Palette.label).padding(.top, 6)
                    if let weak = trip.itinerary?.at("assessment.weakLink.reason").string {
                        Text(weak).font(.subheadline).foregroundStyle(Palette.label)
                    }
                    if (trip.itinerary?.at("assessment.unresolved").int ?? 0) > 0 {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "questionmark.circle").foregroundStyle(Palette.missing)
                            Caption("Some days or nights aren’t checked yet. Missing data doesn’t mean conditions are clear.", tone: Palette.missing)
                        }
                    }
                } else {
                    Text("Not checked as a whole trip").font(.title3.weight(.semibold)).foregroundStyle(Palette.label).padding(.top, 6)
                    Caption(trip.fallbackReason ?? "Each day was checked on its own.")
                }
                DayStrip(tiles: TripTiles.tiles(plan: plan, trip: trip), start: "Day 1", end: "Day \(stages.count)").padding(.top, 8)
            } else if store.loading.contains(plan.id) {
                HStack(spacing: 10) { ProgressView(); Text("Checking every day and camp night…").font(.subheadline).foregroundStyle(Palette.secondary) }
            } else if let error = store.errors[plan.id] {
                Caption(error, tone: Palette.caution)
                Button("Try again") { Task { await store.refresh(plan) } }.buttonStyle(.glass)
            } else {
                Button("Check trip") { Task { await store.refresh(plan) } }.buttonStyle(.glassProminent).tint(Palette.prominent)
            }
        }
    }

    private func dayCard(_ index: Int, _ stage: Stage) -> some View {
        let day = TripDay(trip: trip, index: index)
        let date = DateText.addDays(plan.date, index)
        let labels = day.report?.stripLabels
        return Button {
            guard day.report != nil else { return }
            var dayPlan = plan
            dayPlan.stages = nil
            dayPlan.objective = stage.to
            dayPlan.date = date
            dayPlan.start = stage.start
            dayPlan.travelHours = stage.travelHours
            dayDetail = DayDetail(index: index, plan: dayPlan)
        } label: {
            ItemCard(
                title: "Day \(index + 1) · \(DateText.short(date))",
                level: trip == nil ? nil : day.level,
                meta: stage.from == stage.to ? "Layover at \(stage.to.shortName)" : "\(stage.from.shortName) to \(stage.to.shortName) · \(DateText.clock(stage.start)), \(stage.travelHours) h",
                tiles: day.report?.skyTiles ?? [],
                stripStart: labels?.0, stripEnd: labels?.1,
                caption: day.level == .go ? nil : day.reason,
                captionTone: day.level == .caution || day.level == .noGo ? Palette.caution : Palette.secondary,
                captionEmphasized: day.level == .caution || day.level == .noGo)
        }
        .buttonStyle(.plain)
    }

    private func nightCard(_ index: Int, _ stage: Stage) -> some View {
        let night = TripNight(trip: trip, index: index)
        return Card(missing: trip != nil && night.kind == .missing, spacing: 4) {
            HStack {
                Text("Night \(index + 1) · \(stage.to.shortName)").font(.headline).foregroundStyle(Palette.label).lineLimit(1)
                Spacer()
                if trip != nil { StatusTag(kind: night.kind, text: night.word) }
            }
            Text([stage.to.elevationFt.map(Format.feet), night.coldestF.map { "coldest feels \(Format.temp($0))" }].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(Palette.secondary)
            if let summary = night.summary {
                Caption(summary, tone: night.kind == .over || night.kind == .stop ? Palette.caution : Palette.secondary,
                        emphasized: night.kind == .over || night.kind == .stop)
            }
        }
    }
}
