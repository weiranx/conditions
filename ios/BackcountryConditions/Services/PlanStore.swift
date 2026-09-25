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

    var headline: String? { itinerary?.at("assessment.headline").string }

    func stageReport(_ index: Int) -> Report? {
        if let itinerary {
            let report = itinerary["stages"][index]["report"]
            return report.isNull ? nil : Report(json: report)
        }
        return stageReports.indices.contains(index) ? stageReports[index] : nil
    }

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

/// Plans, their latest reports, saved snapshots and the watchlist, kept on the device.
@Observable
final class PlanStore {
    private(set) var plans: [Plan] = []
    private(set) var saved: [SavedReport] = []
    private(set) var reports: [UUID: Report] = [:]
    private(set) var trips: [UUID: TripResult] = [:]
    private(set) var loading: Set<UUID> = []
    private(set) var errors: [UUID: String] = [:]
    /// The plan the Brief tab shows.
    var briefPlanID: UUID?

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
        try? FileManager.default.removeItem(at: reportURL(id))
        if briefPlanID == id { briefPlanID = upcoming.first?.id }
        persistPlans()
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
        await refreshAll(watched.filter { $0.endDate >= DateText.today() && !$0.isSample })
    }

    func markReviewed(_ id: UUID) {
        guard var plan = plan(id), plan.watch != nil else { return }
        plan.watch?.reviewed = true
        update(plan)
    }

    func saveSnapshot(_ plan: Plan) {
        guard let report = reports[plan.id] else { return }
        saved.insert(SavedReport(plan: plan, reportData: report.data), at: 0)
        persistSaved()
    }

    func deleteSaved(_ id: UUID) {
        saved.removeAll { $0.id == id }
        persistSaved()
    }

    // MARK: Checking

    func refresh(_ plan: Plan) async {
        guard !loading.contains(plan.id) else { return }
        loading.insert(plan.id)
        errors[plan.id] = nil
        defer { loading.remove(plan.id) }
        do {
            if plan.isTrip {
                let result = try await checkTrip(plan)
                trips[plan.id] = result
                write(result.encoded().data(), to: reportURL(plan.id))
                recordWatch(plan, level: result.level, reason: result.headline, incomplete: result.itinerary == nil)
            } else {
                let report = try await fetchReport(plan)
                reports[plan.id] = report
                write(report.data, to: reportURL(plan.id))
                recordWatch(plan, level: report.level, reason: report.limitingChecks.first ?? report.reason, incomplete: report.partialData)
            }
        } catch {
            errors[plan.id] = error.localizedDescription
        }
        publishWidgets()
    }

    func refreshAll(_ selection: [Plan]? = nil) async {
        await withTaskGroup(of: Void.self) { group in
            for plan in selection ?? upcoming { group.addTask { await self.refresh(plan) } }
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
    private func reportURL(_ id: UUID) -> URL { directory.appending(path: "reports/\(id.uuidString).json") }

    private func load() {
        if let data = try? Data(contentsOf: plansURL), let decoded = try? JSONDecoder().decode([Plan].self, from: data) { plans = decoded }
        if let data = try? Data(contentsOf: savedURL), let decoded = try? JSONDecoder().decode([SavedReport].self, from: data) { saved = decoded }
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
        var item = WidgetPlan(id: plan.id, name: plan.objective.shortName, when: "", level: level(plan), levelLabel: nil,
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
                    item.line = trip.itinerary?.at("assessment.weakLink.reason").string ?? trip.headline
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
