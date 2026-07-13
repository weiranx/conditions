import SwiftUI
import UIKit

extension Color {
    private static func adaptive(
        light: (red: CGFloat, green: CGFloat, blue: CGFloat),
        dark: (red: CGFloat, green: CGFloat, blue: CGFloat)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let components = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: components.red,
                green: components.green,
                blue: components.blue,
                alpha: 1
            )
        })
    }

    // Website-aligned application palette. Each semantic token resolves against
    // the current appearance so foregrounds, cards, and controls keep their
    // contrast when iOS changes between light and dark mode.
    static let webBackground = adaptive(light: (0.966, 0.973, 0.966), dark: (0.055, 0.075, 0.065))
    static let webSurface = adaptive(light: (0.994, 0.996, 0.993), dark: (0.09, 0.118, 0.102))
    static let webSurfaceSubtle = adaptive(light: (0.944, 0.955, 0.945), dark: (0.126, 0.161, 0.137))
    static let webLine = adaptive(light: (0.855, 0.875, 0.858), dark: (0.204, 0.255, 0.224))
    static let webLineStrong = adaptive(light: (0.72, 0.76, 0.73), dark: (0.298, 0.357, 0.322))
    static let webInk = adaptive(light: (0.105, 0.125, 0.11), dark: (0.933, 0.957, 0.941))
    static let webInkSecondary = adaptive(light: (0.34, 0.37, 0.35), dark: (0.761, 0.8, 0.773))
    static let webInkTertiary = adaptive(light: (0.51, 0.54, 0.52), dark: (0.604, 0.655, 0.624))
    static let webPine = adaptive(light: (0.23, 0.48, 0.34), dark: (0.396, 0.722, 0.545))
    static let webPineDeep = adaptive(light: (0.115, 0.32, 0.22), dark: (0.561, 0.827, 0.667))
    static let webPineSoft = adaptive(light: (0.91, 0.95, 0.92), dark: (0.137, 0.231, 0.18))
    static let webHero = adaptive(light: (0.025, 0.105, 0.08), dark: (0.027, 0.102, 0.071))

    // Accessible danger level colors — avoids raw .yellow/.green which wash out on light backgrounds
    static let dangerLevel0 = Color.gray
    static let dangerLevel1 = adaptive(light: (0.2, 0.65, 0.32), dark: (0.39, 0.79, 0.47))
    static let dangerLevel2 = adaptive(light: (0.78, 0.58, 0.05), dark: (0.88, 0.72, 0.28))
    static let dangerLevel3 = adaptive(light: (0.9, 0.45, 0.1), dark: (0.94, 0.58, 0.28))
    static let dangerLevel4 = adaptive(light: (0.85, 0.18, 0.18), dark: (0.93, 0.4, 0.4))
    static let dangerLevel5 = adaptive(light: (0.6, 0, 0), dark: (0.85, 0.55, 0.55))

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
        if score >= 80 { return .dangerLevel1 }
        if score >= 60 { return .dangerLevel2 }
        if score >= 40 { return .dangerLevel3 }
        return .dangerLevel4
    }

    // Semantic aliases for common use
    static let safeGreen = dangerLevel1
    static let cautionAmber = dangerLevel2
    static let warningOrange = dangerLevel3
    static let dangerRed = dangerLevel4
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
