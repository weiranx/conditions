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
            case "low": state = data["complete"].bool == false ? "incomplete" : "settled"
            default: state = data.isNull ? "unavailable" : data["status"].string == "ok" ? "settled" : "not-forecast"
            }
        }
        summary = data["summary"].string
        coldestF = data["minFeelsLikeF"].double
        switch state {
        case "serious": kind = .stop; word = "Serious"
        case "hard": kind = .over; word = "Hard night"
        case "settled": kind = .ok; word = "Fine"
        case "incomplete": kind = .missing; word = "Partly forecast"
        case "not-forecast": kind = .missing; word = "Not yet forecast"
        default: kind = .missing; word = trip == nil ? "Not checked" : "Unavailable"
        }
    }
}

/// A multi-day trip's brief: the trip verdict, then each day and camp night.
struct TripView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var plan: Plan
    @State private var editing: NewPlanDraft?
    @State private var dayDetail: DayDetail?
    @State private var feedback: String?
    @State private var busy = false
    @State private var chatOpen = false
    @State private var chat: [ChatMessage] = []
    @State private var signIn = false
    @State private var alternatives: [(date: String, result: TripResult?, error: String?)] = []
    @State private var checkingAlternatives = false
    @State private var confirmDelete = false

    struct DayDetail: Identifiable, Hashable {
        var id: Int { index }
        var index: Int
        var plan: Plan
    }

    private var current: Plan { store.plan(plan.id) ?? plan }
    private var trip: TripResult? { store.trip(plan) }
    private var stages: [Stage] { current.stages ?? [] }

    var body: some View {
        Page {
            PageHeader(kicker: "\(current.activityLabel) · \(stages.count) days",
                       title: current.title,
                       subtitle: "\(DateText.range(current.date, current.endDate)) · from \(stages.first?.from.shortName ?? current.objective.shortName)")
            Spacer().frame(height: 20)
            verdict.padding(.horizontal, 16)
            if let feedback {
                Spacer().frame(height: 12)
                Notice(tone: .info, text: feedback)
            }
            Spacer().frame(height: 16)
            actions
            Spacer().frame(height: 28)
            SectionHead(title: "Day by day") {
                if store.loading.contains(plan.id) { ProgressView().controlSize(.small) }
            }
            VStack(spacing: 10) {
                ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                    dayCard(index, stage)
                    if index < stages.count - 1 { nightCard(index, stage) }
                }
            }
            .padding(.horizontal, 16)
            if let bails = current.bailPoints, !bails.isEmpty {
                Spacer().frame(height: 28)
                SectionHead("Ways out")
                Card(spacing: 6) {
                    ForEach(Array(bails.enumerated()), id: \.offset) { _, point in
                        Label(point.shortName, systemImage: "arrow.uturn.left").font(.subheadline)
                    }
                    Caption("Straight-line distances to the nearest way out are on each night.")
                }
                .padding(.horizontal, 16)
            }
            if trip?.itinerary != nil {
                Spacer().frame(height: 28)
                ChatLauncher(title: "Ask about this trip", context: "\(current.title) · \(stages.count) days", messageCount: chat.count, readOnly: false) {
                    if account.signedIn { chatOpen = true } else { signIn = true }
                }
                Spacer().frame(height: 28)
                otherStarts
            }
            Caption("Planning evidence, not a guarantee of safety. Check again closer to the trip; forecasts beyond a few days are less certain.")
                .padding(.horizontal, 20).padding(.top, 16)
        }
        .refreshable { await store.refresh(plan) }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { PlanSwitcher() }
            ToolbarItem(placement: .topBarTrailing) { Button("Edit plan") { editing = NewPlanDraft(editing: current) } }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(current.watched ? "Stop watching" : "Watch", systemImage: current.watched ? "bell.fill" : "bell") { store.toggleWatch(plan.id) }
                Menu {
                    Button("Check again", systemImage: "arrow.clockwise") { Task { await store.refresh(plan) } }
                    if account.flags.reportHistory {
                        Button("Save to your account", systemImage: "icloud.and.arrow.up") { accountAction { try await store.saveTripToAccount(current); return "Trip saved to your account. Find it under Saved." } }
                            .disabled(trip?.itinerary == nil)
                    }
                    if account.flags.objectiveWatch {
                        Button("Watch each day in your account", systemImage: "bell.badge") { accountAction { try await store.watchTripDaysOnAccount(current) } }
                            .disabled(trip == nil)
                    }
                    if let trip {
                        ShareLink(item: tripSummary(trip)) { Label("Share summary", systemImage: "square.and.arrow.up") }
                    }
                    Button("Delete trip", systemImage: "trash", role: .destructive) { confirmDelete = true }
                } label: { Label("More", systemImage: "ellipsis") }
            }
        }
        .navigationDestination(item: $dayDetail) { detail in
            BriefView(plan: detail.plan, snapshot: trip?.stageReport(detail.index), note: "Day \(detail.index + 1) of \(stages.count), checked with your trip. Check the trip again for newer forecasts.")
        }
        .sheet(item: $editing) { draft in
            NewPlanSheet(draft: draft) { updated in
                store.update(updated)
                Task { await store.refresh(updated) }
            }
        }
        .sheet(isPresented: $chatOpen) {
            ChatView(title: "Ask about this trip", context: "\(current.title) · \(stages.count) days", contextType: "itinerary",
                     payload: String(decoding: (trip?.chatContext ?? .null).data(), as: UTF8.self), readOnly: false, messages: chat,
                     onChange: { chat = $0 }, onSignIn: { signIn = true })
        }
        .sheet(isPresented: $signIn) {
            NavigationStack {
                AccountView(reason: "Sign in to save trips, watch each day and use the trip assistant.")
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { signIn = false } } }
            }
        }
        .confirmationDialog("Delete this trip?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete trip", role: .destructive) { store.delete(plan.id) }
        }
        .task { if trip == nil && !store.loading.contains(plan.id) { await store.refresh(plan) } }
    }

    private var actions: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button { accountAction { try await store.saveTripToAccount(current); return "Trip saved to your account. Find it under Saved." } } label: {
                    Label("Save trip", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .disabled(busy || trip?.itinerary == nil || !account.flags.reportHistory)
                Button { accountAction { try await store.watchTripDaysOnAccount(current) } } label: {
                    Label("Watch days", systemImage: "bell").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .disabled(busy || trip == nil || !account.flags.objectiveWatch)
            }
            .controlSize(.large)
            .lineLimit(1)
        }
        .padding(.horizontal, 16)
    }

    private func accountAction(_ action: @escaping () async throws -> String) {
        guard account.signedIn else { signIn = true; return }
        busy = true
        feedback = nil
        Task {
            do { feedback = try await action() } catch { feedback = error.localizedDescription }
            busy = false
        }
    }

    private func tripSummary(_ trip: TripResult) -> String {
        var lines = ["\(current.title) — \(trip.itinerary == nil ? "no trip verdict" : trip.level.label)", DateText.range(current.date, current.endDate)]
        if let headline = trip.headline { lines.append(headline) }
        for (index, stage) in stages.enumerated() {
            let day = TripDay(trip: trip, index: index)
            lines.append("Day \(index + 1): \(stage.from.shortName) → \(stage.to.shortName) · \(day.level.label)\(day.reason.map { " — \($0)" } ?? "")")
        }
        lines.append("Planning evidence, not a guarantee of safety.")
        return lines.joined(separator: "\n")
    }

    private var verdict: some View {
        Card(spacing: 6) {
            if let trip {
                HStack {
                    VerdictPill(level: trip.itinerary == nil ? .unknown : trip.level, label: trip.itinerary == nil ? "No trip verdict" : trip.itinerary?.at("assessment.level").string == "INCOMPLETE" ? "Incomplete" : nil)
                    Spacer()
                    Text("Checked \(DateText.relative(trip.checkedAt))").font(.caption).foregroundStyle(Palette.secondary)
                }
                if trip.itinerary != nil {
                    Text(trip.headline ?? "The trip is its weakest day or night.")
                        .font(.title3.weight(.semibold)).foregroundStyle(Palette.label).padding(.top, 6)
                    if let reason = trip.headlineReason ?? trip.itinerary?.at("assessment.weakLink.reason").string {
                        Text(reason).font(.subheadline).foregroundStyle(Palette.label)
                    }
                    let also = trip.itinerary?.at("assessment.alsoLimiting").array ?? []
                    ForEach(Array(also.enumerated()), id: \.offset) { _, link in
                        if let reason = link["reason"].string { Caption("• \(reason)") }
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
                DayStrip(tiles: TripTiles.tiles(plan: current, trip: trip), start: "Day 1", end: "Day \(stages.count)").padding(.top, 8)
            } else if store.loading.contains(plan.id) {
                HStack(spacing: 10) { ProgressView(); Text("Checking \(stages.count) days and \(stages.count - 1) nights…").font(.subheadline).foregroundStyle(Palette.secondary) }
                Caption("Each day at its camp and high points, then each night at camp. This takes a little longer than a single day.")
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
        let date = DateText.addDays(current.date, index)
        let labels = day.report?.stripLabels
        let assessment = trip?.itinerary?.at("assessment.days")[index] ?? .null
        return Button {
            guard day.report != nil, let dayPlan = current.dayPlan(index) else { return }
            dayDetail = DayDetail(index: index, plan: dayPlan)
        } label: {
            ItemCard(
                title: "Day \(index + 1) · \(DateText.short(date))",
                level: trip == nil ? nil : day.level,
                meta: stage.isLayover ? "Layover at \(stage.to.shortName)" : "\(stage.from.shortName) to \(stage.to.shortName) · \(DateText.clock(stage.start)), \(stage.travelHours) h",
                tiles: day.report?.skyTiles ?? [],
                stripStart: labels?.0, stripEnd: labels?.1,
                caption: day.level == .go ? nil : day.reason,
                captionTone: day.level == .caution || day.level == .noGo ? Palette.caution : Palette.secondary,
                captionEmphasized: day.level == .caution || day.level == .noGo) {
                ForEach(Array((stage.checkpoints ?? []).enumerated()), id: \.offset) { checkpoint, point in
                    let report = trip?.checkpointReport(index, checkpoint)
                    HStack {
                        Label(point.shortName, systemImage: "mountain.2").font(.footnote)
                        Spacer()
                        if let report { LevelTag(level: report.level) } else if trip != nil { Text("Not checked").font(.caption).foregroundStyle(Palette.secondary) }
                    }
                }
                if let place = assessment["limitingPlace"].string, trip != nil { Caption("Limited at \(place)") }
                if assessment["lowConfidence"].bool == true || (assessment["daysAhead"].int ?? 0) >= 5 {
                    Caption("Forecasts this far out are less certain.", tone: Palette.missing)
                }
                if assessment["avalancheNotIssued"].bool == true { Caption("No avalanche forecast is issued for this day yet.", tone: Palette.missing) }
                if day.report != nil { OpenLink(label: "Day \(index + 1) brief") }
            }
        }
        .buttonStyle(.plain)
    }

    private func nightCard(_ index: Int, _ stage: Stage) -> some View {
        let night = TripNight(trip: trip, index: index)
        let assessment = trip?.itinerary?.at("assessment.nights")[index] ?? .null
        let coldest = trip?.itinerary?.at("assessment.coldestNightIndex").int == index
        return Card(missing: trip != nil && night.kind == .missing, spacing: 4) {
            HStack {
                Text("Night \(index + 1) · \(stage.to.shortName)").font(.headline).foregroundStyle(Palette.label).lineLimit(1)
                Spacer()
                if trip != nil { StatusTag(kind: night.kind, text: night.word) }
            }
            Text([stage.to.elevationFt.map(Format.feet), night.coldestF.map { "coldest feels \(Format.temp($0))" }, coldest ? "coldest night" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(Palette.secondary)
            if let summary = night.summary {
                Caption(summary, tone: night.kind == .over || night.kind == .stop ? Palette.caution : Palette.secondary,
                        emphasized: night.kind == .over || night.kind == .stop)
            }
            let exit = assessment["nearestExit"]
            if let miles = exit["miles"].double {
                Caption("Nearest way out: \(exit["name"].string ?? "exit"), \(Format.miles(miles)) in a straight line.")
            }
            if assessment["layoverFollows"].bool == true { Caption("You stay here another night.") }
        }
    }

    /// The same trip starting on nearby dates, each checked as a whole (the web's "Other start dates").
    private var otherStarts: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(title: "Other start dates") { if checkingAlternatives { ProgressView().controlSize(.small) } }
            VStack(spacing: 10) {
                if alternatives.isEmpty {
                    Caption("Check the same trip starting a day or two earlier or later. Each check counts toward your multi-day allowance.")
                    Button("Compare start dates", systemImage: "calendar") { Task { await compareStarts() } }
                        .buttonStyle(.glass).disabled(checkingAlternatives || !account.signedIn)
                }
                ForEach(Array(alternatives.enumerated()), id: \.offset) { _, item in
                    Card(spacing: 4) {
                        HStack {
                            Text("Starting \(DateText.short(item.date))").font(.headline)
                            Spacer()
                            if let result = item.result { LevelTag(level: result.level) } else if item.error == nil { ProgressView().controlSize(.small) }
                        }
                        if let headline = item.result?.headline { Caption(headline) }
                        if let error = item.error { Caption(error, tone: Palette.caution) }
                        if item.result != nil {
                            Button("Use this start date") { useStart(item.date) }.buttonStyle(.glass).controlSize(.small)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func compareStarts() async {
        checkingAlternatives = true
        defer { checkingAlternatives = false }
        let lastForecast = DateText.addDays(DateText.today(), 7)
        let dates = [-2, -1, 1, 2].map { DateText.addDays(current.date, $0) }
            .filter { $0 >= DateText.today() && DateText.addDays($0, stages.count - 1) <= lastForecast }
        guard !dates.isEmpty else {
            feedback = "No other start date keeps the whole trip within the 7-day forecast."
            return
        }
        alternatives = dates.map { ($0, nil, nil) }
        for (index, date) in dates.enumerated() {
            let outcome: Result<TripResult, Error>
            do { outcome = .success(try await store.checkTrip(current, startingOn: date)) } catch { outcome = .failure(error) }
            // "Use this start date" clears the list while later dates are still being checked.
            guard alternatives.indices.contains(index), alternatives[index].date == date else { return }
            switch outcome {
            case .success(let result):
                alternatives[index].result = result
            case .failure(let error as APIError) where error.limitReached:
                alternatives[index].error = "Your multi-day allowance is used up."
                for rest in (index + 1)..<alternatives.count { alternatives[rest].error = "Not checked." }
                return
            case .failure(let error):
                alternatives[index].error = error.localizedDescription
            }
        }
    }

    private func useStart(_ date: String) {
        var next = current
        next.date = date
        store.update(next)
        alternatives = []
        Task { await store.refresh(next) }
    }
}
