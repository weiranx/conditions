import SwiftUI

extension Color {
    // Website-aligned application palette.
    static let webBackground = Color(red: 0.966, green: 0.973, blue: 0.966)
    static let webSurface = Color(red: 0.994, green: 0.996, blue: 0.993)
    static let webSurfaceSubtle = Color(red: 0.944, green: 0.955, blue: 0.945)
    static let webLine = Color(red: 0.855, green: 0.875, blue: 0.858)
    static let webLineStrong = Color(red: 0.72, green: 0.76, blue: 0.73)
    static let webInk = Color(red: 0.105, green: 0.125, blue: 0.11)
    static let webInkSecondary = Color(red: 0.34, green: 0.37, blue: 0.35)
    static let webInkTertiary = Color(red: 0.51, green: 0.54, blue: 0.52)
    static let webPine = Color(red: 0.23, green: 0.48, blue: 0.34)
    static let webPineDeep = Color(red: 0.115, green: 0.32, blue: 0.22)
    static let webPineSoft = Color(red: 0.91, green: 0.95, blue: 0.92)
    static let webHero = Color(red: 0.025, green: 0.105, blue: 0.08)

    // Accessible danger level colors — avoids raw .yellow/.green which wash out on light backgrounds
    static let dangerLevel0 = Color.gray
    static let dangerLevel1 = Color(red: 0.2, green: 0.65, blue: 0.32)       // accessible green
    static let dangerLevel2 = Color(red: 0.78, green: 0.58, blue: 0.05)      // accessible amber/yellow
    static let dangerLevel3 = Color(red: 0.9, green: 0.45, blue: 0.1)        // accessible orange
    static let dangerLevel4 = Color(red: 0.85, green: 0.18, blue: 0.18)      // accessible red
    static let dangerLevel5 = Color(red: 0.6, green: 0, blue: 0)             // dark red / extreme

    static func dangerLevel(_ level: Int) -> Color {
        switch level {
        case 0: return .dangerLevel0
        case 1: return .dangerLevel1
        case 2: return .dangerLevel2
        case 3: return .dangerLevel3
        case 4: return .dangerLevel4
        case 5: return .dangerLevel5
        default: return .dangerLevel0
        }
    }

    static func scoreColor(_ score: Double) -> Color {
        if score >= 80 { return Color(red: 0.2, green: 0.65, blue: 0.32) }    // green
        if score >= 60 { return Color(red: 0.78, green: 0.58, blue: 0.05) }   // amber
        if score >= 40 { return Color(red: 0.9, green: 0.45, blue: 0.1) }     // orange
        return Color(red: 0.85, green: 0.18, blue: 0.18)                       // red
    }

    // Semantic aliases for common use
    static let safeGreen = Color(red: 0.2, green: 0.65, blue: 0.32)
    static let cautionAmber = Color(red: 0.78, green: 0.58, blue: 0.05)
    static let warningOrange = Color(red: 0.9, green: 0.45, blue: 0.1)
    static let dangerRed = Color(red: 0.85, green: 0.18, blue: 0.18)
}

extension Font {
    static func webDisplay(_ size: CGFloat, weight: Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func webSans(_ size: CGFloat, weight: Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }

    static func webMono(_ size: CGFloat, weight: Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
