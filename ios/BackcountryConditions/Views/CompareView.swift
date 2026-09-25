import SwiftUI

/// Compare days: consecutive days at one objective. The backend ranks them (`/api/trip-forecasts`);
/// when the server can't, each day is shown with its own evaluated decision and no ranking.
struct CompareView: View {
    @Environment(PlanStore.self) private var store
    @State private var planID: UUID?
    @State private var days = 5
    @State private var result: Result?
    @State private var loading = false
    @State private var error: String?
    @State private var openDay: DayOpen?

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
    }

    struct Result {
        var days: [Day]
        var bestDate: String?
        var note: String?
        var ranked: Bool
    }

    private var dayPlans: [Plan] { store.upcoming.filter { !$0.isTrip } }
    private var plan: Plan? { dayPlans.first { $0.id == planID } ?? dayPlans.first }

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: plan.map { "\($0.objective.shortName) · \(DateText.clock($0.start)) start · \($0.travelHours) hours" },
                           title: "Compare", subtitle: "The same plan across the next few days.")
                Spacer().frame(height: 16)
                if dayPlans.isEmpty {
                    Notice(tone: .info, text: "Make a day plan first, then compare it across days here.")
                } else {
                    controls
                    Spacer().frame(height: 24)
                    resultView
                }
            }
            .toolbar {
                if !dayPlans.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            ForEach(dayPlans) { item in
                                Button(item.objective.shortName) { planID = item.id; result = nil }
                            }
                        } label: { Label("Plan", systemImage: "list.bullet") }
                    }
                }
            }
            .navigationDestination(item: $openDay) { day in
                BriefView(plan: day.plan, snapshot: day.report, note: "Checked in Compare. Open the plan itself for current conditions.")
            }
        }
    }

    private var controls: some View {
        Card(spacing: 10) {
            CardHead("Days to compare")
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
                    if let report = best.report {
                        DayStrip(tiles: report.skyTiles, start: report.stripLabels?.0, end: report.stripLabels?.1).padding(.vertical, 4)
                        Button("Open this day", systemImage: "chevron.right") { open(best, plan: plan) }.buttonStyle(.glassProminent).tint(Palette.prominent)
                    }
                }
                .padding(.horizontal, 16)
                Spacer().frame(height: 28)
            }
            SectionHead(title: "This week") {
                Text(result.ranked ? "Ranked by the server" : "Not ranked")
            }
            if let note = result.note { Caption(note).padding(.horizontal, 20).padding(.bottom, 10) }
            VStack(spacing: 12) {
                ForEach(result.days) { day in
                    Button { open(day, plan: plan) } label: {
                        ItemCard(title: DateText.long(day.date), level: day.level,
                                 meta: day.score.map { "Score \($0)" } ?? "No score",
                                 tiles: day.report?.skyTiles ?? [],
                                 stripStart: day.report?.stripLabels?.0, stripEnd: day.report?.stripLabels?.1,
                                 caption: day.concern ?? day.headline,
                                 captionTone: day.level == .caution || day.level == .noGo ? Palette.caution : Palette.secondary,
                                 captionEmphasized: day.level == .caution || day.level == .noGo)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        } else if loading {
            HStack(spacing: 10) { ProgressView(); Caption("Checking \(days) days…") }.padding(.horizontal, 20)
        }
    }

    private func open(_ day: Day, plan: Plan) {
        guard let report = day.report else { return }
        var dayPlan = plan
        dayPlan.date = day.date
        openDay = DayOpen(plan: dayPlan, report: report)
    }

    private func compare() async {
        guard let plan else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let json = try await APIClient().tripForecasts(plan: plan, startDate: plan.date, days: days)
            let parsed = json["days"].array.map { day in
                Day(date: day["date"].string ?? "",
                    level: DecisionLevel(day["decisionLevel"].string),
                    headline: day["decisionHeadline"].string,
                    concern: day["concerns"].strings.first,
                    score: day["score"].int,
                    report: day["safetyData"].isNull ? nil : Report(json: day["safetyData"]))
            }
            result = Result(days: parsed.sorted { $0.date < $1.date }, bestDate: json.at("ranking.bestDate").string, note: json["note"].string, ranked: true)
        } catch let apiError as APIError where apiError.multiDayUnavailable || apiError.status == 503 {
            // Check each day on its own. Every decision is still the backend's; only the ranking is left out.
            let tasks = (0..<days).map { offset in
                Task { () -> Day in
                    let date = DateText.addDays(plan.date, offset)
                    var params = plan.planParams
                    params["date"] = date
                    if let report = try? await APIClient().safety(at: plan.objective, params: params) {
                        return Day(date: date, level: report.level, headline: report.headline,
                                   concern: report.limitingChecks.first, score: report.score.map { Int($0.rounded()) }, report: report)
                    }
                    return Day(date: date, level: .unknown, headline: "This day could not be checked.", concern: nil, score: nil, report: nil)
                }
            }
            var parsed: [Day] = []
            for task in tasks { parsed.append(await task.value) }
            result = Result(days: parsed.sorted { $0.date < $1.date }, bestDate: nil,
                            note: "This server can’t rank days right now, so each day below was checked on its own. Pick by the decisions, not the order.", ranked: false)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
