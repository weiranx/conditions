import SwiftUI
import UIKit

/// The web app's sky tokens (`frontend/src/field/sky/tokens.css`), light and dark.
enum Palette {
    static let bg = dynamic(0xF2F3F1, 0x0F1211)
    static let surface = dynamic(0xFFFFFF, 0x1B1F1D)
    static let fill = dynamic(0xE7E9E6, 0x262B29)
    static let field = dynamic(0xF7F8F6, 0x131715)
    static let fieldBorder = dynamic(0x18201C, 0xECEFED, lightAlpha: 0.13, darkAlpha: 0.12)
    static let separator = dynamic(0x18201C, 0xECEFED, lightAlpha: 0.12, darkAlpha: 0.12)
    static let label = dynamic(0x18201C, 0xECEEED)
    static let secondary = dynamic(0x58615C, 0xA3ADA8)
    static let accent = dynamic(0x1E5A43, 0x7FC8A4)
    static let onAccent = dynamic(0xFFFFFF, 0x0F1211)
    /// Fill for prominent glass buttons: deep enough in dark mode for their white labels.
    static let prominent = dynamic(0x1E5A43, 0x2E7D5B)
    static let caution = dynamic(0xA8470A, 0xFF9A4D)
    static let cautionFill = dynamic(0xA8470A, 0xFF9A4D, lightAlpha: 0.14, darkAlpha: 0.18)
    static let stop = dynamic(0x9E2F22, 0xF2A39B)
    static let cold = dynamic(0x1A64A8, 0x72B4F0)
    static let missing = dynamic(0x5C6360, 0xA7AFAB)
    static let within = dynamic(0xADC6B7, 0x44685A)
    static let okFill = dynamic(0xD5DAD6, 0x343A37)
    static let topo = dynamic(0x1E5A43, 0x7FC8A4, lightAlpha: 0.16, darkAlpha: 0.1)
    static let glow = dynamic(0x1E5A43, 0x7FC8A4, lightAlpha: 0.08, darkAlpha: 0.06)
    static let overHatch = Color(red: 1, green: 154 / 255, blue: 77 / 255)

    /// North American avalanche danger scale colours.
    static func danger(_ level: Int?) -> Color {
        switch level {
        case 1: Color(hex: 0x50B848)
        case 2: Color(hex: 0xFFF300)
        case 3: Color(hex: 0xF7941E)
        case 4: Color(hex: 0xED1C24)
        case 5: Color(hex: 0x231F20)
        default: Color.gray.opacity(0.3)
        }
    }

    /// SwiftUI resolves colours on its async render thread, so the provider must not be main-actor isolated
    /// (the target's default), or Swift 6's runtime isolation check traps there.
    nonisolated static func dynamic(_ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { @Sendable traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

extension UIColor {
    nonisolated convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

extension Font {
    /// Page titles and section headings only, as the web uses Newsreader: Apple's New York serif.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .medium, design: .serif) }
}

extension DecisionLevel {
    var color: Color {
        switch self {
        case .go: Palette.accent
        case .caution: Palette.caution
        case .noGo: Palette.stop
        case .unknown: Palette.missing
        }
    }

    var symbol: String {
        switch self {
        case .go: "checkmark"
        case .caution: "exclamationmark.triangle"
        case .noGo: "xmark.octagon"
        case .unknown: "questionmark.circle"
        }
    }

    /// Tags stay quiet for Go, as the web's `.sky-status.is-ok` does.
    var tagColor: Color { self == .go ? Palette.secondary : color }
}
