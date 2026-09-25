import SwiftUI

/// What the New plan sheet starts from: blank, a place from search, or an existing plan to edit.
struct NewPlanDraft: Identifiable {
    var id = UUID()
    var objective: Place?
    var editing: Plan?
}

enum PlanKind: String, CaseIterable, Identifiable {
    case day = "Day trip"
    case multi = "Multi-day"
    var id: String { rawValue }
}

/// The New plan sheet, laid out as the web's plan form with native pickers and glass controls.
struct NewPlanSheet: View {
    @Environment(\.dismiss) private var dismiss
    var draft: NewPlanDraft
    var onSubmit: (Plan) -> Void

    @State private var kind: PlanKind = .day
    @State private var objective: Place?
    @State private var activity: Activity = .hiking
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var startTime = Calendar.current.date(bySettingHour: 7, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var hours = 8
    @State private var limits = Activity.hiking.defaultLimits
    @State private var stages: [StageDraft] = []
    @State private var picking: PlaceTarget?

    enum PlaceTarget: Identifiable, Hashable {
        case objective
        case stageEnd(Int)
        var id: String { "\(self)" }
    }

    struct StageDraft: Identifiable, Hashable {
        var id = UUID()
        var end: Place?
        var start = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: Date()) ?? Date()
        var hours = 7
    }

