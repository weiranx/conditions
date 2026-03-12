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
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(
                            LinearGradient(
                                colors: [headerColor, headerColor.opacity(0.75)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            in: RoundedRectangle(cornerRadius: 8)
                        )

                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .accessibilityLabel(title)
            .accessibilityHint(isExpanded ? "Double tap to collapse" : "Double tap to expand")
            .accessibilityAddTraits(.isButton)

            if isExpanded {
                Divider()
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
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.quaternary.opacity(0.5), lineWidth: 0.5)
        )
        .compositingGroup()
        .shadow(color: .black.opacity(0.03), radius: 4, y: 1)
    }
}
