import Foundation
import Observation
import WidgetKit

/// A multi-day trip's check: the backend's itinerary assessment when the server offers it,
/// otherwise one evaluated report per day with its camp night (no trip verdict is invented).
struct TripResult: Sendable {
    var itinerary: JSON?
    var stageReports: [Report?]
    var checkedAt: Date
    var fallbackReason: String?

    var level: DecisionLevel {
        guard let itinerary else { return .unknown }
        return DecisionLevel(itinerary.at("assessment.level").string)
    }

    /// The verdict's headline, `{ title, reason }`: the weak link, named, and why.
    var headline: String? { itinerary?.at("assessment.headline.title").string }
    var headlineReason: String? { itinerary?.at("assessment.headline.reason").string }

    func stageEntry(_ index: Int) -> JSON {
        itinerary?["stages"].array.first { $0["index"].int == index } ?? itinerary?["stages"][index] ?? .null
    }

    func stageReport(_ index: Int) -> Report? {
        if itinerary != nil {
            let report = stageEntry(index)["report"]
            return report.isNull ? nil : Report(json: report)
        }
        return stageReports.indices.contains(index) ? stageReports[index] : nil
    }

    func checkpointReport(_ index: Int, _ checkpoint: Int) -> Report? {
        let report = stageEntry(index)["checkpoints"][checkpoint]["report"]
        return report.isNull ? nil : Report(json: report)
    }

    var chatContext: JSON { itinerary?["chatContext"] ?? .null }

    func encoded() -> JSON {
        .object([
            "itinerary": itinerary ?? .null,
            "stages": .array(stageReports.map { $0?.json ?? .null }),
            "checkedAt": .number(checkedAt.timeIntervalSince1970),
            "fallbackReason": fallbackReason.map(JSON.string) ?? .null,
        ])
    }

    init(itinerary: JSON?, stageReports: [Report?], checkedAt: Date, fallbackReason: String?) {
        self.itinerary = itinerary
        self.stageReports = stageReports
        self.checkedAt = checkedAt
        self.fallbackReason = fallbackReason
    }

    init(decoding json: JSON) {
        itinerary = json["itinerary"].isNull ? nil : json["itinerary"]
        stageReports = json["stages"].array.map { $0.isNull ? nil : Report(json: $0) }
        checkedAt = Date(timeIntervalSince1970: json["checkedAt"].double ?? 0)
        fallbackReason = json["fallbackReason"].string
    }
}

/// The AI explanation of one report generation.
struct AIBrief: Codable, Hashable, Sendable {
    var generatedAt: String
    var text: String
}

/// Plans, their latest reports, saved snapshots and the watchlist, kept on the device. Signed in,
/// reports, watches and trips are also saved to the account, in the web app's formats.
@Observable
final class PlanStore {
    private(set) var plans: [Plan] = []
    private(set) var saved: [SavedReport] = []
    private(set) var reports: [UUID: Report] = [:]
    private(set) var trips: [UUID: TripResult] = [:]
    private(set) var loading: Set<UUID> = []
    private(set) var errors: [UUID: String] = [:]
    /// AI explanations by plan, for the report generation they explain.
    private(set) var aiBriefs: [UUID: AIBrief] = [:]
    /// Report chat by plan.
    private(set) var chats: [UUID: [ChatMessage]] = [:]
    /// The plan the Brief tab shows.
    var briefPlanID: UUID?
    /// A message for the whole app, such as the report allowance being used up.
    var blocker: String?

