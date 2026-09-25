import SwiftUI

// MARK: - Saved reports

/// Saved reports: snapshots kept on this iPhone and, signed in, the account's report history and
/// saved trips (the web's Saved reports). Saved reports never update.
struct SavedView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    /// Pushed inside another navigation stack rather than owning one.
    var embedded = false

    @State private var remote: [JSON] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var aiOnly = false
    @State private var trips: [JSON] = []
    @State private var tripError: String?
    @State private var openLink = false
    @State private var link = ""
    @State private var opened: RemoteReport?
    @State private var openedTrip: UUID?
    @State private var busy: String?

    var body: some View {
        if embedded { content } else { NavigationStack { content } }
    }

    private var content: some View {
        Page {
            PageHeader(kicker: "Library", title: "Saved", subtitle: subtitle)
            Spacer().frame(height: 24)
            if !store.saved.isEmpty {
                SectionHead(title: "On this iPhone") { Text("\(store.saved.count)") }
                VStack(spacing: 12) {
                    ForEach(store.saved) { item in
                        let report = try? Report(data: item.reportData)
                        NavigationLink {
                            if let report {
                                BriefView(plan: item.plan, snapshot: report, savedAt: item.savedAt, savedAI: item.aiNarrative, savedChat: item.chat ?? [])
                            }
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
                Spacer().frame(height: 28)
            }
            accountHistory
            if account.signedIn && account.flags.tripPlanning {
                Spacer().frame(height: 28)
                savedTrips
            }
        }
        .refreshable { await reload() }
        .task(id: account.user?.id) { await reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Open a shared link", systemImage: "link") { openLink = true }
            }
        }
        .alert("Open a shared report", isPresented: $openLink) {
            TextField("Report link", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Open") {
                if let token = DeepLink.reportToken(from: link) { opened = RemoteReport(source: .shared(token)) }
                link = ""
            }
            Button("Cancel", role: .cancel) { link = "" }
        } message: {
            Text("Paste a link to a report someone shared, like \(AppSettings.webOrigin)/report/….")
        }
        .navigationDestination(item: $opened) { remote in RemoteReportView(remote: remote) }
        .navigationDestination(item: $openedTrip) { id in
            if let plan = store.plan(id) { TripView(plan: plan) }
        }
    }

    private var subtitle: String? {
        let local = store.saved.count
        let parts = [local > 0 ? "\(local) on this iPhone" : nil, account.signedIn && !remote.isEmpty ? "\(remote.count)\(cursor == nil ? "" : "+") in your account" : nil].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    @ViewBuilder private var accountHistory: some View {
        SectionHead(title: "Account history") { if loading { ProgressView().controlSize(.small) } }
        if !account.signedIn {
            Notice(tone: .info, text: "Sign in to keep reports in your account, open them on the web, and share links. Reports saved here stay on this iPhone.")
        } else if !account.flags.reportHistory {
            Notice(tone: .missing, text: "Report history is turned off on this server.")
        } else {
            VStack(spacing: 10) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.secondary)
                    TextField("Search objective or date (YYYY-MM-DD)", text: $search)
                        .textInputAutocapitalization(.never)
                        .onSubmit { Task { await reload() } }
                    if !search.isEmpty { Button("Clear", systemImage: "xmark.circle.fill") { search = ""; Task { await reload() } }.labelStyle(.iconOnly).foregroundStyle(Palette.secondary) }
                }
                .padding(10)
                .background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
                Toggle("With AI content", isOn: $aiOnly).font(.subheadline).onChange(of: aiOnly) { Task { await reload() } }
                if let error { Notice(tone: .caution, text: error, actionTitle: "Try again") { Task { await reload() } }.padding(.horizontal, -16) }
                if remote.isEmpty && !loading && error == nil {
                    Caption(search.isEmpty && !aiOnly ? "No reports saved to your account yet. Save one from a brief." : "No matching reports.")
                }
                ForEach(Array(remote.enumerated()), id: \.offset) { _, item in
                    Button {
                        if let id = item["id"].string { opened = RemoteReport(source: .account(id), shareToken: item["shareToken"].string) }
                    } label: {
                        Card(spacing: 3) {
                            HStack {
                                Text(item["objectiveName"].string ?? item["title"].string ?? "Report").font(.headline).foregroundStyle(Palette.label).lineLimit(1)
                                Spacer()
                                if item["hasAi"].bool == true { Image(systemName: "sparkles").foregroundStyle(Palette.accent) }
                                if let score = item["score"].int { Text("\(score)").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.secondary) }
                            }
                            Text([item["forecastDate"].string.map(DateText.short), item["alpineStartTime"].string.map { "\(DateText.clock($0)) start" },
                                  DateText.stamp(item["generatedAt"].string ?? item["createdAt"].string).map { "generated \($0)" }]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        if account.flags.reportSharing, let token = item["shareToken"].string {
                            ShareLink(item: PlanStore.shareURL(token: token)) { Label("Share link", systemImage: "link") }
                            Button("Copy link", systemImage: "doc.on.doc") { UIPasteboard.general.url = PlanStore.shareURL(token: token) }
                        }
                    }
                }
                if cursor != nil {
                    Button(loading ? "Loading…" : "Load more") { Task { await loadMore() } }.buttonStyle(.glass).disabled(loading)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder private var savedTrips: some View {
        SectionHead(title: "Saved trips") { Text("\(trips.count)") }
        VStack(spacing: 10) {
            if let tripError { Notice(tone: .caution, text: tripError).padding(.horizontal, -16) }
            if trips.isEmpty && tripError == nil { Caption("Trips you save from a trip brief appear here.") }
            ForEach(Array(trips.enumerated()), id: \.offset) { _, trip in
                Card(spacing: 4) {
                    HStack {
                        Text(trip["title"].string ?? "Trip").font(.headline).lineLimit(1)
                        Spacer()
                        if let level = trip["verdictLevel"].string {
                            LevelTag(level: DecisionLevel(level), label: level == "INCOMPLETE" ? "Incomplete" : nil)
                        }
                    }
                    Text([trip["startDate"].string.map(DateText.short), trip["dayCount"].int.map { "\($0) days" },
                          DateText.stamp(trip["checkedAt"].string).map { "checked \($0)" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Palette.secondary)
                    HStack {
                        Button(busy == trip["id"].string ? "Opening…" : "Open") { Task { await openTrip(trip) } }
                            .buttonStyle(.glassProminent).tint(Palette.prominent)
                        Button("Delete", systemImage: "trash", role: .destructive) { Task { await deleteTrip(trip) } }
                            .buttonStyle(.glass).labelStyle(.iconOnly)
                    }
                    .controlSize(.small)
                    .padding(.top, 4)
                    .disabled(busy != nil)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: Loading

    private func reload() async {
        guard account.signedIn, account.flags.reportHistory else {
            remote = []
            cursor = nil
            return
        }
        loading = true
        defer { loading = false }
        do {
            let page = try await APIClient().savedReports(search: search, aiOnly: aiOnly)
            remote = page["reports"].array
            cursor = page["nextCursor"].string
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        if account.flags.tripPlanning {
            do {
                trips = try await APIClient().savedTrips()
                tripError = nil
            } catch {
                tripError = error.localizedDescription
            }
        }
    }

    private func loadMore() async {
        guard let cursor else { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await APIClient().savedReports(search: search, aiOnly: aiOnly, cursor: cursor)
            remote += page["reports"].array
            self.cursor = page["nextCursor"].string
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openTrip(_ trip: JSON) async {
        guard let id = trip["id"].string else { return }
        busy = id
        defer { busy = nil }
        do {
            let snapshot = try await APIClient().savedTrip(id: id)
            guard let plan = store.importTrip(snapshot) else { throw APIError(message: "This saved trip is incomplete and could not be opened.") }
            openedTrip = plan.id
        } catch {
            tripError = error.localizedDescription
        }
    }

    private func deleteTrip(_ trip: JSON) async {
        guard let id = trip["id"].string else { return }
        busy = id
        defer { busy = nil }
        do {
            try await APIClient().deleteSavedTrip(id: id)
            trips.removeAll { $0["id"].string == id }
        } catch {
            tripError = error.localizedDescription
        }
    }
}

// MARK: - Reports from the account or a link

struct RemoteReport: Hashable, Identifiable {
    enum Source: Hashable {
        case account(String)
        case shared(String)
    }
    var source: Source
    var shareToken: String?

    var id: String {
        switch source {
        case .account(let id): "account-\(id)"
        case .shared(let token): "shared-\(token)"
        }
    }
}

/// A report saved to an account or shared by link, opened as its snapshot.
struct RemoteReportView: View {
    @Environment(PlanStore.self) private var store
    var remote: RemoteReport
    @State private var loaded: (plan: Plan, report: Report, snapshot: JSON)?
    @State private var error: String?

    var body: some View {
        Group {
            if let loaded {
                BriefView(plan: loaded.plan, snapshot: loaded.report,
                          savedAt: loaded.snapshot["savedAt"].string.flatMap(ISO8601DateFormatter.parse) ?? loaded.report.generatedAt,
                          savedAI: loaded.snapshot.at("ai.aiBriefNarrative").string,
                          savedChat: loaded.snapshot.at("ai.reportChatMessages").array.compactMap(ChatMessage.init(json:)),
                          shareToken: remote.shareToken ?? { if case .shared(let token) = remote.source { return token } else { return nil } }(),
                          onPlanAgain: { planAgain(loaded.plan) })
            } else if let error {
                Page {
                    PageHeader(kicker: "Saved report", title: "Report unavailable", subtitle: error)
                    Spacer().frame(height: 16)
                    Button("Try again") { self.error = nil; Task { await load() } }.buttonStyle(.glassProminent).tint(Palette.prominent).padding(.horizontal, 20)
                }
            } else {
                ProgressView("Opening report…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { if loaded == nil { await load() } }
    }

    private func load() async {
        do {
            let snapshot: JSON
            switch remote.source {
            case .account(let id): snapshot = try await APIClient().savedReport(id: id)
            case .shared(let token): snapshot = try await APIClient().sharedReport(token: token)
            }
            guard let plan = Plan(persisted: snapshot), case .object = snapshot["safetyData"] else {
                throw APIError(message: "This report is incomplete and could not be opened.")
            }
            var report = Report(json: snapshot["safetyData"])
            // A report saved before the backend evaluated plans is evaluated for the plan it was saved with.
            if !report.hasEvaluation || report.evaluation["interpretation"].isNull {
                var params = plan.planParams
                params["date"] = plan.date
                let evaluation = try await APIClient().evaluate(report: report.json, params: params)
                var object = report.json.object
                object["evaluation"] = evaluation
                report = Report(json: .object(object))
            }
            loaded = (plan, report, snapshot)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Keeps the report as a plan on this iPhone, to check it again for current conditions.
    private func planAgain(_ plan: Plan) {
        guard let loaded else { return }
        let added = store.importPlan(plan, report: loaded.report)
        store.briefPlanID = added.id
        NotificationCenter.default.post(name: .openPlan, object: added.id)
    }
}

// MARK: - Watchlist

/// Watched plans. On this iPhone, each check compares the backend's new decision with the last one.
/// Signed in, the account's watchlist is also here: the server checks those and keeps their history.
struct WatchlistView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var openBrief: (UUID) -> Void
    var newPlan: (NewPlanDraft) -> Void
    @State private var signIn = false

    private var changed: [Plan] { store.watched.filter { !($0.watch?.reviewed ?? true) } }
    private var steady: [Plan] { store.watched.filter { $0.watch?.reviewed ?? true } }

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(kicker: "Monitoring", title: "Watchlist",
                           subtitle: "Follow conditions as the forecast updates, review what changed, and get alerts.")
                Spacer().frame(height: 24)
                if account.signedIn && account.flags.objectiveWatch {
                    AccountWatchlist(newPlan: newPlan)
                    Spacer().frame(height: 28)
                }
                SectionHead(title: "On this iPhone") { if !store.watched.isEmpty { Text("Pull to check") } }
                if store.watched.isEmpty {
                    Notice(tone: .info, text: "Watch a plan from its brief to keep an eye on it here. Each check compares the new decision with the last one and notifies you when it changes.", symbol: "bell")
                }
                if !changed.isEmpty {
                    SectionHead(title: "Changed") { Text("Not reviewed") }
                    cards(changed, showChange: true)
                    Spacer().frame(height: 28)
                }
                if !steady.isEmpty {
                    if !changed.isEmpty { SectionHead("No change") }
                    cards(steady, showChange: false)
                }
                if !account.signedIn {
                    Spacer().frame(height: 20)
                    VStack(alignment: .leading, spacing: 10) {
                        Caption("Sign in to add plans to your account’s watchlist, where the server checks them on a schedule and can email you.")
                        Button("Sign in", systemImage: "person.crop.circle") { signIn = true }
                            .buttonStyle(.glass).controlSize(.small)
                    }
                    .padding(.horizontal, 20)
                }
            }
            .refreshable { await store.refreshAll(store.watched, userInitiated: false) }
            .sheet(isPresented: $signIn) {
                NavigationStack {
                    AccountView(reason: "Sign in to use your account’s watchlist.")
                        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { signIn = false } } }
                }
            }
            .toolbar {
                if !store.watched.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Check all", systemImage: "arrow.clockwise") { Task { await store.refreshAll(store.watched, userInitiated: false) } }
                    }
                }
            }
        }
    }

    private func cards(_ plans: [Plan], showChange: Bool) -> some View {
        VStack(spacing: 12) {
            ForEach(plans) { plan in
                let watch = plan.watch
                ItemCard(title: plan.title,
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

/// The account's objective watches (the web's Watchlist): the server checks them, keeps their
/// history, and can email when risk increases.
struct AccountWatchlist: View {
    @Environment(AccountStore.self) private var account
    var newPlan: (NewPlanDraft) -> Void

    enum Filter: String, CaseIterable, Identifiable {
        case active = "Active", attention = "Needs attention", ended = "Completed", all = "All"
        var id: String { rawValue }
    }

    @State private var watches: [JSON] = []
    @State private var policy: JSON = .null
    @State private var loading = false
    @State private var error: String?
    @State private var notice: String?
    @State private var pending: String?
    @State private var filter: Filter = .active
    @State private var search = ""
    @State private var history: WatchHistoryItem?
    @State private var deleting: JSON?
    @State private var baseline: RemoteBaseline?

    struct WatchHistoryItem: Identifiable { var id: String; var title: String }
    struct RemoteBaseline: Identifiable, Hashable {
        var id: String
        var snapshot: JSON
        static func == (a: RemoteBaseline, b: RemoteBaseline) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(title: "Your account") { if loading { ProgressView().controlSize(.small) } }
            VStack(spacing: 10) {
                if !policyLine.isEmpty { Caption(policyLine).padding(.horizontal, 4) }
                if let error { Notice(tone: .caution, text: error, actionTitle: "Retry") { Task { await load() } }.padding(.horizontal, -16) }
                if let notice { Notice(tone: .info, text: notice).padding(.horizontal, -16) }
                if !watches.isEmpty {
                    Picker("Filter watches", selection: $filter) {
                        ForEach(Filter.allCases) { item in Text("\(item.rawValue) \(count(item))").tag(item) }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    TextField("Search by name or date", text: $search)
                        .padding(10).background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
                }
                if watches.isEmpty && !loading && error == nil {
                    Caption("No account watches yet. Choose “Watch in your account” on a brief.")
                }
                ForEach(Array(visible.enumerated()), id: \.offset) { _, watch in card(watch) }
            }
            .padding(.horizontal, 16)
        }
        .task(id: account.user?.id) { await load() }
        .sheet(item: $history) { item in WatchHistorySheet(id: item.id, title: item.title) }
        .navigationDestination(item: $baseline) { item in
            if let plan = Plan(persisted: item.snapshot) {
                BriefView(plan: plan, snapshot: Report(json: item.snapshot["safetyData"]), savedAt: item.snapshot["savedAt"].string.flatMap(ISO8601DateFormatter.parse),
                          note: "This is the report the watch compares new checks against. It doesn’t update.")
            }
        }
        .confirmationDialog("Stop watching \(deleting?["title"].string ?? "this objective")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Remove watch", role: .destructive) {
                if let watch = deleting { Task { await run(watch) { try await APIClient().deleteWatch(id: $0) } } }
                deleting = nil
            }
        } message: {
            Text("Its check history is deleted with it.")
        }
    }

    // MARK: Cards

    private func card(_ watch: JSON) -> some View {
        let id = watch["id"].string ?? ""
        let plan = watch["plan"]
        let latest = watch["latestCheck"]
        let ended = hasEnded(watch)
        let attention = needsAttention(watch)
        let wait = refreshWait(watch)
        let unreviewed = watch["unreviewedChanges"]
        return Card(spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(plan["forecastDate"].string.map(DateText.short) ?? "") · \(plan["alpineStartTime"].string.map(DateText.clock) ?? "") · \(plan["travelWindowHours"].int ?? 0)h window")
                        .font(.caption).foregroundStyle(Palette.secondary)
                    Text(watch["title"].string ?? "Objective").font(.headline)
                    if let route = watch["route"].object["checkpointCount"]?.int {
                        Text("Also checks \(route) checkpoints along \(watch.at("route.name").string ?? "the analyzed route")").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
                Spacer()
                StatusTag(kind: attention ? .over : .ok,
                          text: ended ? "Completed" : policy["automaticChecks"].bool == true ? (policy["schedulerEnabled"].bool == false ? "Checks paused" : "Monitoring") : "Manual checks")
            }
            Caption(ended ? "Monitoring complete · history remains available"
                    : watch["lastCheckedAt"].string.flatMap(ISO8601DateFormatter.parse).map { "Last successful check \(DateText.relative($0))" } ?? "No successful checks yet")
            if !latest.isNull {
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(Self.checkLabel(latest)).font(.subheadline.weight(.semibold))
                        Spacer()
                        if let at = DateText.stamp(latest["checkedAt"].string) { Text(at).font(.caption2).foregroundStyle(Palette.secondary) }
                    }
                    let summary = latest["summary"]
                    if latest["status"].string != "failed", !summary.isNull {
                        Text([summary["score"].int.map { "Score \($0)/100" }, summary["tier"].string.map { "\($0) risk" },
                              summary["avalancheDanger"].int.map { "Avalanche \(DangerScale.name($0))" },
                              summary["maxWindGust"].double.map { "Peak gust \(Format.mph($0))" },
                              summary["maxPrecipChance"].double.map { "Precip \(Int($0.rounded()))%" }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                    if latest["status"].string == "changed" {
                        ForEach(Self.reasons(latest["change"]), id: \.self) { reason in Caption("• \(reason)") }
                    } else if let detail = Self.checkDetail(latest) {
                        Caption(detail)
                    }
                }
                .padding(10)
                .background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
            }
            if !ended, (unreviewed["count"].int ?? 0) > 0 {
                let worse = unreviewed["worsened"].bool == true
                VStack(alignment: .leading, spacing: 4) {
                    Label(worse ? "Risk increased since your last review" : "Conditions improved since your last review",
                          systemImage: worse ? "exclamationmark.triangle" : "info.circle")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(worse ? Palette.caution : Palette.label)
                    if (unreviewed["count"].int ?? 0) > 1 { Caption("\(unreviewed["count"].int ?? 0) changes in check history") }
                    ForEach(Self.reasons(worse ? unreviewed["latestWorse"] : unreviewed["latest"]), id: \.self) { reason in Caption("• \(reason)") }
                    Button("Mark reviewed", systemImage: "checkmark") { Task { await run(watch) { _ = try await APIClient().reviewWatch(id: $0) } } }
                        .buttonStyle(.glass).controlSize(.small)
                }
            }
            if (watch["consecutiveFailures"].int ?? 0) > 0 {
                Caption("\(watch["consecutiveFailures"].int ?? 0) recent checks failed. The last successful result may be stale.", tone: Palette.caution)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Button("Plan this objective") { planObjective(watch) }.buttonStyle(.glassProminent).tint(Palette.prominent)
                    if !watch["baselineReport"].isNull {
                        Button("Open baseline") { baseline = RemoteBaseline(id: id, snapshot: watch["baselineReport"]) }.buttonStyle(.glass)
                    }
                    Button(pending == id ? "Working…" : ended ? "Plan completed" : wait > 0 ? "Check in \(Int((wait / 60).rounded(.up)))m" : "Check now", systemImage: "arrow.clockwise") {
                        Task {
                            await run(watch, success: "Check complete. Review the latest result below.") { _ = try await APIClient().refreshWatch(id: $0) }
                        }
                    }
                    .buttonStyle(.glass)
                    .disabled(pending != nil || ended || wait > 0)
                    Button("Check history") { history = WatchHistoryItem(id: id, title: watch["title"].string ?? "Watch") }.buttonStyle(.glass)
                    Button("Remove", systemImage: "trash", role: .destructive) { deleting = watch }.buttonStyle(.glass).labelStyle(.iconOnly)
                }
                .controlSize(.small)
            }
            if policy["emailAlerts"].bool == true {
                Toggle(account.user?.emailVerified == true ? "Email when risk increases" : "Verify your email in Account to enable alerts",
                       isOn: Binding(get: { watch["notificationsEnabled"].bool == true }, set: { enabled in
                    Task { await run(watch) { _ = try await APIClient().setWatchNotifications(id: $0, enabled: enabled) } }
                }))
                .font(.footnote)
                .disabled(pending != nil || ended || account.user?.emailVerified != true)
            }
        }
    }

    // MARK: State

    private var visible: [JSON] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return watches.filter { watch in
            let text = "\(watch["title"].string ?? "") \(watch.at("plan.forecastDate").string ?? "")".lowercased()
            guard query.isEmpty || text.contains(query) else { return false }
            switch filter {
            case .active: return !hasEnded(watch)
            case .ended: return hasEnded(watch)
            case .attention: return needsAttention(watch)
            case .all: return true
            }
        }.sorted { a, b in
            (hasEnded(a) ? 1 : 0, needsAttention(a) ? 0 : 1, a.at("plan.forecastDate").string ?? "", a["title"].string ?? "")
                < (hasEnded(b) ? 1 : 0, needsAttention(b) ? 0 : 1, b.at("plan.forecastDate").string ?? "", b["title"].string ?? "")
        }
    }

    private func count(_ filter: Filter) -> Int {
        switch filter {
        case .active: watches.filter { !hasEnded($0) }.count
        case .ended: watches.filter(hasEnded).count
        case .attention: watches.filter(needsAttention).count
        case .all: watches.count
        }
    }

    private var policyLine: String {
        guard !policy.isNull else { return "" }
        let active = watches.filter { !hasEnded($0) }.count
        let interval = policy["checkIntervalMinutes"].int ?? 180
        let cadence = interval == 60 ? "hourly" : interval < 60 || interval % 60 != 0 ? "every \(interval) minutes" : "every \(interval / 60) hours"
        let checks = policy["automaticChecks"].bool == true
            ? (policy["schedulerEnabled"].bool == false ? "Automatic checks are paused on this server." : "Automatic checks \(cadence).")
            : "Manual checks · \(policy["manualRefreshCooldownMinutes"].int ?? 60) minute cooldown."
        return "\(active) of \(policy["activeWatchLimit"].int ?? 1) active watches. \(checks) \(policy["historyDays"].int ?? 14) days of check history. \(policy["emailAlerts"].bool == true ? "Email alerts available." : "Email alerts require Premium.")"
    }

    /// A watch ends 14 hours after its plan date ends in UTC, matching the server's expiry
    /// (the web's `watchHasEnded`).
    private func hasEnded(_ watch: JSON) -> Bool {
        guard let date = watch.at("plan.forecastDate").string, let end = ISO8601DateFormatter.parse("\(date)T23:59:59Z") else { return true }
        return Date() > end.addingTimeInterval(14 * 3600)
    }

    private func needsAttention(_ watch: JSON) -> Bool {
        guard !hasEnded(watch) else { return false }
        let status = watch.at("latestCheck.status").string
        let unreviewed = watch["unreviewedChanges"]
        let risk = unreviewed.isNull ? ["worse", "mixed"].contains(Self.direction(watch["lastChange"]) ?? "") : unreviewed["worsened"].bool == true
        return (watch["consecutiveFailures"].int ?? 0) > 0 || status == "failed" || status == "partial" || risk || overdue(watch)
    }

    private func overdue(_ watch: JSON) -> Bool {
        guard policy["automaticChecks"].bool == true, policy["schedulerEnabled"].bool != false,
              let next = watch["nextCheckAt"].string.flatMap(ISO8601DateFormatter.parse) else { return false }
        return next.addingTimeInterval(6 * 60) < Date()
    }

    /// Seconds until a manual check is allowed again.
    private func refreshWait(_ watch: JSON) -> TimeInterval {
        guard !policy.isNull, let attempted = (watch["lastAttemptedAt"].string ?? watch["lastCheckedAt"].string).flatMap(ISO8601DateFormatter.parse) else { return 0 }
        let cooldown = TimeInterval((policy["manualRefreshCooldownMinutes"].int ?? 0) * 60)
        return max(0, attempted.addingTimeInterval(cooldown).timeIntervalSinceNow)
    }

    private static let improvementKeys: Set<String> = ["score_improvement", "risk_tier_improvement", "avalanche_danger_improvement", "closure_lifted",
                                                       "weather_alert_cleared", "wind_gust_improvement", "precipitation_improvement", "terrain_condition_improvement"]

    static func reasonDirection(_ reason: JSON) -> String {
        if let direction = reason["direction"].string, direction == "worse" || direction == "better" { return direction }
        return improvementKeys.contains(reason["key"].string ?? "") ? "better" : "worse"
    }

    static func direction(_ change: JSON) -> String? {
        let directions = Set(change["reasons"].array.map(reasonDirection))
        if directions.contains("worse") && directions.contains("better") { return "mixed" }
        if directions.contains("worse") { return "worse" }
        return directions.contains("better") ? "better" : nil
    }

    static func checkLabel(_ check: JSON) -> String {
        switch check["status"].string {
        case "changed": direction(check["change"]) == "better" ? "Conditions improved" : "Risk increased"
        case "unchanged": "No meaningful change"
        case "partial": "Incomplete source data"
        case "failed": "Check failed"
        default: "Latest check"
        }
    }

    static func checkDetail(_ check: JSON) -> String? {
        switch check["status"].string {
        case "failed": "Conditions could not be retrieved. Previous results may be out of date."
        case "partial": "Some source data is missing. No change alert was generated."
        default: "Nothing meaningful changed since the last reported conditions."
        }
    }

    /// What a change reported, risk increases first.
    static func reasons(_ change: JSON) -> [String] {
        let reasons = change["reasons"].array.filter { $0["label"].string != nil }
        let label: (JSON) -> String = { reason in
            (reason["label"].string ?? "").replacingOccurrences(of: #"\bfrom (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) mph\b"#, with: "from $1 mph to $2 mph", options: .regularExpression)
        }
        return reasons.filter { reasonDirection($0) == "worse" }.map(label) + reasons.filter { reasonDirection($0) == "better" }.map(label)
    }

    private func load() async {
        guard account.signedIn else { return }
        loading = true
        defer { loading = false }
        do {
            let json = try await APIClient().watches()
            watches = json["watches"].array
            policy = json["policy"]
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ watch: JSON, success: String? = nil, _ action: @escaping (String) async throws -> Void) async {
        guard let id = watch["id"].string else { return }
        pending = id
        error = nil
        notice = nil
        do {
            try await action(id)
            notice = success
        } catch {
            self.error = error.localizedDescription
        }
        pending = nil
        await load()
    }

    private func planObjective(_ watch: JSON) {
        let plan = watch["plan"]
        guard let lat = plan["lat"].double, let lon = plan["lon"].double else { return }
        var draft = NewPlanDraft(objective: Place(name: plan["objectiveName"].string ?? watch["title"].string ?? "Objective", lat: lat, lon: lon, elevationFt: nil, kind: nil))
        draft.date = plan["forecastDate"].string
        draft.start = plan["alpineStartTime"].string
        draft.hours = plan["travelWindowHours"].int
        newPlan(draft)
    }
}

/// A watch's checks and change events.
struct WatchHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    var id: String
    var title: String
    @State private var checks: [JSON] = []
    @State private var events: [JSON] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(Palette.caution) }
                if !loading && checks.isEmpty && error == nil { Text("No checks recorded yet.").foregroundStyle(Palette.secondary) }
                ForEach(Array(checks.enumerated()), id: \.offset) { _, check in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(check["checkType"].string == "manual" ? "Manual check" : "Automatic check") · \(AccountWatchlist.checkLabel(check))")
                            .font(.caption).foregroundStyle(Palette.secondary)
                        Text(check["checkedAt"].string.flatMap(ISO8601DateFormatter.parse).map { DateText.relative($0).capitalized } ?? "—").font(.headline)
                        if check["status"].string == "changed" {
                            ForEach(AccountWatchlist.reasons(check["change"]), id: \.self) { Text("• \($0)").font(.footnote) }
                        } else if let detail = AccountWatchlist.checkDetail(check) {
                            Text(detail).font(.footnote)
                        }
                        if let error = check["error"].string { Text(error).font(.footnote).foregroundStyle(Palette.caution) }
                        RawDataDisclosure(title: "Check measurements", value: check["summary"])
                    }
                }
                if !events.isEmpty {
                    Section("Change events") { RawDataDisclosure(title: "\(events.count) events", value: .array(events)) }
                }
            }
            .overlay { if loading { ProgressView() } }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task {
                do {
                    async let checks = APIClient().watchChecks(id: id)
                    async let events = APIClient().watchEvents(id: id)
                    (self.checks, self.events) = try await (checks, events)
                } catch {
                    self.error = error.localizedDescription
                }
                loading = false
            }
        }
    }
}
