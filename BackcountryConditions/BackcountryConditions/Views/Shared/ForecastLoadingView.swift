import SwiftUI

struct ForecastLoadingView: View {
    @State private var isAnimating = false
    @State private var pulseScale = 0.95

    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                // Pulsing ring
                Circle()
                    .stroke(.blue.opacity(0.08), lineWidth: 3)
                    .frame(width: 64, height: 64)
                    .scaleEffect(pulseScale)

                // Spinning arc
                Circle()
                    .trim(from: 0, to: 0.35)
                    .stroke(
                        LinearGradient(
                            colors: [.blue, .blue.opacity(0.3)],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        style: StrokeStyle(lineWidth: 3.5, lineCap: .round)
                    )
                    .frame(width: 64, height: 64)
                    .rotationEffect(.degrees(isAnimating ? 360 : 0))

                Image(systemName: "mountain.2.fill")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue.opacity(0.7), .blue.opacity(0.4)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }

            VStack(spacing: 6) {
                Text("Loading conditions")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)

                Text("Fetching weather, avalanche, alerts, and more")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                isAnimating = true
            }
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                pulseScale = 1.08
            }
        }
    }
}
