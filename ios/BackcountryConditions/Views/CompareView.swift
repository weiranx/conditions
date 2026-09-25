import SwiftUI

/// Compare: the same plan across days, a shortlist of objectives, or routes up one objective
/// (the web's Compare days / objectives / routes). Every decision and ranking is the backend's.
struct CompareView: View {
    @Environment(AccountStore.self) private var account

    enum Mode: String, CaseIterable, Identifiable {
        case days = "Days", objectives = "Objectives", routes = "Routes"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .days

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Compare", title: title, subtitle: subtitle)
                Spacer().frame(height: 14)
                Picker("Compare", selection: $mode) {
                    ForEach(Mode.allCases.filter { $0 != .routes || account.flags.routeAnalysis }) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                Spacer().frame(height: 16)
                switch mode {
                case .days: CompareDays()
                case .objectives: CompareObjectives()
                case .routes: CompareRoutes()
                }
            }
        }
    }

    private var title: String {
        switch mode {
        case .days: "Compare days"
        case .objectives: "Where should you go?"
        case .routes: "Which way up?"
        }
    }

    private var subtitle: String {
        switch mode {
        case .days: "The same plan across the next few days."
        case .objectives: "Compare your shortlist, find the tradeoffs, and keep a backup plan."
        case .routes: "Routes up one objective, each checked at timed checkpoints against your limits."
        }
    }
}

// MARK: - Days

