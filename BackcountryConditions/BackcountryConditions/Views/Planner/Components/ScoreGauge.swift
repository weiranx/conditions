import SwiftUI

struct ScoreGauge: View {
    let score: Double
    var size: CGFloat = 100

    @State private var animatedProgress: Double = 0

    var body: some View {
        ZStack {
            // Background arc
            Circle()
                .trim(from: 0, to: 0.75)
                .stroke(.gray.opacity(0.12), style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(135))

            // Score arc with gradient
            Circle()
                .trim(from: 0, to: 0.75 * animatedProgress)
                .stroke(
                    AngularGradient(
                        colors: [scoreColor.opacity(0.6), scoreColor],
                        center: .center,
                        startAngle: .degrees(135),
                        endAngle: .degrees(135 + 270 * animatedProgress)
                    ),
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(135))
                .shadow(color: scoreColor.opacity(0.35), radius: 6, y: 2)

            // Score text
            VStack(spacing: -1) {
                Text("\(Int(score))")
                    .font(.system(size: size * 0.34, weight: .bold, design: .rounded))
                    .foregroundStyle(scoreColor)
                    .contentTransition(.numericText())
                Text("/ 100")
                    .font(.system(size: size * 0.11, weight: .medium, design: .rounded))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: size, height: size)
        .padding(8) // room for stroke width + shadow
        .drawingGroup()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Safety score")
        .accessibilityValue("\(Int(score)) out of 100")
        .onAppear {
            withAnimation(.easeOut(duration: 0.8).delay(0.15)) {
                animatedProgress = score / 100
            }
        }
        .onChange(of: score) { _, newValue in
            withAnimation(.easeOut(duration: 0.5)) {
                animatedProgress = newValue / 100
            }
        }
    }

    private var scoreColor: Color {
        Color.scoreColor(score)
    }
}
