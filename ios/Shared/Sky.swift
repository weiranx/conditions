import SwiftUI

// Shared by the app and its widgets.

struct LevelTag: View {
    var level: DecisionLevel
    /// Replaces the level's word, e.g. "No trip verdict" for a trip checked day by day.
    var label: String?

    var body: some View {
        Label(label ?? level.label, systemImage: level.symbol)
            .labelStyle(TightLabelStyle())
            .font(.footnote.weight(.semibold))
            .foregroundStyle(level.tagColor)
            .fixedSize()
            .accessibilityLabel("Decision: \(label ?? level.label)")
    }
}

struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

// MARK: - Sky

/// The colour of one planned hour's sky, in the manner of the web's `sky-model.ts`.
enum SkyKind: String, Codable, Sendable {
    case night, predawn, dawn, morning, day, afternoon, dusk, rain, storm

    var colors: (Color, Color) {
        switch self {
        case .night: (Color(hex: 0x1B2745), Color(hex: 0x3A4A6C))
        case .predawn: (Color(hex: 0x2C3A60), Color(hex: 0x76718F))
        case .dawn: (Color(hex: 0x5B79A8), Color(hex: 0xE8C09C))
        case .morning: (Color(hex: 0x7DA0CB), Color(hex: 0xEAD8C3))
        case .day: (Color(hex: 0x6D99C9), Color(hex: 0xD4E3F1))
        case .afternoon: (Color(hex: 0x6B95C3), Color(hex: 0xE3E8EE))
        case .dusk: (Color(hex: 0x4A5A8A), Color(hex: 0xE3A98C))
        case .rain: (Color(hex: 0x7C8794), Color(hex: 0xC5CCD4))
        case .storm: (Color(hex: 0x5D6674), Color(hex: 0xA9B1BC))
        }
    }

    /// A deeper version for the hero, where white type sits on the sky.
    var hero: Color {
        switch self {
        case .night: Color(hex: 0x0D1526)
        case .predawn: Color(hex: 0x29304F)
        case .dawn: Color(hex: 0x634A66)
        case .morning: Color(hex: 0x76595D)
        case .day: Color(hex: 0x33628F)
        case .afternoon: Color(hex: 0x3A6690)
        case .dusk: Color(hex: 0x5A4466)
        case .rain: Color(hex: 0x3E4A58)
        case .storm: Color(hex: 0x2E3642)
        }
    }

    static func at(minute: Int, sunrise: Int?, sunset: Int?, condition: String?) -> SkyKind {
        let text = (condition ?? "").lowercased()
        if text.contains("thunder") || text.contains("storm") { return .storm }
        if text.contains("rain") || text.contains("snow") || text.contains("shower") || text.contains("drizzle") { return .rain }
        let m = ((minute % 1440) + 1440) % 1440
        let rise = sunrise ?? 390, set = sunset ?? 1170
        if m < rise - 90 || m > set + 60 { return .night }
        if m < rise - 20 { return .predawn }
        if m < rise + 50 { return .dawn }
        if m < rise + 150 { return .morning }
        if m > set - 40 { return .dusk }
        if m > 13 * 60 + 30 { return .afternoon }
        return .day
    }
}

struct SkyTile: Hashable, Codable, Sendable {
    var kind: SkyKind
    var over = false
    var missing = false
}

/// The web's DayStrip: a compact sky, one tile per hour (or per day and night on a trip).
struct DayStrip: View {
    var tiles: [SkyTile]
    var start: String?
    var end: String?
    var height: CGFloat = 28

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 2) {
                ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                    TileView(tile: tile, radius: height < 20 ? 3 : 5)
                }
            }
            .frame(height: height)
            if start != nil || end != nil {
                HStack {
                    Text(start ?? "")
                    Spacer()
                    Text(end ?? "")
                }
                .font(.caption2)
                .foregroundStyle(Palette.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        let over = tiles.filter(\.over).count
        let missing = tiles.filter(\.missing).count
        var parts = ["\(tiles.count) segments"]
        if over > 0 { parts.append("\(over) over your limits") }
        if missing > 0 { parts.append("\(missing) not checked") }
        return parts.joined(separator: ", ")
    }

    private struct TileView: View {
        var tile: SkyTile
        var radius: CGFloat

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: radius)
            if tile.missing {
                shape.strokeBorder(Palette.missing, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
                    .background(Hatch(color: Palette.fill, spacing: 6).clipShape(shape))
            } else {
                shape.fill(LinearGradient(colors: [tile.kind.colors.0, tile.kind.colors.1], startPoint: .top, endPoint: .bottom))
                    .overlay {
                        if tile.over {
                            Hatch(color: Palette.overHatch.opacity(0.95), spacing: 6).clipShape(shape)
                            shape.strokeBorder(Palette.caution, lineWidth: 1.5)
                        }
                    }
            }
        }
    }
}

/// Diagonal hatching, the web's marker for "over a limit".
struct Hatch: View {
    var color: Color
    var spacing: CGFloat = 6
    var lineWidth: CGFloat = 1.5

    var body: some View {
        Canvas { context, size in
            var path = Path()
            var x = -size.height
            while x < size.width + size.height {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += spacing
            }
            context.stroke(path, with: .color(color), lineWidth: lineWidth)
        }
        .allowsHitTesting(false)
    }
}
