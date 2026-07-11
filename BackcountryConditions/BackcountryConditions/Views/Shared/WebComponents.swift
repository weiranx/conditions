import SwiftUI

struct WebBrandMark: View {
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: "mountain.2")
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [.webPine, .webPineDeep], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: size * 0.28)
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28)
                    .strokeBorder(.white.opacity(0.18), lineWidth: 1)
            )
            .shadow(color: Color.webPineDeep.opacity(0.2), radius: 10, y: 5)
    }
}

struct WebKicker: View {
    let text: String
    var systemImage: String = "location.north.circle"
    var inverse = false

    var body: some View {
        Label(text.uppercased(), systemImage: systemImage)
            .font(.webMono(10))
            .tracking(1.1)
            .foregroundStyle(inverse ? Color.white.opacity(0.82) : Color.webPineDeep)
    }
}

struct WebPageHeader<Trailing: View>: View {
    let kicker: String
    let title: String
    let subtitle: String
    var systemImage: String = "location.north.circle"
    @ViewBuilder var trailing: () -> Trailing

    init(
        kicker: String,
        title: String,
        subtitle: String,
        systemImage: String = "location.north.circle",
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.kicker = kicker
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.trailing = trailing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    WebKicker(text: kicker, systemImage: systemImage)
                    Text(title)
                        .font(.webDisplay(34, weight: .semibold))
                        .tracking(-1.1)
                        .foregroundStyle(Color.webInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.webSans(14))
                        .foregroundStyle(Color.webInkSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                trailing()
            }
        }
        .padding(20)
        .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.webLine, lineWidth: 1)
        )
        .shadow(color: Color.webPineDeep.opacity(0.05), radius: 18, y: 8)
    }
}

struct WebSectionHeader: View {
    let number: String?
    let title: String
    var subtitle: String?

    init(_ title: String, number: String? = nil, subtitle: String? = nil) {
        self.title = title
        self.number = number
        self.subtitle = subtitle
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let number {
                Text(number)
                    .font(.webMono(10))
                    .foregroundStyle(Color.webPineDeep)
                    .frame(width: 38, height: 38)
                    .background(Color.webPineSoft, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.webPine.opacity(0.22)))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.webSans(17, weight: .semibold))
                    .foregroundStyle(Color.webInk)
                if let subtitle {
                    Text(subtitle)
                        .font(.webSans(13))
                        .foregroundStyle(Color.webInkTertiary)
                        .lineSpacing(2)
                }
            }
            Spacer()
        }
    }
}

struct WebPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: ButtonStyleConfiguration) -> some View {
        configuration.label
            .font(.webSans(15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                LinearGradient(
                    colors: configuration.isPressed ? [.webPineDeep, .webPineDeep] : [.webPine, .webPineDeep],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .shadow(color: Color.webPineDeep.opacity(configuration.isPressed ? 0.08 : 0.2), radius: 10, y: 5)
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
    }
}

struct WebCardModifier: ViewModifier {
    var padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.webLine, lineWidth: 1))
            .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
    }
}

extension View {
    func webCard(padding: CGFloat = 16) -> some View {
        modifier(WebCardModifier(padding: padding))
    }

    func webPage() -> some View {
        background(Color.webBackground.ignoresSafeArea())
    }
}