    private let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Conditions")
        try? FileManager.default.createDirectory(at: base.appending(path: "reports"), withIntermediateDirectories: true)
        return base
    }()

    init() { load() }

    // MARK: Queries

    var upcoming: [Plan] {
        plans.filter { $0.endDate >= DateText.today() }.sorted { ($0.date, $0.start) < ($1.date, $1.start) }
    }

    var past: [Plan] {
        plans.filter { $0.endDate < DateText.today() }.sorted { $0.date > $1.date }
    }

    var watched: [Plan] { plans.filter(\.watched) }

    func plan(_ id: UUID?) -> Plan? { plans.first { $0.id == id } }

    func report(_ plan: Plan) -> Report? { reports[plan.id] }

    func trip(_ plan: Plan) -> TripResult? { trips[plan.id] }

    /// The backend's decision for a plan, or `.unknown` before it has been checked.
    func level(_ plan: Plan) -> DecisionLevel {
        if plan.isTrip { return trips[plan.id]?.level ?? .unknown }
        return reports[plan.id]?.level ?? .unknown
    }

    func summary(_ plan: Plan) -> String? {
        if plan.isTrip {
            guard let trip = trips[plan.id] else { return nil }
            return trip.headline ?? trip.fallbackReason
        }
        guard let report = reports[plan.id] else { return nil }
        return report.limitingChecks.first ?? report.reason ?? report.headline
    }

    /// The AI explanation of a plan's current report, when one was written for it.
    func aiBrief(_ plan: Plan) -> String? {
        guard let brief = aiBriefs[plan.id], brief.generatedAt == (reports[plan.id]?.generatedAtText ?? "") else { return nil }
        return brief.text
    }

    func chat(_ plan: Plan) -> [ChatMessage] { chats[plan.id] ?? [] }

    /// Whether the plan's current report is the one saved to the account.
    func savedToAccount(_ plan: Plan) -> Bool {
        guard let current = self.plan(plan.id), current.accountReportID != nil else { return false }
        return current.accountReportGeneratedAt == reports[plan.id]?.generatedAtText
    }

    // MARK: Changes

    func add(_ plan: Plan) {
        plans.append(plan)
        briefPlanID = plan.id
        persistPlans()
    }

    func update(_ plan: Plan) {
        guard let index = plans.firstIndex(where: { $0.id == plan.id }) else { return add(plan) }
        plans[index] = plan
        persistPlans()
    }

    func delete(_ id: UUID) {
        plans.removeAll { $0.id == id }
        reports[id] = nil
        trips[id] = nil
        aiBriefs[id] = nil
        chats[id] = nil
        try? FileManager.default.removeItem(at: reportURL(id))
        if briefPlanID == id { briefPlanID = upcoming.first?.id }
        persistPlans()
        persistAI()
    }

    func toggleWatch(_ id: UUID) {
        guard var plan = plan(id) else { return }
        plan.watched.toggle()
        if plan.watched, plan.watch == nil {
            let level = level(plan)
            if level != .unknown { plan.watch = WatchState(level: level, checkedAt: Date()) }
        }
        if plan.watched { Task { await Notifier.requestPermission() } }
        update(plan)
    }

    /// Checks every watched plan again, as the background refresh does.
    func refreshWatched() async {
        await refreshAll(watched.filter { $0.endDate >= DateText.today() && !$0.isSample }, userInitiated: false)
    }

    func markReviewed(_ id: UUID) {
        guard var plan = plan(id), plan.watch != nil else { return }
        plan.watch?.reviewed = true
        update(plan)
    }

    func saveSnapshot(_ plan: Plan) {
        guard let report = reports[plan.id] else { return }
        var item = SavedReport(plan: plan, reportData: report.data)
        item.aiNarrative = aiBrief(plan)
        item.chat = chat(plan)
        saved.insert(item, at: 0)
        persistSaved()
    }

    func deleteSaved(_ id: UUID) {
        saved.removeAll { $0.id == id }
        persistSaved()
    }

    // MARK: Checking

    /// Checks a plan. A check the traveler asked for counts as a newly generated report, against
    /// the account's allowance or the guest allowance, as on the web.
    func refresh(_ plan: Plan, userInitiated: Bool = true) async {
        guard !loading.contains(plan.id) else { return }
        let account = AccountStore.shared
        if userInitiated, !plan.isSample, !plan.isTrip, let blocker = account.newReportBlocker {
            errors[plan.id] = blocker
            self.blocker = blocker
            return
        }
        loading.insert(plan.id)
        errors[plan.id] = nil
        defer { loading.remove(plan.id) }
        do {
            if plan.isTrip {
                let result = try await checkTrip(plan)
                trips[plan.id] = result
                write(result.encoded().data(), to: reportURL(plan.id))
                recordWatch(plan, level: result.level, reason: result.headline, incomplete: result.itinerary == nil)
                if let usage = result.itinerary?["multiDayUsage"], !usage.isNull { account.noteUsage(.object(["multiDayUsage": usage])) }
            } else {
                let report = try await fetchReport(plan)
                reports[plan.id] = report
                write(report.data, to: reportURL(plan.id))
                if userInitiated && !plan.isSample { account.countNewReport() }
                recordWatch(plan, level: report.level, reason: report.limitingChecks.first ?? report.reason, incomplete: report.partialData)
            }
        } catch {
            errors[plan.id] = error.localizedDescription
            if let apiError = error as? APIError, apiError.limitReached { blocker = apiError.message }
        }
        publishWidgets()
    }

    func refreshAll(_ selection: [Plan]? = nil, userInitiated: Bool = true) async {
        await withTaskGroup(of: Void.self) { group in
            for plan in selection ?? upcoming { group.addTask { await self.refresh(plan, userInitiated: userInitiated) } }
        }
    }

    /// Re-evaluates the plan's report for a different elevation to check (`target_elevation_ft`).
    func evaluate(_ plan: Plan, targetElevationFt: Int) async throws -> Report {
        guard let report = reports[plan.id] else { throw APIError(message: "Load the report first.") }
        var params = plan.planParams
        params["target_elevation_ft"] = String(targetElevationFt)
        let evaluation = try await APIClient().evaluate(report: report.json, params: params)
        var object = report.json.object
        object["evaluation"] = evaluation
        return Report(json: .object(object))
    }

    /// Re-evaluates a plan's loaded report for its current params (units, limits or approach changed),
    /// without asking the upstream sources again.
    func reevaluate(_ plan: Plan) async {
        guard let report = reports[plan.id], !plan.isTrip else { return }
        do {
            let evaluation = try await APIClient().evaluate(report: report.json, params: plan.planParams)
            var object = report.json.object
            object["evaluation"] = evaluation
            let next = Report(json: .object(object))
            reports[plan.id] = next
            write(next.data, to: reportURL(plan.id))
            publishWidgets()
        } catch {
            errors[plan.id] = error.localizedDescription
        }
    }

    /// Re-evaluates every loaded report after the display units change.
    func reevaluateAll() async {
        await withTaskGroup(of: Void.self) { group in
            for plan in plans where !plan.isTrip && reports[plan.id] != nil && !plan.isSample {
                group.addTask { await self.reevaluate(plan) }
            }
        }
    }

    private func fetchReport(_ plan: Plan) async throws -> Report {
        if plan.isSample { return try Self.sampleReport() }
        return try await APIClient().safety(at: plan.objective, params: plan.planParams)
    }

    private func checkTrip(_ plan: Plan) async throws -> TripResult {
        guard let stages = plan.stages else { throw APIError(message: "This trip has no days.") }
        do {
            let itinerary = try await APIClient().itineraryCheck(plan: plan)
            return TripResult(itinerary: itinerary, stageReports: [], checkedAt: Date(), fallbackReason: nil)
        } catch let error as APIError where error.multiDayUnavailable || error.status == 503 {
            // The server can't check a trip as a whole. Check each day at its camp instead;
            // the backend evaluates every day and night, but no trip verdict is made up here.
            var reports: [Report?] = []
            for (index, stage) in stages.enumerated() {
                var params = plan.planParams
                params["date"] = DateText.addDays(plan.date, index)
                params["start"] = stage.start
                params["travel_window_hours"] = String(stage.travelHours)
                let extra = index < stages.count - 1 ? ["camp_night": "1"] : [:]
                reports.append(try? await APIClient().safety(at: stage.to, params: params, extra: extra))
            }
            return TripResult(itinerary: nil, stageReports: reports, checkedAt: Date(),
                              fallbackReason: "This server can’t check a whole trip right now, so each day and camp night was checked on its own. There’s no trip verdict until it can.")
        }
    }

    /// The same trip starting on other dates, each checked as a whole (the web's "Other start dates").
    func checkTrip(_ plan: Plan, startingOn date: String) async throws -> TripResult {
        let itinerary = try await APIClient().itineraryCheck(plan: plan, startDate: date)
        let usage = itinerary["multiDayUsage"]
        if !usage.isNull { AccountStore.shared.noteUsage(.object(["multiDayUsage": usage])) }
        return TripResult(itinerary: itinerary, stageReports: [], checkedAt: Date(), fallbackReason: nil)
    }

    private func recordWatch(_ plan: Plan, level: DecisionLevel, reason: String?, incomplete: Bool) {
        guard var current = self.plan(plan.id), current.watched else { return }
        var watch = current.watch ?? WatchState(level: level, checkedAt: Date())
        if watch.level != level {
            if current.watch != nil { Notifier.decisionChanged(current, from: watch.level, to: level, reason: reason) }
            watch.previousLevel = watch.level
            watch.changedAt = Date()
            watch.reviewed = false
        }
        watch.level = level
        watch.reason = reason
        watch.checkedAt = Date()
        watch.incomplete = incomplete
        current.watch = watch
        update(current)
    }

    // MARK: AI

    func setAIBrief(_ text: String, for plan: Plan) {
        guard let generated = reports[plan.id]?.generatedAtText else { return }
        aiBriefs[plan.id] = AIBrief(generatedAt: generated, text: text)
        persistAI()
    }

    func setChat(_ messages: [ChatMessage], for plan: Plan) {
        chats[plan.id] = messages
        persistAI()
    }

    // MARK: Account

    /// Saves the plan's current report to the account (or updates the saved copy) and returns
    /// its share token. Uses the web's saved report format, so it opens in both apps.
    @discardableResult
    func saveToAccount(_ plan: Plan) async throws -> String {
        guard AccountStore.shared.signedIn else { throw APIError(message: "Sign in to save reports to your account.", status: 401) }
        guard let report = reports[plan.id], var current = self.plan(plan.id) else { throw APIError(message: "Check the plan first.") }
        let snapshot = current.persistedReport(report, aiNarrative: aiBrief(plan), chat: chat(plan))
        if let id = current.accountReportID, let token = current.shareToken, current.accountReportGeneratedAt == report.generatedAtText {
            try await APIClient().updateReport(id: id, snapshot: snapshot)
            return token
        }
        let saved = try await APIClient().saveReport(snapshot)
        AccountStore.shared.noteUsage(saved.response)
        current.accountReportID = saved.id
        current.shareToken = saved.shareToken
        current.accountReportGeneratedAt = report.generatedAtText
        update(current)
        return saved.shareToken
    }

    /// The web link to the plan's saved report, saving it first when needed.
    func shareURL(_ plan: Plan) async throws -> URL {
        let token = try await saveToAccount(plan)
        return Self.shareURL(token: token)
    }

    static func shareURL(token: String) -> URL {
        URL(string: "\(AppSettings.webOrigin)/report/\(token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token)")!
    }

    /// Emails the report to the account's address, saving it first when needed.
    func emailReport(_ plan: Plan) async throws -> String {
        let token = try await saveToAccount(plan)
        guard let report = reports[plan.id], let current = self.plan(plan.id) else { throw APIError(message: "Check the plan first.") }
        return try await APIClient().emailReport(current.persistedReport(report, aiNarrative: aiBrief(plan), chat: chat(plan)), shareToken: token)
    }

    /// Adds the plan to the account's watchlist, where the server checks it for changes.
    func watchOnAccount(_ plan: Plan) async throws -> String {
        guard AccountStore.shared.signedIn else { throw APIError(message: "Sign in to use your account’s watchlist.", status: 401) }
        guard let report = reports[plan.id], var current = self.plan(plan.id) else { throw APIError(message: "Check the plan first.") }
        let json = try await APIClient().createWatch(current.persistedReport(report))
        current.accountWatchID = json.at("watch.id").string
        update(current)
        return json.at("policy.automaticChecks").bool == true
            ? "Added to your account watchlist. Automatic checks will flag meaningful changes from this report."
            : "Added to your account watchlist. Run checks from the watchlist to compare with this report."
    }

    /// Watches each upcoming day of a checked trip as its own account watch, stopping at the
    /// account's watch limit (the web's `watchTripDays`).
    func watchTripDaysOnAccount(_ plan: Plan) async throws -> String {
        guard AccountStore.shared.signedIn else { throw APIError(message: "Sign in to use your account’s watchlist.", status: 401) }
        guard let trip = trips[plan.id], let stages = plan.stages else { throw APIError(message: "Check the trip first.") }
        var watched: [Int] = []
        var automatic = false
        for index in stages.indices {
            guard let report = trip.stageReport(index), var day = plan.dayPlan(index), day.date >= DateText.today() else { continue }
            day.objective.name = "\(plan.title) · Day \(index + 1) · \(stages[index].to.shortName)"
            do {
                let json = try await APIClient().createWatch(day.persistedReport(report))
                automatic = json.at("policy.automaticChecks").bool == true
                watched.append(index + 1)
            } catch {
                let days = watched.map(String.init).joined(separator: ", ")
                if watched.isEmpty { throw error }
                return "Watching day\(watched.count > 1 ? "s" : "") \(days). \(error.localizedDescription)"
            }
        }
        guard !watched.isEmpty else { throw APIError(message: "No upcoming day of this trip could be watched.") }
        let days = watched.map(String.init).joined(separator: ", ")
        return "Watching day\(watched.count > 1 ? "s" : "") \(days) in your account watchlist." +
            (automatic ? " Automatic checks will flag meaningful changes." : " Run checks from the watchlist to compare with this trip.")
    }

    /// Saves a checked trip to the account in the web's saved-trip format.
    func saveTripToAccount(_ plan: Plan) async throws {
        guard AccountStore.shared.signedIn else { throw APIError(message: "Sign in to save trips to your account.", status: 401) }
        guard let trip = trips[plan.id], trip.itinerary != nil else { throw APIError(message: "Check the whole trip before saving it.") }
        _ = try await APIClient().saveTrip(TripSnapshot.build(plan: plan, trip: trip))
    }

    /// Opens a trip saved to the account as a plan on this device.
    @discardableResult
    func importTrip(_ snapshot: JSON) -> Plan? {
        guard let read = TripSnapshot.read(snapshot) else { return nil }
        let (plan, result) = read
        add(plan)
        trips[plan.id] = result
        write(result.encoded().data(), to: reportURL(plan.id))
        publishWidgets()
        return plan
    }

    /// Adds a plan from a saved report and keeps the report as its latest check.
    @discardableResult
    func importPlan(_ plan: Plan, report: Report) -> Plan {
        var plan = plan
        plan.id = UUID()
        add(plan)
        reports[plan.id] = report
        write(report.data, to: reportURL(plan.id))
        publishWidgets()
        return plan
    }

    // MARK: Samples

    static func sampleReport() throws -> Report {
        guard let url = Bundle.main.url(forResource: "demo-report", withExtension: "json") else {
            throw APIError(message: "The sample report is missing from the app.")
        }
        return try Report(data: Data(contentsOf: url))
    }

    /// A sample plan backed by the bundled Mount Shasta report, for trying the app without a server.
    func addSamplePlan() {
        guard let report = try? Self.sampleReport() else { return }
        let date = report.selectedDate ?? DateText.today()
        var plan = Plan(
            objective: Place(name: "Mount Shasta, California", lat: 41.4092, lon: -122.1949, elevationFt: 14179, kind: "Peak"),
            activity: .mountaineering, date: date, start: "03:00", travelHours: 9,
            limits: Activity.mountaineering.defaultLimits)
        plan.isSample = true
        add(plan)
        reports[plan.id] = report
        write(report.data, to: reportURL(plan.id))
        publishWidgets()
    }

    // MARK: Persistence

    private var plansURL: URL { directory.appending(path: "plans.json") }
    private var savedURL: URL { directory.appending(path: "saved.json") }
    private var aiURL: URL { directory.appending(path: "ai.json") }
    private func reportURL(_ id: UUID) -> URL { directory.appending(path: "reports/\(id.uuidString).json") }

    private struct AIState: Codable {
        var briefs: [UUID: AIBrief]
        var chats: [UUID: [ChatMessage]]
    }

    private func load() {
        if let data = try? Data(contentsOf: plansURL), let decoded = try? JSONDecoder().decode([Plan].self, from: data) { plans = decoded }
        if let data = try? Data(contentsOf: savedURL), let decoded = try? JSONDecoder().decode([SavedReport].self, from: data) { saved = decoded }
        if let data = try? Data(contentsOf: aiURL), let decoded = try? JSONDecoder().decode(AIState.self, from: data) {
            aiBriefs = decoded.briefs
            chats = decoded.chats
        }
        for plan in plans {
            guard let data = try? Data(contentsOf: reportURL(plan.id)) else { continue }
            if plan.isTrip {
                if let json = try? JSON.parse(data) { trips[plan.id] = TripResult(decoding: json) }
            } else if let report = try? Report(data: data) {
                reports[plan.id] = report
            }
        }
        briefPlanID = upcoming.first?.id ?? plans.first?.id
        publishWidgets()
    }

    private func persistPlans() {
        if let data = try? JSONEncoder().encode(plans) { write(data, to: plansURL) }
        publishWidgets()
    }

    private func persistAI() {
        if let data = try? JSONEncoder().encode(AIState(briefs: aiBriefs, chats: chats)) { write(data, to: aiURL) }
    }

    // MARK: Widgets

    /// Hands the widgets each upcoming plan's latest decision, worded as the plan list words it.
    private func publishWidgets() {
        let snapshot = WidgetSnapshot(plans: upcoming.prefix(6).map(widgetPlan), updatedAt: Date())
        snapshot.save()
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.widgetKind)
    }

    private func widgetPlan(_ plan: Plan) -> WidgetPlan {
        let report = reports[plan.id]
        let trip = trips[plan.id]
        var item = WidgetPlan(id: plan.id, name: plan.title, when: "", level: level(plan), levelLabel: nil,
                              line: nil, tiles: [], stripStart: nil, stripEnd: nil, checkedAt: nil, watched: plan.watched)
        if plan.isTrip, let stages = plan.stages {
            item.when = "\(DateText.range(plan.date, plan.endDate)) · \(stages.count) days"
            item.tiles = TripTiles.tiles(plan: plan, trip: trip)
            item.stripStart = "Day 1"
            item.stripEnd = "Day \(stages.count)"
            item.checkedAt = trip?.checkedAt
            if let trip {
                if trip.itinerary == nil {
                    item.levelLabel = "No trip verdict"
                    item.line = "Checked day by day"
                } else {
                    item.line = trip.headlineReason ?? trip.headline
                }
            }
        } else {
            item.when = "\(plan.isSample ? "Sample · " : "")\(DateText.short(plan.date)) · \(DateText.clock(plan.start))"
            if let report {
                item.tiles = report.skyTiles
                item.stripStart = report.stripLabels?.0
                item.stripEnd = report.stripLabels?.1
                // The headline's first clause fits a widget: "Conditions are within your limits".
                item.line = report.outsideLimitsSummary ?? report.limitingChecks.first
                    ?? report.headline.components(separatedBy: " — ").first
                item.checkedAt = report.generatedAt
            }
        }
        return item
    }

    private func persistSaved() {
        if let data = try? JSONEncoder().encode(saved) { write(data, to: savedURL) }
    }

    private func write(_ data: Data, to url: URL) {
        try? data.write(to: url, options: .atomic)
    }
}

