import SwiftUI

// The pieces every screen is built from, after the web app's sky components.

/// Survey contours and a faint glow behind each page title (the web's page backdrop).
struct TopoBackdrop: View {
    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: 380)
            .overlay(alignment: .topTrailing) {
                Image("Topo")
                    .resizable()
                    .renderingMode(.template)
                    .foregroundStyle(Palette.topo)
                    .frame(width: 1100, height: 440)
                    .offset(x: 420, y: -50)
            }
            .mask(RadialGradient(colors: [.black, .black.opacity(0.5), .clear], center: .topTrailing, startRadius: 30, endRadius: 440))
            .background(alignment: .topTrailing) {
                RadialGradient(colors: [Palette.glow, .clear], center: .topTrailing, startRadius: 0, endRadius: 360)
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// A scrolling page with the topo backdrop behind its header.
struct Page<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(alignment: .top) { TopoBackdrop().ignoresSafeArea() }
        .background(Palette.bg)
    }
}

struct PageHeader: View {
    var kicker: String?
    var title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let kicker {
                Text(kicker).font(.footnote.weight(.semibold)).foregroundStyle(Palette.secondary)
            }
            Text(title)
                .font(.display(38))
                .tracking(-0.6)
                .foregroundStyle(Palette.label)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle).font(.subheadline).foregroundStyle(Palette.secondary).padding(.top, 2)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The web's section head (`.sky-sh`): a serif heading and a quiet note or link.
struct SectionHead<Trailing: View>: View {
    var title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.display(25)).tracking(-0.4).foregroundStyle(Palette.label).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            trailing.font(.subheadline).foregroundStyle(Palette.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 10)
    }
}

extension SectionHead where Trailing == EmptyView {
    init(_ title: String) { self.init(title: title) { EmptyView() } }
}

/// The web's card (`.sky-card`). `missing` draws the dashed outline for evidence that didn't load.
struct Card<Content: View>: View {
    var missing = false
    var spacing: CGFloat = 6
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if missing {
                    RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.missing, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                } else {
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Palette.surface)
                        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
                        .shadow(color: .black.opacity(0.07), radius: 14, y: 8)
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.separator.opacity(0.6), lineWidth: 0.5))
                }
            }
    }
}

struct CardHead<Trailing: View>: View {
    var title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                Text(title).lineLimit(1)
                Spacer(minLength: 4)
                trailing
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                trailing
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Palette.secondary)
    }
}

extension CardHead where Trailing == EmptyView {
    init(_ title: String) { self.init(title: title) { EmptyView() } }
}

enum TagKind {
    case ok, over, stop, missing

    var symbol: String {
        switch self {
        case .ok: "checkmark"
        case .over: "exclamationmark.triangle"
        case .stop: "xmark.octagon"
        case .missing: "questionmark.circle"
        }
    }

    var color: Color {
        switch self {
        case .ok: Palette.secondary
        case .over: Palette.caution
        case .stop: Palette.stop
        case .missing: Palette.missing
        }
    }
}

/// The web's StatusTag: a symbol and a word, coloured only when it needs attention.
struct StatusTag: View {
    var kind: TagKind
    var text: String

    var body: some View {
        Label(text, systemImage: kind.symbol)
            .labelStyle(TightLabelStyle())
            .font(.footnote.weight(.semibold))
            .foregroundStyle(kind.color)
            .lineLimit(1)
            .fixedSize()
    }
}

/// The web's verdict pill (`.sky-pill`).
struct VerdictPill: View {
    var level: DecisionLevel
    var label: String?

    var body: some View {
        Label(label ?? level.label, systemImage: level.symbol)
            .labelStyle(TightLabelStyle())
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(level.color)
            .padding(.leading, 10)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .background(Palette.surface, in: Capsule())
            .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
            .accessibilityLabel("Decision: \(label ?? level.label)")
    }
}

struct Caption: View {
    var text: String
    var tone: Color = Palette.secondary
    var emphasized = false

