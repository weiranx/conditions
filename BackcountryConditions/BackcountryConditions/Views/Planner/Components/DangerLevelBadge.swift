import SwiftUI

struct DangerLevelBadge: View {
    let level: Int
    var label: String?

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dangerColor)
                .frame(width: 10, height: 10)
                .shadow(color: dangerColor.opacity(0.4), radius: 2, y: 1)

            Text(label ?? dangerLabel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(dangerColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(dangerColor.opacity(0.1), in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(dangerColor.opacity(0.15), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Danger level: \(label ?? dangerLabel)")
    }

    private var dangerColor: Color {
        switch level {
        case 0: return .gray
        case 1: return .green
        case 2: return Color(red: 0.78, green: 0.58, blue: 0.05)
        case 3: return .orange
        case 4: return .red
        case 5: return Color(red: 0.65, green: 0.05, blue: 0.1)
        default: return .gray
        }
    }

    private var dangerLabel: String {
        switch level {
        case 0: return "No Rating"
        case 1: return "Low"
        case 2: return "Moderate"
        case 3: return "Considerable"
        case 4: return "High"
        case 5: return "Extreme"
        default: return "Unknown"
        }
    }
}