// MARK: - Saved trips

/// A trip in the web app's saved-trip format (`frontend/src/app/itinerary.ts` `buildSavedTrip`).
enum TripSnapshot {
    static func build(plan: Plan, trip: TripResult) -> JSON {
        let stages = plan.stages ?? []
        let point: (Place) -> JSON = { $0.json }
        let trailhead = stages.first?.from ?? plan.objective
        let exit = stages.last?.to
        let draft: JSON = .object([
            "name": .string(plan.tripName ?? ""),
            "startDate": .string(plan.date),
            "trailhead": point(trailhead),
            "camps": .array(stages.dropLast().map { stage in .object(["point": point(stage.to), "layover": .bool(stage.isLayover)]) }),
            "exit": exit.map { $0 == trailhead ? JSON.null : point($0) } ?? .null,
            "days": .array(stages.map { stage in
                .object(["start": .string(stage.start), "travelHours": .number(Double(stage.travelHours)),
                         "checkpoints": .array((stage.checkpoints ?? []).map(point))])
            }),
            "bailPoints": .array((plan.bailPoints ?? []).map(point)),
            "track": .null,
        ])
        let webStages: [JSON] = stages.enumerated().map { index, stage in
            .object(["index": .number(Double(index)), "date": .string(DateText.addDays(plan.date, index)), "start": .string(stage.start),
                     "travelHours": .number(Double(stage.travelHours)), "from": point(stage.from), "to": point(stage.to),
                     "layover": .bool(stage.isLayover), "checkpoints": .array((stage.checkpoints ?? []).map(point))])
        }
        let results: [JSON] = stages.indices.map { index in
            let entry = trip.stageEntry(index)
            return .object(["index": .number(Double(index)), "date": .string(DateText.addDays(plan.date, index)),
                            "fromElevationFt": entry["fromElevationFt"], "report": entry["report"],
                            "checkpoints": .array((stages[index].checkpoints ?? []).enumerated().map { checkpoint, place in
                                .object(["name": .string(place.shortName), "lat": .number(place.lat), "lon": .number(place.lon),
                                         "report": entry["checkpoints"][checkpoint]["report"]])
                            })])
        }
        return .object([
            "version": .number(1),
            "title": .string(plan.title.isEmpty ? "Multi-day trip" : plan.title),
            "verdictLevel": trip.itinerary?.at("assessment.level") ?? .null,
            "draft": draft,
            "preferences": plan.webPreferences,
            "result": .object([
                "checkedAt": .string(ISO8601DateFormatter.flexible.string(from: trip.checkedAt)),
                "startDate": .string(plan.date),
                "stages": .array(webStages),
                "results": .array(results),
                "assessment": trip.itinerary?["assessment"] ?? .null,
                "chatContext": trip.chatContext,
            ]),
        ])
    }