    var body: some View {
        NavigationStack {
            Page {
                PageHeader(title: draft.editing == nil ? "New plan" : "Edit plan", subtitle: "An objective, a start, and your limits.")
                Spacer().frame(height: 14)
                Picker("Plan type", selection: $kind) {
                    ForEach(PlanKind.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .disabled(draft.editing != nil)
                Spacer().frame(height: 14)
                objectiveCard.padding(.horizontal, 16)
                Spacer().frame(height: 14)
                activityChips
                Spacer().frame(height: 14)
                if kind == .day { whenCard.padding(.horizontal, 16) } else { tripCard.padding(.horizontal, 16) }
                Spacer().frame(height: 12)
                limitsCard.padding(.horizontal, 16)
                Spacer().frame(height: 90)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: submit) {
                    Label(kind == .day ? "Check conditions" : "Check trip", systemImage: "arrow.right")
                        .labelStyle(TrailingIconLabelStyle())
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.glassProminent).tint(Palette.prominent)
                .disabled(!canSubmit)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
            .sheet(item: $picking) { target in
                PlacePicker(title: target == .objective ? "Objective" : "End of the day") { place in
                    switch target {
                    case .objective: objective = place
                    case .stageEnd(let index): if stages.indices.contains(index) { stages[index].end = place }
                    }
                }
            }
        }
        .onAppear(perform: load)
        .onChange(of: activity) { _, value in limits = value.defaultLimits }
        .onChange(of: kind) { _, value in if value == .multi && stages.isEmpty { resizeStages(to: 3) } }
    }

    // MARK: Cards

    private var objectiveCard: some View {
        Card {
            CardHead(kind == .day ? "Objective" : "Trailhead")
            HStack(spacing: 12) {
                TopoThumb()
                VStack(alignment: .leading, spacing: 2) {
                    Text(objective?.shortName ?? "Choose a place").font(.headline).foregroundStyle(objective == nil ? Palette.secondary : Palette.label)
                    if let objective {
                        Text([objective.elevationFt.map(Format.feet), objective.region].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Palette.secondary).lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Button(objective == nil ? "Search" : "Change") { picking = .objective }
                    .buttonStyle(.glass).controlSize(.small)
            }
            .padding(.top, 4)
        }
    }

    private var activityChips: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Activity").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.secondary).padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                        ForEach(Activity.allCases) { item in
                            let on = item == activity
                            GlassChip(title: item.shortLabel, selected: on) { activity = item }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
            }
            .scrollEdgeEffectHidden(true, for: .all)
        }
    }

    private var whenCard: some View {
        Card(spacing: 8) {
            CardHead("When")
            HStack(spacing: 8) {
                FieldBox(label: "Date") {
                    DatePicker("Date", selection: $date, in: Date()..., displayedComponents: .date).labelsHidden()
                }
                FieldBox(label: "Start") {
                    DatePicker("Start", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden()
                }
            }
            Stepper(value: $hours, in: 1...24) {
                Text("Duration \(Text("· \(hours) hours").foregroundStyle(Palette.secondary))").font(.subheadline)
            }
            .padding(.top, 2)
        }
    }

    private var tripCard: some View {
        Card(spacing: 10) {
            CardHead("Days")
            HStack(spacing: 8) {
                FieldBox(label: "First day") {
                    DatePicker("First day", selection: $date, in: Date()..., displayedComponents: .date).labelsHidden()
                }
                Stepper(value: Binding(get: { stages.count }, set: resizeStages), in: 2...7) {
                    Text("\(stages.count) days").font(.subheadline.weight(.semibold))
                }
            }
            ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Day \(index + 1)").font(.subheadline.weight(.semibold))
                        Text(DateText.short(isoDate(Calendar.current.date(byAdding: .day, value: index, to: date) ?? date)))
                            .font(.subheadline).foregroundStyle(Palette.secondary)
                        Spacer()
                        Button(stage.end?.shortName ?? (index == stages.count - 1 ? "Back to trailhead" : "Choose camp")) { picking = .stageEnd(index) }
                            .buttonStyle(.glass).controlSize(.small).lineLimit(1)
                    }
                    HStack {
                        DatePicker("Start", selection: $stages[index].start, displayedComponents: .hourAndMinute)
                            .font(.footnote)
                        Stepper("\(stages[index].hours) h", value: $stages[index].hours, in: 1...16).font(.footnote).fixedSize()
                    }
                }
            }
            Caption("Each day ends at a camp; the last ends at the trailhead unless you pick another exit. Every day and night is checked, and the trip is only as good as its weakest one.")
        }
    }

    private var limitsCard: some View {
        Card(spacing: 8) {
            CardHead(title: "Your limits") {
                Text("\(activity.shortLabel) defaults").font(.footnote)
            }
            HStack(spacing: 8) {
                limitBox("Gusts", value: $limits.maxGustMph, range: 10...80, step: 5, unit: " mph")
                limitBox("Rain chance", value: $limits.maxPrecipChance, range: 0...100, step: 5, unit: "%")
                limitBox("Feels like", value: $limits.minFeelsLikeF, range: -40...60, step: 5, unit: "°F")
            }
            Caption("Hours past a limit are flagged in the brief. Gusts and rain are maximums; feels-like is the coldest you’ll accept.")
        }
    }

    private func limitBox(_ label: String, value: Binding<Int>, range: ClosedRange<Int>, step: Int, unit: String) -> some View {
        FieldBox(label: label) {
            Menu {
                ForEach(Array(stride(from: range.lowerBound, through: range.upperBound, by: step)), id: \.self) { option in
                    Button("\(option < 0 ? "−\(-option)" : "\(option)")\(unit)") { value.wrappedValue = option }
                }
            } label: {
                Text("\(value.wrappedValue < 0 ? "−\(-value.wrappedValue)" : "\(value.wrappedValue)")\(unit)")
                    .foregroundStyle(Palette.label)
            }
        }
    }

    // MARK: Logic

    private var canSubmit: Bool {
        guard objective != nil else { return false }
        if kind == .multi { return stages.count >= 2 && stages.dropLast().allSatisfy { $0.end != nil } }
        return true
    }

    private func resizeStages(to count: Int) {
        let clamped = max(2, min(7, count))
        if stages.count < clamped {
            stages.append(contentsOf: (stages.count..<clamped).map { _ in StageDraft() })
        } else {
            stages = Array(stages.prefix(clamped))
        }
    }

    private func clock(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    private func isoDate(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2026, parts.month ?? 1, parts.day ?? 1)
    }

    private func load() {
        if let plan = draft.editing {
            objective = plan.objective
            activity = plan.activity
            limits = plan.limits
            hours = plan.travelHours
            if let parsed = DateText.date(plan.date) {
                let utc = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: parsed)
                date = Calendar.current.date(from: DateComponents(year: utc.year, month: utc.month, day: utc.day)) ?? date
            }
            if let minutes = DateText.minutes(plan.start) {
                startTime = Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? startTime
            }
            if let planStages = plan.stages {
                kind = .multi
                stages = planStages.enumerated().map { index, stage in
                    let minutes = DateText.minutes(stage.start) ?? 480
                    return StageDraft(end: index == planStages.count - 1 && stage.to == plan.objective ? nil : stage.to,
                                      start: Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date(),
                                      hours: stage.travelHours)
                }
            }
            // Editing keeps the limits as they were, not the activity's defaults.
            DispatchQueue.main.async { limits = plan.limits }
        } else {
            objective = draft.objective
        }
    }

    private func submit() {
        guard let objective else { return }
        var plan = draft.editing ?? Plan(objective: objective, activity: activity, date: isoDate(date), start: clock(startTime),
                                          travelHours: hours, limits: limits)
        plan.objective = objective
        plan.activity = activity
        plan.date = isoDate(date)
        plan.limits = limits
        if kind == .multi {
            var from = objective
            plan.stages = stages.enumerated().map { index, draft in
                let to = draft.end ?? (index == stages.count - 1 ? objective : objective)
                defer { from = to }
                return Stage(start: clock(draft.start), travelHours: draft.hours, from: from, to: to)
            }
            plan.start = plan.stages?.first?.start ?? clock(startTime)
            plan.travelHours = plan.stages?.first?.travelHours ?? hours
        } else {
            plan.stages = nil
            plan.start = clock(startTime)
            plan.travelHours = hours
        }
        plan.isSample = false
        onSubmit(plan)
        dismiss()
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) { configuration.title; configuration.icon }
    }
}

/// A small contour tile standing in for a map preview.
struct TopoThumb: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Palette.dynamic(0xE4EADF, 0x1F2A24))
            ForEach([30.0, 24, 18, 12, 6], id: \.self) { r in
                Ellipse().stroke(Palette.dynamic(0xAEBFA8, 0x3F5A4C), lineWidth: 1).frame(width: r * 1.8, height: r * 1.4).offset(x: 2, y: 3)
            }
            Image(systemName: "mappin").font(.system(size: 18, weight: .bold)).foregroundStyle(Palette.accent).offset(y: -4)
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityHidden(true)
    }
}
