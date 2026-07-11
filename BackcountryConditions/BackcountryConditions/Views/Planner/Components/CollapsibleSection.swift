import SwiftUI

struct CollapsibleSection<Content: View>: View {
    let title: String
    var systemImage: String = "info.circle"
    var headerColor: Color = .primary
    var initiallyExpanded: Bool = true
    @State private var isExpanded: Bool
    @ViewBuilder var content: () -> Content

    init(
        title: String,
        systemImage: String = "info.circle",
        headerColor: Color = .primary,
        initiallyExpanded: Bool = true,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.headerColor = headerColor
        self.initiallyExpanded = initiallyExpanded
        self._isExpanded = State(initialValue: initiallyExpanded)
        self.content = content
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(headerColor)
                        .frame(width: 30, height: 30)
                        .background(headerColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(headerColor.opacity(0.16)))

                    Text(title)
                        .font(.webSans(15, weight: .semibold))
                        .foregroundStyle(Color.webInk)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.webInkTertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .accessibilityLabel(title)
            .accessibilityHint(isExpanded ? "Double tap to collapse" : "Double tap to expand")
            .accessibilityAddTraits(.isButton)

            if isExpanded {
                Divider().overlay(Color.webLine)
                    .padding(.horizontal, 14)

                content()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .move(edge: .top)).animation(.easeOut(duration: 0.25)),
                        removal: .opacity.animation(.easeIn(duration: 0.15))
                    ))
            }
        }
        .background(Color.webSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.webLine, lineWidth: 1)
        )
        .compositingGroup()
        .shadow(color: Color.webPineDeep.opacity(0.045), radius: 14, y: 7)
    }
}