struct CompareDays: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var planID: UUID?
    @State private var days = 5
    @State private var result: Result?
    @State private var loading = false
    @State private var error: String?
    @State private var openDay: DayOpen?
    @State private var chatOpen = false
    @State private var chat: [ChatMessage] = []
    @State private var signIn = false

    struct DayOpen: Identifiable, Hashable {
        var id: String { plan.date }
        var plan: Plan
        var report: Report

        static func == (a: DayOpen, b: DayOpen) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    struct Day: Identifiable {
        var id: String { date }
        var date: String
        var level: DecisionLevel
        var headline: String?
        var concern: String?
        var score: Int?
        var report: Report?
        var json: JSON = .null
    }

    struct Result {
        var days: [Day]
        var bestDate: String?
        var tied: [String] = []
        var highlights: [JSON] = []
        var chatContext: JSON = .null
        var note: String?
        var ranked: Bool
    }

    private var dayPlans: [Plan] { store.upcoming.filter { !$0.isTrip } }
    private var plan: Plan? { dayPlans.first { $0.id == planID } ?? dayPlans.first }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if dayPlans.isEmpty {
                Notice(tone: .info, text: "Make a day plan first, then compare it across days here.")
            } else {
                controls
                Spacer().frame(height: 24)
                resultView
            }
        }
        .navigationDestination(item: $openDay) { day in
            BriefView(plan: day.plan, snapshot: day.report, note: "Checked in Compare. Open the plan itself for current conditions.")
        }
        .sheet(isPresented: $chatOpen) {
            if let result, let plan {
                ChatView(title: "Ask about these days", context: "\(plan.objective.shortName) · \(result.days.count) days", contextType: "trip",
                         payload: String(decoding: result.chatContext.data(), as: UTF8.self), readOnly: false, messages: chat,
                         onChange: { chat = $0 }, onSignIn: { signIn = true })
            }
        }
        .sheet(isPresented: $signIn) {
            NavigationStack {
                AccountView(reason: "Sign in to compare days and ask the assistant about them.")
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { signIn = false } } }
            }
        }
    }

    private var controls: some View {
        Card(spacing: 10) {
            CardHead(title: "Plan") {
                Menu {
                    ForEach(dayPlans) { item in
                        Button(item.objective.shortName) { planID = item.id; result = nil; chat = [] }
                    }
                } label: { Label(plan?.objective.shortName ?? "Choose", systemImage: "chevron.up.chevron.down").font(.footnote.weight(.semibold)) }
            }
            if let plan { Caption("\(DateText.clock(plan.start)) start · \(plan.travelHours) hours · \(plan.activityLabel)") }
            HStack {
                Text(plan.map { "From \(DateText.short($0.date))" } ?? "").font(.subheadline)
                Spacer()
                Stepper("\(days) days", value: $days, in: 2...7).fixedSize()
            }
            Button {
                Task { await compare() }
            } label: {
                Label(loading ? "Comparing…" : "Compare days", systemImage: "sunrise").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent).tint(Palette.prominent)
            .disabled(loading || plan == nil || plan?.isSample == true)
            if plan?.isSample == true {
                Caption("The sample plan can’t be compared; comparing checks live forecasts.")
            }
            if let usage = account.multiDayUsage, !usage.unlimited, let remaining = usage.remaining {
                Caption("\(Int(remaining)) multi-day comparisons left this month.")
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var resultView: some View {
        if let error {
            Notice(tone: .caution, text: error)
        }
        if let result, let plan {
            if let best = result.days.first(where: { $0.date == result.bestDate }) {
                SectionHead("Best day")
                Card(spacing: 8) {
                    HStack {
                        Text(DateText.long(best.date)).font(.display(26)).tracking(-0.4)
                        Spacer()
                        VerdictPill(level: best.level)
                    }
                    Caption(best.headline ?? "")
                    if !result.tied.isEmpty {
                        Caption("Tied with \(result.tied.map(DateText.short).joined(separator: ", ")).")
                    }
                    if let report = best.report {
                        DayStrip(tiles: report.skyTiles, start: report.stripLabels?.0, end: report.stripLabels?.1).padding(.vertical, 4)
                        HStack {
                            Button("Open this day", systemImage: "chevron.right") { open(best, plan: plan) }.buttonStyle(.glassProminent).tint(Palette.prominent)
                            Button("Plan this day") { useDay(best.date, plan: plan) }.buttonStyle(.glass)
                        }
                    }
                }
                .padding(.horizontal, 16)
                Spacer().frame(height: 28)
            }
            if !result.highlights.isEmpty {
                SectionHead("Tradeoffs")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(result.highlights.enumerated()), id: \.offset) { _, highlight in
                            Card(spacing: 4) {
                                Text(highlight["label"].string ?? "").font(.subheadline.weight(.semibold))
                                Text(highlight["dates"].strings.map(DateText.short).joined(separator: ", ")).font(.footnote).foregroundStyle(Palette.secondary)
                            }
                            .frame(width: 180)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                Spacer().frame(height: 28)
            }
            SectionHead(title: "Your days at a glance") {
                Text(result.ranked ? "Ranked by the server" : "Not ranked")
            }
            if let note = result.note { Caption(note).padding(.horizontal, 20).padding(.bottom, 10) }
            VStack(spacing: 12) {
                ForEach(result.days) { day in
                    Button { open(day, plan: plan) } label: {
                        ItemCard(title: DateText.long(day.date), level: day.level,
                                 meta: dayMeta(day),
                                 tiles: day.report?.skyTiles ?? [],
                                 stripStart: day.report?.stripLabels?.0, stripEnd: day.report?.stripLabels?.1,
                                 caption: day.concern ?? day.headline,
                                 captionTone: day.level == .caution || day.level == .noGo ? Palette.caution : Palette.secondary,
                                 captionEmphasized: day.level == .caution || day.level == .noGo)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Plan this day", systemImage: "calendar") { useDay(day.date, plan: plan) }
                    }
                }
            }
            .padding(.horizontal, 16)
            if result.ranked {
                Spacer().frame(height: 24)
                ChatLauncher(title: "Ask about these days", context: "\(plan.objective.shortName) · \(result.days.count) days", messageCount: chat.count, readOnly: false) {
                    if account.signedIn { chatOpen = true } else { signIn = true }
                }
                ShareLink(item: summary(result, plan: plan)) { Label("Share comparison", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.glass).padding(.horizontal, 20).padding(.top, 14)
            }
        } else if loading {
            HStack(spacing: 10) { ProgressView(); Caption("Checking \(days) days…") }.padding(.horizontal, 20)
        }
    }

    private func dayMeta(_ day: Day) -> String {
        let json = day.json
        return [day.score.map { "Score \($0)" } ?? "No score",
                json["peakGustMph"].double.map { "gust \(Format.mph($0))" },
                json["peakPrecipChance"].double.map { "rain \(Int($0.rounded()))%" },
                json["tempHighF"].double.map { "high \(Format.temp($0))" }].compactMap { $0 }.joined(separator: " · ")
    }

    private func summary(_ result: Result, plan: Plan) -> String {
        var lines = ["\(plan.objective.shortName) — \(result.days.count) days from \(DateText.short(plan.date))"]
        for day in result.days {
            lines.append("\(DateText.short(day.date)): \(day.level.label)\(day.score.map { " · \($0)" } ?? "")\(day.concern.map { " — \($0)" } ?? "")")
        }
        if let best = result.bestDate { lines.append("Best: \(DateText.long(best))") }
        lines.append("Planning evidence, not a guarantee of safety.")
        return lines.joined(separator: "\n")
    }

    private func open(_ day: Day, plan: Plan) {
        guard let report = day.report else { return }
        var dayPlan = plan
        dayPlan.date = day.date
        openDay = DayOpen(plan: dayPlan, report: report)
    }

    /// Moves the plan to a day from the comparison and checks it (the web's "Use this day").
    private func useDay(_ date: String, plan: Plan) {
        guard var next = store.plan(plan.id) else { return }
        next.date = date
        store.update(next)
        store.briefPlanID = next.id
        Task { await store.refresh(next) }
        NotificationCenter.default.post(name: .openPlan, object: next.id)
    }

    private func compare() async {
        guard let plan else { return }
        loading = true
        error = nil
        chat = []
        defer { loading = false }
        do {
            let json = try await APIClient().tripForecasts(plan: plan, startDate: plan.date, days: days)
            account.noteUsage(.object(["multiDayUsage": json["multiDayUsage"]]))
            let parsed = json["days"].array.map { day in
                Day(date: day["date"].string ?? "",
                    level: DecisionLevel(day["decisionLevel"].string),
                    headline: day["decisionHeadline"].string,
                    concern: day["concerns"].strings.first,
                    score: day["score"].int,
                    report: day["safetyData"].isNull ? nil : Report(json: day["safetyData"]),
                    json: day)
            }
            result = Result(days: parsed.sorted { $0.date < $1.date }, bestDate: json.at("ranking.bestDate").string,
                            tied: json.at("ranking.tiedWithBest").strings, highlights: json["highlights"].array,
                            chatContext: json["chatContext"], note: json["note"].string, ranked: true)
        } catch let apiError as APIError where apiError.multiDayUnavailable || apiError.status == 503 {
            // Check each day on its own. Every decision is still the backend's; only the ranking is left out.
            var parsed: [Day] = []
            for offset in 0..<days {
                let date = DateText.addDays(plan.date, offset)
                var params = plan.planParams
                params["date"] = date
                if let report = try? await APIClient().safety(at: plan.objective, params: params) {
                    parsed.append(Day(date: date, level: report.level, headline: report.headline,
                                      concern: report.limitingChecks.first, score: report.score.map { Int($0.rounded()) }, report: report))
                } else {
                    parsed.append(Day(date: date, level: .unknown, headline: "This day could not be checked.", concern: nil, score: nil, report: nil))
                }
            }
            result = Result(days: parsed, bestDate: nil,
                            note: "This server can’t rank days right now, so each day below was checked on its own. Pick by the decisions, not the order.", ranked: false)
        } catch let apiError as APIError where apiError.needsAccount {
            signIn = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Objectives

/// A shortlist of 2–5 objectives over the same days (the web's Compare objectives). The backend ranks
/// each day; a day without complete evidence can't win.
struct CompareObjectives: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    @AppStorage("shortlist.v1") private var saved = Data()
    @State private var objectives: [Place] = []
    @State private var startDate = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var days = 2
    @State private var startTime = DateText.localTime(PreferencesStore.shared.preferences.defaultStartTime) ?? Date()
    @State private var hours = PreferencesStore.shared.preferences.travelWindowHours
    @State private var results: [String: (days: [JSON], error: String?)] = [:]
    @State private var loading = false
    @State private var adding = false
    @State private var planA: String?
    @State private var planB: String?
    @State private var newPlan: NewPlanDraft?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Card(spacing: 10) {
                CardHead(title: "Shortlist") { Text("\(objectives.count) of 5").font(.footnote) }
                ForEach(objectives) { place in
                    HStack {
                        Label(place.shortName, systemImage: "mountain.2").font(.subheadline)
                        Spacer()
                        Button("Remove", systemImage: "minus.circle") { objectives.removeAll { $0 == place }; persist() }
                            .labelStyle(.iconOnly).foregroundStyle(Palette.secondary)
                    }
                }
                if objectives.count < 5 {
                    Button("Add an objective", systemImage: "plus") { adding = true }.buttonStyle(.glass).controlSize(.small)
                }
                Divider()
                HStack(spacing: 8) {
                    FieldBox(label: "From") {
                        DatePicker("From", selection: $startDate, in: Calendar.current.startOfDay(for: Date())...(Calendar.current.date(byAdding: .day, value: 6, to: Date()) ?? Date()),
                                   displayedComponents: .date).labelsHidden()
                    }
                    FieldBox(label: "Start") { DatePicker("Start", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden() }
                }
                Stepper("\(days) days", value: $days, in: 2...7)
                Stepper("\(hours) hours each", value: $hours, in: 1...24)
                if let problem = validation { Caption(problem) }
                Button {
                    Task { await run() }
                } label: {
                    Label(loading ? "Comparing…" : "Compare objectives", systemImage: "square.split.2x1").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent).tint(Palette.prominent)
                .disabled(loading || validation != nil)
            }
            .padding(.horizontal, 16)
            if let winner {
                Spacer().frame(height: 24)
                SectionHead("Best option")
                Card(spacing: 6) {
                    HStack {
                        Text(winner.place.shortName).font(.display(24))
                        Spacer()
                        VerdictPill(level: DecisionLevel(winner.day["decisionLevel"].string))
                    }
                    Caption("\(DateText.long(winner.day["date"].string ?? "")) · \(winner.day["decisionHeadline"].string ?? "")")
                    Button("Plan this") { plan(winner.place, date: winner.day["date"].string) }.buttonStyle(.glassProminent).tint(Palette.prominent)
                }
                .padding(.horizontal, 16)
            }
            if !results.isEmpty {
                Spacer().frame(height: 24)
                SectionHead("Every objective, every day")
                VStack(spacing: 12) {
                    ForEach(objectives) { place in
                        let entry = results[place.id]
                        Card(spacing: 6) {
                            HStack {
                                Text(place.shortName).font(.headline)
                                Spacer()
                                if planA == place.id { Text("Plan A").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent) }
                                if planB == place.id { Text("Plan B").font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary) }
                            }
                            if let error = entry?.error { Caption(error, tone: Palette.caution) }
                            ForEach(Array((entry?.days ?? []).enumerated()), id: \.offset) { _, day in
                                HStack {
                                    Text(DateText.short(day["date"].string ?? "")).font(.subheadline)
                                    Spacer()
                                    if day["rankable"].bool == false { Text("Incomplete").font(.caption).foregroundStyle(Palette.missing) }
                                    if let score = day["score"].int { Text("\(score)").font(.caption).foregroundStyle(Palette.secondary) }
                                    LevelTag(level: DecisionLevel(day["decisionLevel"].string))
                                }
                                if let concern = day["concerns"].strings.first { Caption(concern) }
                            }
                            HStack {
                                Button("Plan A") { planA = place.id; if planB == place.id { planB = nil }; persist() }.buttonStyle(.glass)
                                Button("Plan B") { planB = place.id; if planA == place.id { planA = nil }; persist() }.buttonStyle(.glass)
                                Spacer()
                                Button("Plan this") { plan(place, date: nil) }.buttonStyle(.glass)
                            }
                            .controlSize(.small)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .sheet(isPresented: $adding) {
            PlacePicker(title: "Add an objective") { place in
                if !objectives.contains(where: { abs($0.lat - place.lat) < 0.0001 && abs($0.lon - place.lon) < 0.0001 }) { objectives.append(place); persist() }
            }
        }
        .sheet(item: $newPlan) { draft in
            NewPlanSheet(draft: draft) { plan in
                store.add(plan)
                Task { await store.refresh(plan) }
                NotificationCenter.default.post(name: .openPlan, object: plan.id)
            }
        }
        .onAppear(perform: restore)
    }

    private var dates: [String] { (0..<days).map { DateText.addDays(DateText.iso(startDate), $0) } }

    private var validation: String? {
        if objectives.count < 2 || objectives.count > 5 { return "Add 2–5 objectives to compare." }
        if DateText.addDays(DateText.iso(startDate), days - 1) > DateText.addDays(DateText.today(), 6) { return "Choose dates within the next 7 days." }
        return nil
    }

    /// The best-ranked day with complete evidence, across every objective.
    private var winner: (place: Place, day: JSON)? {
        objectives.flatMap { place in (results[place.id]?.days ?? []).filter { $0["rankable"].bool == true }.map { (place, $0) } }
            .max { ($0.1["rankValue"].double ?? -.infinity) < ($1.1["rankValue"].double ?? -.infinity) }
    }

    private func run() async {
        guard validation == nil else { return }
        loading = true
        results = [:]
        defer { loading = false }
        let prefs = PreferencesStore.shared.preferences
        let params = [
            "max_gust_mph": String(prefs.limits.maxGustMph), "max_precip_chance": String(prefs.limits.maxPrecipChance),
            "min_feels_like_f": String(prefs.limits.minFeelsLikeF), "max_feels_like_f": String(prefs.limits.maxFeelsLikeF),
        ].merging(prefs.unitParams) { _, new in new }
        for (index, place) in objectives.enumerated() {
            do {
                let json = try await APIClient().tripForecasts(place: place, params: params, activity: prefs.defaultActivity.rawValue,
                                                               startDate: dates[0], start: DateText.hhmm(startTime), travelHours: hours, days: days,
                                                               includeAvalanche: true)
                account.noteUsage(.object(["multiDayUsage": json["multiDayUsage"]]))
                let matching = json["days"].array.filter { day in
                    dates.contains(day["date"].string ?? "")
                        && abs((day.at("safetyData.location.lat").double ?? 999) - place.lat) < 0.0001
                        && abs((day.at("safetyData.location.lon").double ?? 999) - place.lon) < 0.0001
                }
                results[place.id] = (matching, matching.isEmpty ? "No matching forecasts returned. Try again." : nil)
            } catch let error as APIError where error.limitReached {
                results[place.id] = ([], error.message)
                for rest in objectives.dropFirst(index + 1) { results[rest.id] = ([], "Not requested because the comparison allowance was reached.") }
                break
            } catch {
                results[place.id] = ([], error.localizedDescription)
            }
        }
    }

    private func plan(_ place: Place, date: String?) {
        var draft = NewPlanDraft(objective: place)
        draft.date = date ?? dates.first
        draft.start = DateText.hhmm(startTime)
        draft.hours = hours
        newPlan = draft
    }

    private struct Stored: Codable {
        var objectives: [Place]
        var planA: String?
        var planB: String?
    }

    private func persist() {
        saved = (try? JSONEncoder().encode(Stored(objectives: objectives, planA: planA, planB: planB))) ?? Data()
    }

    private func restore() {
        guard objectives.isEmpty, let stored = try? JSONDecoder().decode(Stored.self, from: saved) else { return }
        objectives = stored.objectives
        planA = stored.planA
        planB = stored.planB
    }
}

// MARK: - Routes

/// Named routes up one objective, each analyzed for the same plan and shown side by side. Facts only:
/// checkpoints over limits, time at pace and turnaround. The routes are not ranked.
struct CompareRoutes: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var planID: UUID?
    @State private var draft = ""
    @State private var entries: [Entry] = []
    @State private var suggestions: [String] = []

    struct Entry: Identifiable {
        var id = UUID()
        var name: String
        var result: JSON?
        var error: String?
        var progress = 0
    }

    private var dayPlans: [Plan] { store.upcoming.filter { !$0.isTrip && !$0.isSample } }
    private var plan: Plan? { dayPlans.first { $0.id == planID } ?? dayPlans.first }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let plan {
                Card(spacing: 10) {
                    CardHead(title: plan.objective.shortName) {
                        Menu {
                            ForEach(dayPlans) { item in Button(item.objective.shortName) { planID = item.id; entries = []; suggestions = [] } }
                        } label: { Label("Plan", systemImage: "chevron.up.chevron.down").font(.footnote.weight(.semibold)) }
                    }
                    Caption("\(DateText.short(plan.date)), starting \(DateText.clock(plan.start)), \(plan.travelHours) hours.")
                    HStack {
                        TextField("Enter a named route", text: $draft).textInputAutocapitalization(.words)
                        Button("Compare") { add(draft, plan: plan) }.buttonStyle(.glassProminent).tint(Palette.prominent)
                            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || entries.count >= 3)
                    }
                    if suggestions.isEmpty {
                        Button("Suggest routes") { Task { await suggest(plan) } }.buttonStyle(.glass).controlSize(.small).disabled(!account.signedIn)
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack { ForEach(suggestions.filter { name in !entries.contains { $0.name == name } }, id: \.self) { name in Button("+ \(name)") { add(name, plan: plan) }.buttonStyle(.glass).controlSize(.small) } }
                        }
                    }
                    Caption(entries.count >= 3 ? "Up to 3 routes at a time; remove one to add another." : account.signedIn ? "Each route is a live analysis and can take a minute." : "Route checks use AI and need an account.")
                }
                .padding(.horizontal, 16)
                Spacer().frame(height: 20)
                VStack(spacing: 12) {
                    ForEach(entries) { entry in routeCard(entry, plan: plan) }
                }
                .padding(.horizontal, 16)
            } else {
                Notice(tone: .info, text: "Make a day plan first, then compare routes up its objective here.")
            }
        }
    }

    private func routeCard(_ entry: Entry, plan: Plan) -> some View {
        Card(spacing: 6) {
            HStack {
                Text(entry.name).font(.headline)
                Spacer()
                Button("Remove", systemImage: "xmark.circle.fill") { entries.removeAll { $0.id == entry.id } }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary)
            }
            if let error = entry.error {
                Caption(error, tone: Palette.caution)
            } else if let result = entry.result {
                let summaries = result["summaries"].array
                let limits = plan.limits
                let over = summaries.filter { summary in
                    let weather = summary["weather"]
                    return (weather["windGust"].double ?? 0) > Double(limits.maxGustMph) || (weather["precipChance"].double ?? 0) > Double(limits.maxPrecipChance)
                        || (weather["feelsLike"].double ?? 99) < Double(limits.minFeelsLikeF)
                }
                Caption(sourceLabel(result["routeSource"].string))
                FactRow(label: "Checkpoints", value: "\(summaries.count)")
                FactRow(label: "Past a limit", value: over.isEmpty ? "None" : over.compactMap { $0["name"].string }.joined(separator: ", "), over: !over.isEmpty)
                if let minutes = result.at("timing.estimatedMinutes").double { FactRow(label: "At your pace", value: "\(Int((minutes / 60).rounded())) h") }
                if let turn = result.at("timing.turnaround.byPlanEnd").string { FactRow(label: "Turn around by", value: DateText.clock(turn)) }
                if let peak = summaries.compactMap({ $0.at("weather.windGust").double }).max() { FactRow(label: "Peak gust", value: Format.mph(peak)) }
                if result["partialData"].bool == true { Caption("Some checkpoints had no forecast.", tone: Palette.missing) }
                Button("Use this route in the plan") { use(entry, plan: plan) }.buttonStyle(.glass).controlSize(.small)
            } else {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Caption(entry.progress > 0 ? "\(entry.progress) checkpoints loaded…" : "Checking the route…") }
            }
        }
    }

    private func sourceLabel(_ source: String?) -> String {
        switch source {
        case "gpx": "Your GPX track"
        case "nps": "National Park Service trail"
        case "openstreetmap": "OpenStreetMap trail"
        default: "Generated from named landmarks"
        }
    }

    private func suggest(_ plan: Plan) async {
        suggestions = ((try? await APIClient().routeSuggestions(peak: plan.objective.shortName, lat: plan.objective.lat, lon: plan.objective.lon).array) ?? [])
            .compactMap { $0["name"].string }
    }

    private func add(_ raw: String, plan: Plan) {
        let name = raw.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, entries.count < 3, !entries.contains(where: { $0.name.lowercased() == name.lowercased() }) else { return }
        draft = ""
        let entry = Entry(name: name)
        entries.append(entry)
        let timing = PreferencesStore.shared.preferences.routeTiming(for: plan.activityKey)
        let units = Units.current
        let body: JSON = .object([
            "peak": .string(plan.objective.shortName), "route": .string(name),
            "lat": .number(plan.objective.lat), "lon": .number(plan.objective.lon),
            "date": .string(plan.date), "start": .string(plan.start), "travel_window_hours": .number(Double(plan.travelHours)),
            "units": .object(["temperature": .string(units.temperature.rawValue), "wind": .string(units.wind.rawValue), "elevation": .string(units.elevation.rawValue)]),
            "pace": .object(["minutesPerMile": .number(Double(timing.paceMinutesPerMile)), "ascentMinutesPer1000Ft": .number(Double(timing.ascentMinutesPer1000Ft)),
                             "stopBufferMinutes": .number(Double(timing.stopMinutes))]),
        ])
        Task {
            do {
                let result = try await APIClient().routeAnalysis(body: body) { event in
                    Task { @MainActor in
                        if event["type"].string == "checkpoint", let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index].progress += 1 }
                    }
                }
                if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index].result = result }
            } catch {
                if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index].error = error.localizedDescription }
            }
        }
    }

    private func use(_ entry: Entry, plan: Plan) {
        guard var next = store.plan(plan.id), let result = entry.result else { return }
        next.route = PlanRoute(name: entry.name, analysis: result, analyzedFor: next.timingKey)
        store.update(next)
        Task { await store.reevaluate(next) }
    }
}
