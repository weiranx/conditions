import SwiftUI

/// The Brief tab: the chosen plan's brief, or its trip brief for a multi-day plan.
struct BriefTab: View {
    @Environment(PlanStore.self) private var store
    var newPlan: () -> Void

    var body: some View {
        NavigationStack {
            if let plan = store.plan(store.briefPlanID) ?? store.upcoming.first {
                Group {
                    if plan.isTrip { TripView(plan: plan) } else { BriefView(plan: plan) }
                }
                .id(plan.id)
            } else {
                Page {
                    PageHeader(kicker: "Brief", title: "No plan yet", subtitle: "Make a plan to see its brief here.")
                    Spacer().frame(height: 20)
                    HStack(spacing: 10) {
                        Button("New plan", systemImage: "plus", action: newPlan).buttonStyle(.glassProminent).tint(Palette.prominent)
                        Button("Try a sample") { store.addSamplePlan() }.buttonStyle(.glass)
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }
}

/// Switches the Brief between plans.
struct PlanSwitcher: View {
    @Environment(PlanStore.self) private var store

    var body: some View {
        Menu {
            ForEach(store.upcoming) { plan in
                Button { store.briefPlanID = plan.id } label: {
                    Label(plan.title, systemImage: store.briefPlanID == plan.id ? "checkmark" : plan.isTrip ? "tent" : "mappin")
                    // The date and decision tell apart two plans for the same objective.
                    Text([plan.isTrip ? DateText.range(plan.date, plan.endDate) : DateText.short(plan.date), verdict(plan)]
                        .compactMap { $0 }.joined(separator: " · "))
                }
            }
        } label: {
            Label("Plans", systemImage: "list.bullet")
        }
    }

    /// The plan card's word for the decision, once there is one.
    private func verdict(_ plan: Plan) -> String? {
        if plan.isTrip, let trip = store.trip(plan) { return trip.itinerary == nil ? "No trip verdict" : store.level(plan).label }
        return store.report(plan) == nil ? nil : store.level(plan).label
    }
}

/// A day plan's brief. `snapshot` shows a saved report, which never updates.
struct BriefView: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var plan: Plan
    var snapshot: Report?
    var savedAt: Date?
    /// Why a snapshot won't update, when it isn't a saved report (a trip day).
    var note: String?
    /// A saved snapshot's AI explanation and conversation.
    var savedAI: String?
    var savedChat: [ChatMessage] = []
    /// A saved report's share token, for its link.
    var shareToken: String?
    /// Keeps a saved report as a plan to check again.
    var onPlanAgain: (() -> Void)?

    @State private var editing: NewPlanDraft?
    @State private var chapter: Chapter?
    @State private var fullReport = false
    /// The report generation last saved from this brief, so Save shows it's done.
    @State private var savedGeneration: String?
    @State private var feedback: String?
    @State private var busy = false
    @State private var chatOpen = false
    @State private var signIn: String?
    @State private var shareURL: URL?
    @State private var confirmDelete = false
    /// Past the sky hero, the bar carries the plan's name and decision.
    @State private var pastHero = false
    @State private var width: CGFloat = 400

    private var report: Report? { snapshot ?? store.report(plan) }
    private var isLoading: Bool { snapshot == nil && store.loading.contains(plan.id) }
    private var live: Plan { store.plan(plan.id) ?? plan }
    private var readOnly: Bool { snapshot != nil }

    var body: some View {
        ScrollView {
            if let report {
                content(report)
            } else {
                placeholder
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(Palette.bg)
        .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y > 320 } action: { _, past in
            withAnimation(.easeOut(duration: 0.2)) { pastHero = past }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .refreshable { if snapshot == nil { await store.refresh(plan) } }
        .toolbar { toolbar }
        .navigationDestination(item: $chapter) { chapter in
            ChapterView(plan: live, report: report, snapshot: snapshot != nil, chapter: chapter)
        }
        .navigationDestination(isPresented: $fullReport) {
            if let report { FullReportView(plan: live, report: report, snapshot: snapshot != nil) }
        }
        .sheet(item: $editing) { draft in
            NewPlanSheet(draft: draft) { updated in
                store.update(updated)
                Task { await store.refresh(updated) }
            }
        }
        .sheet(isPresented: $chatOpen) {
            if let report {
                ChatView(title: "Ask about this report", context: "\(plan.objective.shortName) · \(DateText.short(plan.date))", contextType: "report",
                         payload: live.chatPayload(report), readOnly: readOnly, messages: readOnly ? savedChat : store.chat(plan),
                         onChange: { if !readOnly { store.setChat($0, for: plan) } }, onSignIn: { signIn = "Sign in to use the report assistant." })
            }
        }
        .sheet(item: Binding(get: { signIn.map(SignInReason.init) }, set: { signIn = $0?.text })) { reason in
            NavigationStack {
                AccountView(reason: reason.text)
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { signIn = nil } } }
            }
        }
        .confirmationDialog("Delete this plan?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete plan", role: .destructive) { store.delete(plan.id) }
        }
        .task { if snapshot == nil, report == nil, !isLoading { await store.refresh(plan) } }
        .task(id: shareToken) { if let shareToken { shareURL = PlanStore.shareURL(token: shareToken) } }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if snapshot == nil {
            ToolbarItem(placement: .topBarLeading) { PlanSwitcher().tint(barTint) }
        }
        // Leading rather than centred, so a long name has the room the trailing buttons leave.
        if pastHero {
            ToolbarItem(placement: .topBarLeading) {
                BarTitle(title: plan.objective.shortName, alignment: .leading, font: .subheadline.weight(.semibold)) {
                    if let report {
                        Label(report.level.label, systemImage: report.level.symbol)
                            .labelStyle(TightLabelStyle())
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(report.level.color)
                    }
                }
                .padding(.horizontal, 4)
                // The bar leaves a leading item no room of its own; take what the buttons don't use.
                .frame(width: max(80, width - (snapshot == nil ? 285 : 200)), alignment: .leading)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        if snapshot == nil {
            ToolbarItem(placement: .topBarTrailing) {
                // Spelled out over the hero; an icon once the bar carries the plan's name.
                Button("Edit plan", systemImage: "slider.horizontal.3") { editing = NewPlanDraft(editing: live) }
                    .labelStyle(EditLabelStyle(iconOnly: pastHero))
                    .accessibilityLabel("Edit plan")
                    .tint(barTint)
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let report {
                shareMenu(report).tint(barTint)
            }
            Menu {
                if snapshot == nil {
                    Button("Check again", systemImage: "arrow.clockwise") { Task { await store.refresh(plan) } }
                    Button("Save on this iPhone", systemImage: "square.and.arrow.down") { store.saveSnapshot(plan) }.disabled(report == nil)
                    if account.flags.reportHistory {
                        Button("Save to your account", systemImage: "icloud.and.arrow.up") { accountAction { _ = try await store.saveToAccount(plan); return "Report saved to your account." } }
                            .disabled(report == nil || plan.isSample)
                    }
                    Button("Email report", systemImage: "envelope") { accountAction { try await store.emailReport(plan) } }
                        .disabled(report == nil || plan.isSample)
                    Button(live.watched ? "Stop watching on this iPhone" : "Watch on this iPhone", systemImage: live.watched ? "bell.slash" : "bell") { store.toggleWatch(plan.id) }
                    if account.flags.objectiveWatch {
                        Button("Watch in your account", systemImage: "bell.badge") { accountAction { try await store.watchOnAccount(plan) } }
                            .disabled(report == nil || plan.isSample)
                    }
                } else if let onPlanAgain {
                    Button("Plan this objective again", systemImage: "arrow.clockwise", action: onPlanAgain)
                }
                if let report {
                    ShareLink(item: ReportExport(report: report, name: plan.objective.shortName), preview: SharePreview("\(plan.objective.shortName) report data")) {
                        Label("Export report data", systemImage: "arrow.down.doc")
                    }
                }
                if snapshot == nil {
                    Button("Delete plan", systemImage: "trash", role: .destructive) { confirmDelete = true }
                }
            } label: { Label("More", systemImage: "ellipsis") }.tint(barTint)
        }
    }

    /// Share: the web link when the report is (or can be) saved to the account, and the text summary.
    @ViewBuilder
    private func shareMenu(_ report: Report) -> some View {
        Menu {
            if let shareURL {
                ShareLink(item: shareURL) { Label("Share link", systemImage: "link") }
                Button("Copy link", systemImage: "doc.on.doc") { UIPasteboard.general.url = shareURL; feedback = "Report link copied." }
            } else if account.flags.reportSharing && snapshot == nil && !plan.isSample {
                Button("Create a share link", systemImage: "link") {
                    accountAction {
                        let url = try await store.shareURL(plan)
                        shareURL = url
                        UIPasteboard.general.url = url
                        return "Report saved to your account and its link copied."
                    }
                }
            }
            ShareLink(item: BriefText.summary(plan: plan, report: report)) { Label("Share summary", systemImage: "text.alignleft") }
        } label: {
            Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
        }
    }

    /// Toolbar labels take the primary colour, which Liquid Glass flips between the dark sky and light content.
    private var barTint: Color { .primary }

    private var placeholder: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageHeader(kicker: plan.activityLabel, title: plan.objective.shortName,
                       subtitle: "\(DateText.short(plan.date)) · \(DateText.clock(plan.start)) start · \(plan.travelHours) hours")
            if isLoading {
                HStack(spacing: 10) { ProgressView(); Text("Checking weather, avalanche, alerts and daylight…").font(.subheadline).foregroundStyle(Palette.secondary) }
                    .padding(.horizontal, 20)
            } else if let error = store.errors[plan.id] {
                Notice(tone: .caution, text: error, actionTitle: account.newReportBlocker != nil && !account.signedIn ? "Sign in" : "Try again") {
                    if account.newReportBlocker != nil && !account.signedIn { signIn = error } else { Task { await store.refresh(plan) } }
                }
            } else {
                Button("Check conditions") { Task { await store.refresh(plan) } }.buttonStyle(.glassProminent).tint(Palette.prominent).padding(.horizontal, 20)
            }
        }
        .padding(.top, 110)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .top) { TopoBackdrop() }
    }

    @ViewBuilder
    private func content(_ report: Report) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SkyHero(plan: live, report: report)
            VStack(alignment: .leading, spacing: 0) {
                notices(report)
                Spacer().frame(height: 24)
                SectionHead(plan.activity.leadsWithRain ? "Wind and rain" : "Wind and cold up high")
                numbers(report)
                Spacer().frame(height: 28)
                SectionHead(title: "Checks") {
                    let failed = report.checks.filter { !$0.ok }.count
                    Text(failed == 0 ? "All clear" : "\(failed) need attention")
                }
                checkGrid(report)
                if !report.fieldSignals.isEmpty {
                    Spacer().frame(height: 28)
                    SectionHead("Field reports")
                    VStack(spacing: 10) {
                        ForEach(Array(report.fieldSignals.enumerated()), id: \.offset) { _, signal in
                            Card { CardHead(title: signal.title) { StatusTag(kind: .over, text: "Check") }; Caption(signal.detail) }
                        }
                    }
                    .padding(.horizontal, 16)
                }
                Spacer().frame(height: 26)
                actions(report)
                Spacer().frame(height: 26)
                Button { fullReport = true } label: {
                    Card(spacing: 2) {
                        HStack {
                            Image(systemName: "doc.text.magnifyingglass").foregroundStyle(Palette.accent)
                            Text("Read the full report").font(.headline).foregroundStyle(Palette.label)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Palette.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                Spacer().frame(height: 26)
                AIBriefCard(plan: live, report: report, savedText: savedAI, readOnly: readOnly || plan.isSample, onSignIn: { signIn = "Sign in to use AI explanations." })
                Spacer().frame(height: 16)
                ChatLauncher(title: "Ask about this report", context: "\(plan.objective.shortName) · \(DateText.short(plan.date))",
                             messageCount: readOnly ? savedChat.count : store.chat(plan).count, readOnly: readOnly || plan.isSample) {
                    if !readOnly && !plan.isSample && !account.signedIn { signIn = "Sign in to use the report assistant." } else { chatOpen = true }
                }
                Spacer().frame(height: 26)
                InsightsSection(report: report)
                Spacer().frame(height: 20)
                sources(report)
            }
            .padding(.bottom, 40)
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func notices(_ report: Report) -> some View {
        VStack(spacing: 10) {
            if let note {
                Notice(tone: .info, text: note)
            } else if let savedAt {
                Notice(tone: .info, text: "Saved snapshot from \(savedAt.formatted(date: .abbreviated, time: .shortened)). It shows conditions from when it was saved and won’t update. For current conditions, plan it again.")
            } else if plan.isSample {
                Notice(tone: .info, text: "Sample plan. It uses a saved Mount Shasta report and won’t update.")
            }
            if let feedback {
                Notice(tone: .info, text: feedback)
            }
            if snapshot == nil, !plan.isSample, let passed = passedStart {
                Notice(tone: .caution, text: "This start has passed (\(passed)). The forecast is kept for reference. Pick a new start to get current conditions.",
                       actionTitle: "Start now") { restart(tomorrow: false) }
                Button("Start tomorrow at \(DateText.clock(PreferencesStore.shared.preferences.defaultStartTime))") { restart(tomorrow: true) }
                    .buttonStyle(.glass).controlSize(.small).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 30)
            }
            if let warning = report.apiWarning ?? report.freshnessWarning ?? (report.partialData ? "Some sources returned incomplete data. Check the official forecasts before committing." : nil) {
                Notice(tone: .missing, text: warning, actionTitle: "Checks & sources") { chapter = .checks }
            }
            if snapshot == nil, let error = store.errors[plan.id] {
                Notice(tone: .caution, text: "Couldn’t update: \(error)", actionTitle: "Try again") { Task { await store.refresh(plan) } }
            }
            if !report.warnings.isEmpty {
                Notice(tone: .caution, text: "Field reports to check. " + report.warnings.map { "\($0.title): \($0.detail)" }.joined(separator: " · ") + " Check when each report was made and whether it applies to your route.")
            }
            if !report.missingSignals.isEmpty {
                Notice(tone: .missing, text: report.missingSignals.joined(separator: " · ") + ". Missing data does not mean conditions are clear.")
            }
            if let route = live.route {
                Button { chapter = .route } label: {
                    Notice(tone: .info, text: route.analysis == nil
                        ? "Via \(route.name). Check the forecast at its checkpoints in Route."
                        : "Via \(route.name). \(route.analysis?["summaries"].array.count ?? 0) checkpoints checked\(route.analyzedFor != live.timingKey ? "; the plan changed since" : "").")
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 16)
    }

    /// When the planned start is already behind us on the objective's clock, as "2 hours ago".
    private var passedStart: String? {
        guard let start = DateText.minutes(plan.start) else { return nil }
        let zone = report?.json.at("forecast.timeZone").string ?? report?.json.at("location.timeZone").string
        var calendar = Calendar(identifier: .gregorian)
        if let zone, let tz = TimeZone(identifier: zone) { calendar.timeZone = tz }
        guard let day = DateText.date(plan.date) else { return nil }
        let utc = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: day)
        guard let planned = calendar.date(from: DateComponents(year: utc.year, month: utc.month, day: utc.day, hour: start / 60, minute: start % 60)),
              planned < Date() else { return nil }
        return DateText.relative(planned)
    }

    private func restart(tomorrow: Bool) {
        guard var next = store.plan(plan.id) else { return }
        if tomorrow {
            next.date = DateText.addDays(DateText.today(), 1)
            next.start = PreferencesStore.shared.preferences.defaultStartTime
        } else {
            next.date = DateText.today()
            let now = Calendar.current.dateComponents([.hour, .minute], from: Date())
            next.start = String(format: "%02d:%02d", now.hour ?? 0, ((now.minute ?? 0) / 15) * 15)
        }
        store.update(next)
        Task { await store.refresh(next) }
    }

    private func accountAction(_ action: @escaping () async throws -> String) {
        guard account.signedIn else {
            signIn = "Sign in to save reports to your account, share links, email reports and use the account watchlist."
            return
        }
        busy = true
        feedback = nil
        Task {
            do {
                feedback = try await action()
                if let token = store.plan(plan.id)?.shareToken { shareURL = PlanStore.shareURL(token: token) }
            } catch let error as APIError where error.needsAccount {
                signIn = error.message
            } catch {
                feedback = error.localizedDescription
            }
            busy = false
        }
    }

    private func numbers(_ report: Report) -> some View {
        let hours = report.hours
        let limits = report.limits ?? plan.limits
        let peakGust = hours.compactMap { hour in hour.gust.map { (hour, $0) } }.max { $0.1 < $1.1 }
        let coldest = hours.compactMap { hour in hour.feelsLike.map { (hour, $0) } }.min { $0.1 < $1.1 }
        let wettest = hours.compactMap { hour in hour.precipChance.map { (hour, $0) } }.max { $0.1 < $1.1 }
        let showRain = plan.activity.leadsWithRain
        return HStack(alignment: .top, spacing: 12) {
            numberTile(title: "Peak gust", value: peakGust?.1, limit: Double(limits.maxGustMph), side: .above, range: 0...max(40, Double(limits.maxGustMph) * 2),
                       text: Format.mph, caption: peakGust.map { "\($0.0.shortLabel)\(elevationText($0.0)). Your limit is \(Format.mph(Double(limits.maxGustMph)))." })
            if showRain {
                numberTile(title: "Rain chance", value: wettest?.1, limit: Double(limits.maxPrecipChance), side: .above, range: 0...100,
                           text: Format.percent, caption: wettest.map { "Highest at \($0.0.shortLabel). Your limit is \(limits.maxPrecipChance)%." })
            } else {
                numberTile(title: "Feels like", value: coldest?.1, limit: Double(limits.minFeelsLikeF), side: .below,
                           range: (Double(limits.minFeelsLikeF) - 15)...(Double(limits.minFeelsLikeF) + 45),
                           text: Format.temp, caption: coldest.map { "Coldest at \($0.0.shortLabel)\(elevationText($0.0)). Your floor is \(Format.temp(Double(limits.minFeelsLikeF)))." })
            }
        }
        .padding(.horizontal, 16)
    }

    private func elevationText(_ hour: Hour) -> String {
        hour.elevationFt.map { " near \(Format.roundFeet($0))" } ?? ""
    }

    private func numberTile(title: String, value: Double?, limit: Double, side: LimitScale.Side, range: ClosedRange<Double>,
                            text: (Double?) -> String, caption: String?) -> some View {
        let over = value.map { side == .above ? $0 > limit : $0 < limit } ?? false
        return Card(missing: value == nil) {
            CardHead(title: title) {
                if value == nil { StatusTag(kind: .missing, text: "Missing") }
                else { StatusTag(kind: over ? .over : .ok, text: over ? "Over" : "Within") }
            }
            BigValue(text: text(value), over: over)
            if let value { LimitScale(value: value, limit: limit, side: side, range: range) }
            Caption(caption ?? "No reading for this plan’s hours.")
        }
    }

    private func checkGrid(_ report: Report) -> some View {
        let columns = [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), spacing: 12, alignment: .top)]
        return LazyVGrid(columns: columns, spacing: 12) {
            ForEach(BriefChecks.cards(for: report, plan: plan)) { item in
                Button { chapter = item.chapter } label: {
                    Card(missing: item.status == .missing) {
                        CardHead(title: item.title) { StatusTag(kind: item.status, text: item.word) }
                        item.visual
                        Caption(item.caption, tone: item.status == .over ? Palette.caution : Palette.secondary, emphasized: item.status == .over)
                            .lineLimit(5)
                        Spacer(minLength: 0)
                        OpenLink(label: item.chapter.shortName)
                    }
                    .frame(maxHeight: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
    }

    private func actions(_ report: Report) -> some View {
        GlassEffectContainer(spacing: 10) {
            VStack(spacing: 10) {
                if snapshot == nil {
                    watchButton
                    HStack(spacing: 10) {
                        let isSaved = (savedGeneration != nil && savedGeneration == (report.generatedAtText ?? "")) || store.savedToAccount(plan)
                        Button {
                            if account.signedIn && account.flags.reportHistory && !plan.isSample {
                                accountAction {
                                    _ = try await store.saveToAccount(plan)
                                    savedGeneration = report.generatedAtText ?? ""
                                    return "Report saved to your account."
                                }
                            } else {
                                store.saveSnapshot(plan)
                                savedGeneration = report.generatedAtText ?? ""
                                feedback = "Saved on this iPhone. Sign in to keep reports in your account."
                            }
                        } label: {
                            Label(isSaved ? "Saved" : "Save", systemImage: isSaved ? "checkmark" : "square.and.arrow.down").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .disabled(isSaved || busy)
                        .sensoryFeedback(.success, trigger: savedGeneration)
                        shareButton(report)
                    }
                } else {
                    shareButton(report)
                    if let onPlanAgain {
                        Button(action: onPlanAgain) { Label("Plan this objective again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                            .buttonStyle(.glassProminent).tint(Palette.prominent)
                    }
                }
            }
            .controlSize(.large)
            .lineLimit(1)
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder private var watchButton: some View {
        let watchingAccount = live.accountWatchID != nil
        let watching = live.watched || watchingAccount
        let label = Label(watching ? "Watching for changes" : "Watch for changes",
                          systemImage: watching ? "bell.fill" : "bell").frame(maxWidth: .infinity)
        if watching {
            Menu {
                Button(live.watched ? "Stop watching on this iPhone" : "Watch on this iPhone", systemImage: "iphone") { store.toggleWatch(plan.id) }
                if account.flags.objectiveWatch && !watchingAccount {
                    Button("Watch in your account", systemImage: "bell.badge") { accountAction { try await store.watchOnAccount(plan) } }
                }
            } label: { label }
            .buttonStyle(.glass)
        } else {
            Button {
                store.toggleWatch(plan.id)
                if account.signedIn && account.flags.objectiveWatch && !plan.isSample {
                    accountAction { try await store.watchOnAccount(plan) }
                } else {
                    feedback = "Watching on this iPhone. Each check compares the new decision with this one."
                }
            } label: { label }
            .buttonStyle(.glassProminent).tint(Palette.prominent)
            .disabled(busy)
        }
    }

    private func shareButton(_ report: Report) -> some View {
        shareMenu(report)
            .buttonStyle(.glass)
            .frame(maxWidth: .infinity)
    }

    private func sources(_ report: Report) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            let generated = report.generatedAt.map { "Generated \(DateText.relative($0))" }
            Caption([report.weatherProvider.map { "\($0) forecast" }, report.avalancheCenter, generated].compactMap { $0 }.joined(separator: " · "))
            Caption("Backcountry Conditions is a planning aid, not a guarantee of safety. Check official forecasts, and make the final call from what you see in the field and your team’s judgment.")
        }
        .padding(.horizontal, 20)
    }
}

private struct EditLabelStyle: LabelStyle {
    var iconOnly: Bool

    func makeBody(configuration: Configuration) -> some View {
        if iconOnly { configuration.icon } else { configuration.title }
    }
}

private struct SignInReason: Identifiable {
    var text: String
    var id: String { text }
}

/// Every chapter on one page (the web's "All sections").
struct FullReportView: View {
    var plan: Plan
    var report: Report
    var snapshot: Bool

    var body: some View {
        Page {
            PageHeader(kicker: "\(plan.objective.shortName) · \(DateText.short(plan.date))", title: "Full report", subtitle: report.headline)
            Spacer().frame(height: 12)
            VStack(alignment: .leading, spacing: 8) {
                VerdictPill(level: report.level)
                if let reason = report.reason { Text(reason).font(.subheadline) }
                if let bridge = report.bridge { Caption(bridge) }
                ForEach(report.limitingChecks, id: \.self) { check in Caption("• \(check)", tone: Palette.label) }
            }
            .padding(.horizontal, 20)
            ForEach(Chapter.ordered(for: plan.activity)) { chapter in
                Spacer().frame(height: 36)
                Text(chapter.rawValue).font(.display(32)).padding(.horizontal, 20).padding(.bottom, 12)
                switch chapter {
                case .weather: WeatherChapter(plan: plan, report: report)
                case .terrain: TerrainChapter(plan: plan, report: report, snapshot: snapshot)
                case .timing: TimingChapter(plan: plan, report: report, snapshot: snapshot)
                case .route: RouteChapter(plan: plan, report: report, snapshot: snapshot)
                case .checks: ChecksChapter(plan: plan, report: report, snapshot: snapshot)
                case .gear: GearActionsSection(report: report)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Sky hero

/// The Brief's signature: the planned day drawn as its forecast sky, with the decision over it.
struct SkyHero: View {
    var plan: Plan
    var report: Report

    private let scene: CGFloat = 196

    var body: some View {
        let hours = report.hours
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text([plan.activityLabel, plan.objective.region].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote.weight(.semibold)).opacity(0.85)
                Text(plan.objective.shortName)
                    .font(.display(42)).tracking(-0.9)
                    .shadow(color: Color(red: 0, green: 0.08, blue: 0.16).opacity(0.25), radius: 12, y: 1)
                    .padding(.top, 4)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                Text(subtitle).font(.subheadline).opacity(0.92).padding(.top, 6)
                VerdictPill(level: report.level).padding(.top, 14)
                Text(report.headline)
                    .font(.title3.weight(.semibold))
                    .padding(.top, 10)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = reason {
                    Text(reason).font(.subheadline).opacity(0.92).padding(.top, 6).fixedSize(horizontal: false, vertical: true)
                }
                if report.limitingChecks.count > 1 {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(report.limitingChecks.dropFirst(), id: \.self) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Circle().frame(width: 6, height: 6).opacity(0.75)
                                Text(item).font(.subheadline).opacity(0.92)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 116)
            .foregroundStyle(.white)

            ZStack(alignment: .bottom) {
                Color.clear
                calloutRow(hours)
                hourLabels(hours)
            }
            .frame(height: scene)
        }
        .background { SkyCanvas(hours: hours, sunrise: report.sunriseMinutes, sunset: report.sunsetMinutes, sceneHeight: scene) }
        .accessibilityElement(children: .contain)
    }

    private var subtitle: String {
        var parts = ["\(DateText.short(report.selectedDate ?? plan.date)) · \(DateText.clock(plan.start)) start", "\(plan.travelHours) hours"]
        if let ft = report.objectiveElevationFt { parts.append(Format.feet(ft)) }
        return parts.joined(separator: " · ")
    }

    private var reason: String? {
        guard let reason = report.reason, reason != report.headline else { return nil }
        let rules = report.hours.flatMap(\.failedRules)
        return rules.reduce(reason) { $0.replacingOccurrences(of: $1, with: Format.plainRule($1)) }
    }

    /// The first run of hours over a limit, named in the sky.
    private func overRun(_ hours: [Hour]) -> ClosedRange<Int>? {
        guard let start = hours.firstIndex(where: \.isOver) else { return nil }
        var end = start
        while end + 1 < hours.count, hours[end + 1].isOver { end += 1 }
        return start...end
    }

    @ViewBuilder
    private func calloutRow(_ hours: [Hour]) -> some View {
        if let run = overRun(hours) {
            GeometryReader { proxy in
                let pad: CGFloat = 16
                let cw = (proxy.size.width - pad * 2) / CGFloat(max(1, hours.count))
                let bandStart = pad + cw * CGFloat(run.lowerBound)
                let label = "Outside your limits · \(hours[run.lowerBound].shortLabel)–\(Hour.shortLabel(minutes: hours[run.upperBound].minutes + 60))"
                let labelWidth: CGFloat = 250
                // Sit above the band when there's room; otherwise keep the whole label on screen.
                let leading = min(max(pad, bandStart), proxy.size.width - labelWidth - pad)
                Label(label, systemImage: "exclamationmark.triangle")
                    .labelStyle(TightLabelStyle())
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(red: 1, green: 0.79, blue: 0.63))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .frame(height: 24)
                    .glassEffect(.regular.tint(.black.opacity(0.35)), in: .capsule)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, leading)
                    .offset(y: 2)
            }
        }
    }

    private func hourLabels(_ hours: [Hour]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("GUST \(Units.current.windSymbol.uppercased())").font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(.white.opacity(0.6)).padding(.leading, 16)
            HStack(spacing: 0) {
                ForEach(hours) { hour in
                    VStack(spacing: 2) {
                        Text(hour.shortLabel).font(.system(size: hours.count > 10 ? 9 : 11, weight: .semibold)).opacity(hour.isOver ? 1 : 0.75)
                        Text(Format.windNumber(hour.gust)).font(.system(size: 14, weight: .bold)).monospacedDigit()
                    }
                    .foregroundStyle(hour.isOver ? Color(red: 1, green: 0.7, blue: 0.48) : .white.opacity(0.92))
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 14)
    }
}

/// Draws the hero's sky: hour columns, stars, the sun on its arc, the over-limit band and the ridge.
struct SkyCanvas: View {
    var hours: [Hour]
    var sunrise: Int?
    var sunset: Int?
    var sceneHeight: CGFloat

    var body: some View {
        Canvas { context, size in
            let w = size.width, h = size.height
            let pad: CGFloat = 16
            let n = max(1, hours.count)
            let cw = (w - pad * 2) / CGFloat(n)
            let kinds = hours.map { SkyKind.at(minute: $0.minutes, sunrise: sunrise, sunset: sunset, condition: $0.condition) }
            let stops: [Gradient.Stop] = kinds.isEmpty
                ? [.init(color: SkyKind.day.hero, location: 0), .init(color: SkyKind.day.hero, location: 1)]
                : kinds.enumerated().map { index, kind in
                    .init(color: kind.hero, location: (pad + cw * (CGFloat(index) + 0.5)) / w)
                }
            let rect = CGRect(origin: .zero, size: size)
            context.fill(Path(rect), with: .linearGradient(Gradient(stops: stops), startPoint: .zero, endPoint: CGPoint(x: w, y: 0)))
            context.fill(Path(rect), with: .linearGradient(Gradient(colors: [.black.opacity(0.5), .black.opacity(0.18), .clear]),
                                                           startPoint: .zero, endPoint: CGPoint(x: 0, y: h * 0.7)))

            let sceneTop = h - sceneHeight
            let horizon = h - 66
            // Stars over the night hours.
            for (index, kind) in kinds.enumerated() where kind == .night || kind == .predawn {
                for star in 0..<3 {
                    let sx = pad + cw * CGFloat(index) + cw * CGFloat([0.2, 0.55, 0.8][star])
                    let sy = sceneTop + 14 + CGFloat((index * 37 + star * 23) % 70)
                    context.fill(Path(ellipseIn: CGRect(x: sx, y: sy, width: 2, height: 2)), with: .color(.white.opacity(star == 1 ? 0.8 : 0.5)))
                }
            }
            // Hours over a limit: a hatched band from the scene's top to the ground.
            var index = 0
            while index < hours.count {
                if hours[index].isOver {
                    var end = index
                    while end + 1 < hours.count, hours[end + 1].isOver { end += 1 }
                    let band = CGRect(x: pad + cw * CGFloat(index), y: sceneTop + 28, width: cw * CGFloat(end - index + 1), height: h - sceneTop - 28)
                    context.fill(Path(band), with: .color(Palette.overHatch.opacity(0.12)))
                    var hatch = Path()
                    var x = band.minX - band.height
                    while x < band.maxX { hatch.move(to: CGPoint(x: x, y: band.maxY)); hatch.addLine(to: CGPoint(x: x + band.height, y: band.minY)); x += 7 }
                    var clipped = context
                    clipped.clip(to: Path(band))
                    clipped.stroke(hatch, with: .color(Palette.overHatch.opacity(0.42)), lineWidth: 2.5)
                    var top = Path(); top.move(to: CGPoint(x: band.minX, y: band.minY)); top.addLine(to: CGPoint(x: band.maxX, y: band.minY))
                    context.stroke(top, with: .color(Palette.overHatch), lineWidth: 2)
                    index = end + 1
                } else {
                    index += 1
                }
            }
            // The sun's arc from sunrise, and the sun at the hour that needs attention.
            if let rise = sunrise, let set = sunset, let first = hours.first {
                let start = first.minutes
                let peak = sceneTop + 60
                let xAt: (Int) -> CGFloat = { pad + CGFloat($0 - start) / 60 * cw }
                let yAt: (Int) -> CGFloat = { horizon - sin(.pi * CGFloat($0 - rise) / CGFloat(max(1, set - rise))) * (horizon - peak) }
                let end = min(set, start + hours.count * 60)
                if rise < end {
                    var arc = Path()
                    arc.move(to: CGPoint(x: xAt(max(rise, start - 120)), y: yAt(max(rise, start - 120))))
                    for m in stride(from: max(rise, start - 120), through: end, by: 8) { arc.addLine(to: CGPoint(x: xAt(m), y: yAt(m))) }
                    context.stroke(arc, with: .color(.white.opacity(0.5)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [1, 5]))
                    let focus = hours.first(where: \.isOver) ?? hours[hours.count / 2]
                    let sunMinute = min(max(focus.minutes + 30, rise), set)
                    let sun = CGPoint(x: xAt(sunMinute), y: yAt(sunMinute))
                    if sun.x > 0 && sun.x < w {
                        context.fill(Path(ellipseIn: CGRect(x: sun.x - 22, y: sun.y - 22, width: 44, height: 44)), with: .color(Color(red: 1, green: 0.84, blue: 0.59).opacity(0.16)))
                        context.fill(Path(ellipseIn: CGRect(x: sun.x - 9, y: sun.y - 9, width: 18, height: 18)), with: .color(Color(red: 1, green: 0.84, blue: 0.59)))
                    }
                }
            }
            // Ridges: the web hero's silhouette, anchored to the bottom.
            let sx = w / 390
            func ridge(_ points: [(CGFloat, CGFloat)]) -> Path {
                var path = Path()
                path.move(to: CGPoint(x: 0, y: h))
                for (x, y) in points { path.addLine(to: CGPoint(x: x * sx, y: h - (560 - y))) }
                path.addLine(to: CGPoint(x: w, y: h))
                path.closeSubpath()
                return path
            }
            context.fill(ridge([(0, 474), (52, 462), (96, 470), (150, 456), (220, 468), (292, 452), (340, 462), (390, 450)]),
                         with: .color(Color(hex: 0x1A2733).opacity(0.85)))
            context.fill(ridge([(0, 492), (36, 486), (78, 474), (118, 466), (156, 452), (186, 440), (202, 436), (214, 441), (246, 414), (258, 409), (270, 414), (304, 438), (344, 456), (390, 468)]),
                         with: .color(Color(hex: 0x0B1411)))
            var snow = Path()
            let cap: [(CGFloat, CGFloat)] = [(236, 423), (246, 414), (258, 409), (270, 414), (279, 421), (270, 419), (262, 424), (255, 418), (247, 423)]
            snow.move(to: CGPoint(x: cap[0].0 * sx, y: h - (560 - cap[0].1)))
            for (x, y) in cap.dropFirst() { snow.addLine(to: CGPoint(x: x * sx, y: h - (560 - y))) }
            snow.closeSubpath()
            context.fill(snow, with: .color(Color(red: 0.93, green: 0.95, blue: 0.96).opacity(0.82)))
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Brief cards

/// The Brief's check cards, each read from the backend's checks and interpretation.
struct BriefCheckCard: Identifiable {
    var id: String { title }
    var title: String
    var status: TagKind
    var word: String
    var caption: String
    var chapter: Chapter
    var visual: AnyView = AnyView(EmptyView())
}

enum BriefChecks {
    static func cards(for report: Report, plan: Plan) -> [BriefCheckCard] {
        var cards: [BriefCheckCard] = []
        let hours = report.hours
        let over = hours.filter(\.isOver)
        let firstRule = over.first?.failedRules.first.map(Format.plainRule)
        cards.append(BriefCheckCard(
            title: "Weather",
            status: hours.isEmpty ? .missing : over.isEmpty ? .ok : .over,
            word: hours.isEmpty ? "Missing" : over.isEmpty ? "Within" : "Over",
            caption: hours.isEmpty ? "No hourly forecast covers this plan." : firstRule.map { "\($0) at \(over[0].shortLabel)." } ?? (report.windowSummary ?? "Every hour is within your limits."),
            chapter: .weather,
            visual: AnyView(GustBars(hours: hours, limit: Double(report.limits?.maxGustMph ?? plan.limits.maxGustMph)))))

        let avalancheCheck = report.check("avalanche")
        if report.avalancheRelevant || avalancheCheck != nil {
            let unknown = report.avalancheUnknown
            let level = report.avalancheLevel
            cards.append(BriefCheckCard(
                title: "Avalanche",
                status: unknown ? .missing : (avalancheCheck?.ok ?? true) ? .ok : .over,
                word: unknown ? "No rating" : DangerScale.name(level),
                caption: report.avalancheCaption ?? avalancheCheck?.detail ?? "No avalanche information for this plan.",
                chapter: .terrain,
                visual: AnyView(DangerChips(rows: report.avalancheRows))))
        }

        if let terrain = report.terrainLabel {
            cards.append(BriefCheckCard(title: "Terrain", status: .ok, word: "Advisory", caption: report.terrainAdvice ?? terrain, chapter: .terrain,
                                        visual: AnyView(BigValue(text: terrain, small: true))))
        }

        let daylight = report.check("daylight")
        cards.append(BriefCheckCard(
            title: "Daylight",
            status: daylight == nil ? .missing : daylight!.ok ? .ok : .over,
            word: daylight == nil ? "Missing" : daylight!.ok ? "Within" : "Late",
            caption: [report.sunriseText.map { "Sunrise \($0)" }, report.sunsetText.map { "sunset \($0)" }].compactMap { $0 }.joined(separator: ", ") + ".",
            chapter: .timing,
            visual: AnyView(SunArc(sunrise: report.sunriseMinutes, sunset: report.sunsetMinutes, start: DateText.minutes(plan.start)))))

        let alerts = report.check("nws-alerts")
        cards.append(BriefCheckCard(
            title: "Alerts",
            status: alerts == nil ? .missing : alerts!.ok ? .ok : .over,
            word: alerts == nil ? "Missing" : (report.alertsCount ?? 0) == 0 ? "None" : "\(report.alertsCount!) active",
            caption: report.alertTitles.first ?? alerts?.detail ?? "No alert data was returned.",
            chapter: .checks,
            visual: AnyView(BigValue(text: (report.alertsCount ?? 0) == 0 ? "No alerts" : "\(report.alertsCount!) alerts", small: true))))

        let air = report.check("air-quality")
        let aqi = report.airQualityAQI
        cards.append(BriefCheckCard(
            title: "Air quality",
            status: aqi == nil ? .missing : (air?.ok ?? true) ? .ok : .over,
            word: aqi == nil ? "Unavailable" : report.airQualityCategory ?? "AQI \(aqi!)",
            caption: aqi == nil ? "No reading was returned. Missing data doesn’t mean conditions are clear." : air?.detail ?? "AQI \(aqi!).",
            chapter: .checks,
            visual: AnyView(aqi.map { BigValue(text: "AQI \($0)", small: true) })))
        return cards
    }
}

enum DangerScale {
    static func name(_ level: Int?) -> String {
        switch level {
        case 1: "Low"
        case 2: "Moderate"
        case 3: "Considerable"
        case 4: "High"
        case 5: "Extreme"
        default: "No rating"
        }
    }
}

/// Mini gust bars for the Weather card: gray-green within, orange over the limit.
struct GustBars: View {
    var hours: [Hour]
    var limit: Double

    var body: some View {
        Canvas { context, size in
            let values = hours.map { $0.gust ?? 0 }
            let top = max(limit * 1.5, values.max() ?? 0, 1)
            let slot = size.width / CGFloat(max(1, values.count))
            for (index, hour) in hours.enumerated() {
                let v = hour.gust ?? 0
                let height = CGFloat(v / top) * size.height
                let bar = CGRect(x: CGFloat(index) * slot + slot * 0.18, y: size.height - height, width: slot * 0.64, height: height)
                context.fill(Path(roundedRect: bar, cornerRadius: 2), with: .color(hour.isOver ? Palette.caution : Palette.within))
            }
            let y = size.height - CGFloat(limit / top) * size.height
            var rule = Path(); rule.move(to: CGPoint(x: 0, y: y)); rule.addLine(to: CGPoint(x: size.width, y: y))
            context.stroke(rule, with: .color(Palette.label), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
        .frame(height: 44)
        .padding(.top, 4)
        .accessibilityHidden(true)
    }
}

struct DangerChips: View {
    var rows: [(label: String, rating: Int?)]

    var body: some View {
        if rows.isEmpty { EmptyView() } else {
            HStack(spacing: 4) {
                ForEach(Array(rows.reversed().enumerated()), id: \.offset) { _, row in
                    VStack(spacing: 3) {
                        Text(row.rating.map(String.init) ?? "—")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color(hex: 0x18201C))
                            .frame(maxWidth: .infinity, minHeight: 18)
                            .background(Palette.danger(row.rating), in: RoundedRectangle(cornerRadius: 5))
                        Text(row.label.replacingOccurrences(of: " treeline", with: "")).font(.caption2).foregroundStyle(Palette.secondary)
                    }
                }
            }
            .padding(.top, 6)
        }
    }
}

struct SunArc: View {
    var sunrise: Int?
    var sunset: Int?
    var start: Int?

    var body: some View {
        Canvas { context, size in
            let ground = size.height - 8
            var line = Path(); line.move(to: CGPoint(x: 0, y: ground)); line.addLine(to: CGPoint(x: size.width, y: ground))
            context.stroke(line, with: .color(Palette.separator), lineWidth: 1)
            var arc = Path()
            arc.move(to: CGPoint(x: 8, y: ground))
            arc.addCurve(to: CGPoint(x: size.width - 8, y: ground), control1: CGPoint(x: size.width * 0.3, y: -8), control2: CGPoint(x: size.width * 0.7, y: -8))
            context.stroke(arc, with: .color(Palette.okFill), style: StrokeStyle(lineWidth: 2, dash: [2, 4]))
            if let sunrise, let sunset, let start {
                let t = CGFloat(max(0, min(1, Double(start - sunrise) / Double(max(1, sunset - sunrise)))))
                let x = 8 + t * (size.width - 16)
                let y = ground - sin(.pi * t) * (ground - 4)
                context.fill(Path(ellipseIn: CGRect(x: x - 5, y: y - 5, width: 10, height: 10)), with: .color(Color(hex: 0xF2B33D)))
            }
        }
        .frame(height: 40)
        .accessibilityHidden(true)
    }
}

/// Plain-text brief for sharing.
enum BriefText {
    static func summary(plan: Plan, report: Report) -> String {
        var lines = [
            "\(plan.objective.shortName) — \(report.level.label)",
            "\(DateText.short(plan.date)), \(DateText.clock(plan.start)) start, \(plan.travelHours) hours (\(plan.activityLabel))",
            report.headline,
        ]
        if let reason = report.reason, reason != report.headline { lines.append(reason) }
        lines.append(contentsOf: report.limitingChecks.dropFirst().map { "• \($0)" })
        lines.append("Planning evidence, not a guarantee of safety.")
        return lines.joined(separator: "\n")
    }
}