    init(_ text: String, tone: Color = Palette.secondary, emphasized: Bool = false) {
        self.text = text
        self.tone = tone
        self.emphasized = emphasized
    }

    var body: some View {
        Text(text)
            .font(.footnote.weight(emphasized ? .semibold : .regular))
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct OpenLink: View {
    var label: String

    var body: some View {
        HStack(spacing: 2) {
            Text("Open \(label)")
            Image(systemName: "chevron.right").imageScale(.small)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Palette.accent)
        .padding(.top, 6)
    }
}

struct BigValue: View {
    var text: String
    var over = false
    var small = false

    var body: some View {
        Text(text)
            .font(.system(size: small ? 22 : 30, weight: .bold))
            .tracking(small ? -0.4 : -0.8)
            .monospacedDigit()
            .foregroundStyle(over ? Palette.caution : Palette.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// A labelled value in a field box, as the web's plan form draws its fields.
struct FieldBox<Value: View>: View {
    var label: String
    @ViewBuilder var value: Value

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
            value.font(.callout.weight(.semibold)).foregroundStyle(Palette.label)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.field, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.fieldBorder, lineWidth: 1))
    }
}

/// A notice above a report: saved snapshot, partial data, or an error.
struct Notice: View {
    enum Tone { case info, caution, missing }
    var tone: Tone
    var text: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .info ? "book" : tone == .caution ? "exclamationmark.triangle" : "questionmark.circle")
                .foregroundStyle(tone == .caution ? Palette.caution : Palette.secondary)
            VStack(alignment: .leading, spacing: 8) {
                Text(text).font(.footnote).foregroundStyle(Palette.label).fixedSize(horizontal: false, vertical: true)
                if let actionTitle, let action {
                    Button(actionTitle, action: action).buttonStyle(.glass).controlSize(.small)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(tone == .caution ? Palette.cautionFill : Palette.fill, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
    }
}

// MARK: - Sky

extension Report {
    /// One sky tile per planned hour, marked where the backend found the hour over a limit.
    var skyTiles: [SkyTile] {
        hours.map { hour in
            SkyTile(kind: .at(minute: hour.minutes, sunrise: sunriseMinutes, sunset: sunsetMinutes, condition: hour.condition),
                    over: hour.isOver, missing: hour.isMissing)
        }
    }

    /// The first run of hours the backend found over a limit, e.g. "Outside your limits · 4 AM–8 AM".
    var outsideLimitsSummary: String? {
        let hours = self.hours
        guard let start = hours.firstIndex(where: \.isOver) else { return nil }
        var end = start
        while end + 1 < hours.count, hours[end + 1].isOver { end += 1 }
        return "Outside your limits · \(hours[start].shortLabel)–\(Hour.shortLabel(minutes: hours[end].minutes + 60))"
    }

    var stripLabels: (String, String)? {
        guard let first = hours.first, let last = hours.last else { return nil }
        return (DateText.clock(first.clock), DateText.clock(minutes: last.minutes + 60))
    }
}

/// Where a value sits against one limit (the web's LimitScale): the out-of-limit side is shaded.
struct LimitScale: View {
    enum Side { case above, below }
    var value: Double
    var limit: Double
    var side: Side
    var range: ClosedRange<Double>

    var body: some View {
        Canvas { context, size in
            let w = size.width
            func x(_ v: Double) -> CGFloat { CGFloat(max(0, min(1, (v - range.lowerBound) / (range.upperBound - range.lowerBound)))) * w }
            let track = CGRect(x: 0, y: 7, width: w, height: 8)
            context.fill(Path(roundedRect: track, cornerRadius: 4), with: .color(Palette.fill))
            let shade = side == .above ? CGRect(x: x(limit), y: 7, width: w - x(limit), height: 8) : CGRect(x: 0, y: 7, width: x(limit), height: 8)
            context.fill(Path(shade), with: .color(Palette.caution.opacity(0.22)))
            var tick = Path()
            tick.move(to: CGPoint(x: x(limit), y: 2))
            tick.addLine(to: CGPoint(x: x(limit), y: 20))
            context.stroke(tick, with: .color(Palette.label), lineWidth: 1.5)
            let over = side == .above ? value > limit : value < limit
            let dot = CGRect(x: x(value) - 6, y: 5, width: 12, height: 12)
            context.fill(Path(ellipseIn: dot), with: .color(over ? Palette.caution : Palette.secondary))
            context.stroke(Path(ellipseIn: dot), with: .color(Palette.surface), lineWidth: 2)
        }
        .frame(height: 22)
        .accessibilityHidden(true)
    }
}

/// Report chapters as glass chips; the open one is tinted.
enum Chapter: String, CaseIterable, Identifiable {
    case weather = "Weather"
    case terrain = "Terrain & snow"
    case timing = "Timing"
    case checks = "Checks & sources"
    case gear = "Gear"

    var id: String { rawValue }

    var shortName: String {
        switch self {
        case .terrain: "Terrain"
        case .checks: "Checks"
        default: rawValue
        }
    }

    var symbol: String {
        switch self {
        case .weather: "sunrise"
        case .terrain: "mountain.2"
        case .timing: "clock"
        case .checks: "checkmark.shield"
        case .gear: "backpack"
        }
    }
}

/// A capsule chip in Liquid Glass; the chosen one is tinted glass.
struct GlassChip: View {
    var title: String
    var selected: Bool
    var action: () -> Void

    var body: some View {
        Group {
            if selected {
                Button(title, action: action).buttonStyle(.glassProminent).tint(Palette.prominent)
            } else {
                Button(title, action: action).buttonStyle(.glass).tint(Palette.label)
            }
        }
        .font(.subheadline.weight(.semibold))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ChapterChips: View {
    @Binding var selection: Chapter

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Chapter.allCases) { chapter in
                        let on = chapter == selection
                        GlassChip(title: chapter.rawValue, selected: on) { withAnimation(.snappy) { selection = chapter } }
                            .id(chapter)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .scrollEdgeEffectHidden(true, for: .all)
            // Keep the open chapter's chip in view, including when a brief card opens a later chapter.
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
            .onChange(of: selection) { withAnimation(.snappy) { proxy.scrollTo(selection, anchor: .center) } }
        }
    }
}

/// A plan, day, night or watch: the same card everywhere.
struct ItemCard<Footer: View>: View {
    var title: String
    var level: DecisionLevel?
    var meta: String?
    var tiles: [SkyTile] = []
    var stripStart: String?
    var stripEnd: String?
    var caption: String?
    var captionTone: Color = Palette.secondary
    var captionEmphasized = false
    var levelLabel: String?
    @ViewBuilder var footer: Footer

    var body: some View {
        Card(spacing: 4) {
            HStack(spacing: 10) {
                Text(title).font(.headline).foregroundStyle(Palette.label).lineLimit(1)
                Spacer(minLength: 6)
                if let level { LevelTag(level: level, label: levelLabel) }
            }
            if let meta { Text(meta).font(.subheadline).foregroundStyle(Palette.secondary) }
            if !tiles.isEmpty {
                DayStrip(tiles: tiles, start: stripStart, end: stripEnd).padding(.vertical, 6)
            }
            if let caption { Caption(caption, tone: captionTone, emphasized: captionEmphasized).lineLimit(3) }
            footer
        }
    }
}

extension ItemCard where Footer == EmptyView {
    init(title: String, level: DecisionLevel?, meta: String?, tiles: [SkyTile] = [], stripStart: String? = nil, stripEnd: String? = nil,
         caption: String? = nil, captionTone: Color = Palette.secondary, captionEmphasized: Bool = false, levelLabel: String? = nil) {
        self.init(title: title, level: level, meta: meta, tiles: tiles, stripStart: stripStart, stripEnd: stripEnd,
                  caption: caption, captionTone: captionTone, captionEmphasized: captionEmphasized, levelLabel: levelLabel) { EmptyView() }
    }
}
