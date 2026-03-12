import SwiftUI

extension Color {
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
