import SwiftUI
import WidgetKit

@main
struct ConditionsWidgets: WidgetBundle {
    var body: some Widget {
        NextPlanWidget()
    }
}

/// The next upcoming plan: its decision, its sky and what limits it. The app writes the
/// snapshot each time it checks a plan, so the widget never asks the server itself.
struct NextPlanWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshot.widgetKind, provider: NextPlanProvider()) { entry in
            NextPlanView(entry: entry)
                .containerBackground(Palette.surface, for: .widget)
        }
        .configurationDisplayName("Next plan")
        .description("Your next plan’s decision and its hours against your limits.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct NextPlanEntry: TimelineEntry {
    var date: Date
    var plan: WidgetPlan?
    var more: Int
}

struct NextPlanProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextPlanEntry {
        NextPlanEntry(date: .now, plan: .sample, more: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (NextPlanEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextPlanEntry>) -> Void) {
        // The app reloads the widget whenever it checks a plan; the hourly refresh only
        // keeps "checked … ago" honest.
        completion(Timeline(entries: [entry()], policy: .after(.now.addingTimeInterval(3600))))
    }

    private func entry() -> NextPlanEntry {
        let plans = WidgetSnapshot.load()?.plans ?? []
        return NextPlanEntry(date: .now, plan: plans.first, more: max(0, plans.count - 1))
    }
}

struct NextPlanView: View {
    @Environment(\.widgetFamily) private var family
    var entry: NextPlanEntry

    var body: some View {
        if let plan = entry.plan {
            content(plan).widgetURL(DeepLink.plan(plan.id))
        } else {
            empty
        }
    }

    @ViewBuilder
    private func content(_ plan: WidgetPlan) -> some View {
        switch family {
        case .systemMedium: medium(plan)
        case .accessoryRectangular: rectangular(plan)
        case .accessoryInline: Text("\(plan.name): \(plan.levelText)")
        default: small(plan)
        }
    }

    private func small(_ plan: WidgetPlan) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(plan.name).font(.display(19)).foregroundStyle(Palette.label).lineLimit(2).minimumScaleFactor(0.8)
            Text(plan.when).font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
            Spacer(minLength: 4)
            LevelTag(level: plan.level, label: plan.levelLabel)
            if let line = plan.line {
                Text(line).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
            }
            if !plan.tiles.isEmpty {
                DayStrip(tiles: plan.tiles, height: 12).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func medium(_ plan: WidgetPlan) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(plan.name).font(.display(22)).foregroundStyle(Palette.label).lineLimit(1)
                    Text(plan.when).font(.footnote).foregroundStyle(Palette.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                LevelTag(level: plan.level, label: plan.levelLabel)
            }
            Spacer(minLength: 0)
            if !plan.tiles.isEmpty {
                DayStrip(tiles: plan.tiles, start: plan.stripStart, end: plan.stripEnd, height: 26)
            }
            if let line = plan.line {
                let attention = plan.level == .caution || plan.level == .noGo
                Text(line).font(.footnote.weight(attention ? .semibold : .regular))
                    .foregroundStyle(attention ? Palette.caution : Palette.secondary).lineLimit(1)
            } else if entry.more > 0 {
                Text("\(entry.more) more upcoming").font(.footnote).foregroundStyle(Palette.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func rectangular(_ plan: WidgetPlan) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(plan.name).font(.headline).lineLimit(1)
            Label(plan.levelText, systemImage: plan.level.symbol).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(plan.line ?? plan.when).font(.caption).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var empty: some View {
        switch family {
        case .accessoryInline: Text("No upcoming plans")
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Text("Conditions").font(.headline)
                Text("No upcoming plans").font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text("No upcoming plans").font(.display(19)).foregroundStyle(Palette.label)
                Text("Plan an objective in Conditions to see its decision here.")
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

extension WidgetPlan {
    /// Shown while the widget gallery loads, never as real conditions.
    static let sample = WidgetPlan(
        id: UUID(), name: "Mount Shasta", when: "Sat · 3:00 AM", level: .caution, levelLabel: nil,
        line: "Outside your limits · 4 AM–8 AM",
        tiles: [.init(kind: .night), .init(kind: .predawn, over: true), .init(kind: .predawn, over: true), .init(kind: .dawn, over: true),
                .init(kind: .dawn, over: true), .init(kind: .morning), .init(kind: .morning), .init(kind: .day), .init(kind: .day)],
        stripStart: "3 AM", stripEnd: "Noon", checkedAt: nil, watched: true)
}

#Preview(as: .systemMedium) {
    NextPlanWidget()
} timeline: {
    NextPlanEntry(date: .now, plan: .sample, more: 2)
}