    static func read(_ snapshot: JSON) -> (Plan, TripResult)? {
        let draft = snapshot["draft"], result = snapshot["result"]
        let webStages = result["stages"].array
        guard webStages.count >= 2, let startDate = result["startDate"].string ?? draft["startDate"].string else { return nil }
        let stages: [Stage] = webStages.compactMap { stage in
            guard let from = Place(json: stage["from"]), let to = Place(json: stage["to"]) else { return nil }
            return Stage(start: stage["start"].string ?? "07:00", travelHours: stage["travelHours"].int ?? 8, from: from, to: to,
                         layover: stage["layover"].bool, checkpoints: stage["checkpoints"].array.compactMap(Place.init(json:)))
        }
        guard stages.count == webStages.count, let first = stages.first else { return nil }
        let preferences = snapshot["preferences"]
        let activity = preferences["defaultActivity"].string.flatMap(Activity.init(rawValue:)) ?? .backpacking
        let limits = Limits(web: preferences, fallback: activity.defaultLimits) ?? activity.defaultLimits
        var plan = Plan(objective: first.from, activity: activity, date: startDate, start: first.start, travelHours: first.travelHours,
                        limits: limits, stages: stages)
        plan.tripName = draft["name"].string ?? snapshot["title"].string
        plan.bailPoints = draft["bailPoints"].array.compactMap(Place.init(json:))
        let itinerary: JSON = .object([
            "stages": .array(result["results"].array),
            "assessment": result["assessment"],
            "chatContext": result["chatContext"],
        ])
        let checkedAt = result["checkedAt"].string.flatMap(ISO8601DateFormatter.parse) ?? Date()
        return (plan, TripResult(itinerary: result["assessment"].isNull ? nil : itinerary, stageReports: result["results"].array.map { $0["report"].isNull ? nil : Report(json: $0["report"]) },
                                 checkedAt: checkedAt, fallbackReason: result["assessment"].isNull ? "This saved trip has no trip verdict." : nil))
    }
}
