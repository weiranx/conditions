import SwiftUI

struct WindLoadingCard: View {
    let data: SafetyData

    private var result: WindLoadingResult {
        WindLoadingEngine.evaluate(data: data)
    }

    var body: some View {
        CollapsibleSection(
            title: "Wind Loading",
            systemImage: "wind",
            headerColor: headerColor,
            initiallyExpanded: result.level != .minimal
        ) {
            VStack(alignment: .leading, spacing: 12) {
                levelBadge
                if result.isCalm {
                    calmMessage
                } else {
                    roseAndAspects
                }
                overlapAlert
            }
        }
    }

    // MARK: - Level Badge

    private var levelBadge: some View {
        HStack(spacing: 10) {
            Text(result.level.rawValue)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(levelColor, in: Capsule())

            Text(result.confidence.rawValue + " confidence")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            if result.transportHours > 0 {
                Text("\(result.transportHours)h transport")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Calm Message

    private var calmMessage: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(.green)
                .font(.system(size: 14))
                .padding(.top, 1)
            Text("Wind direction is calm or variable — broad lee-aspect loading is unlikely, but small drift pockets can still form near terrain features.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Rose and Aspects

    private var roseAndAspects: some View {
        HStack(alignment: .top, spacing: 14) {
            AspectRose(
                primaryAspects: Set(result.primaryAspects),
                secondaryAspects: Set(result.secondaryAspects),
                windFromDeg: result.windFromDeg
            )
            .frame(width: 140, height: 140)

            VStack(alignment: .leading, spacing: 10) {
                if !result.primaryAspects.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Primary loading")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        HStack(spacing: 4) {
                            ForEach(result.primaryAspects, id: \.self) { aspect in
                                Text(aspect.rawValue)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Color.warningOrange.opacity(0.85), in: Capsule())
                            }
                        }
                    }
                }

                if !result.secondaryAspects.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Cross-loading")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        HStack(spacing: 4) {
                            ForEach(result.secondaryAspects, id: \.self) { aspect in
                                Text(aspect.rawValue)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Color.cautionAmber.opacity(0.7), in: Capsule())
                            }
                        }
                    }
                }

                if let dir = data.weather.windDirection {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down")
                            .font(.caption2)
                            .rotationEffect(windArrowRotation)
                        Text("from \(dir)")
                            .font(.caption)
                    }
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Overlap Alert

    @ViewBuilder
    private var overlapAlert: some View {
        if !result.windSlabOverlapNames.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.system(size: 14))
                    .padding(.top, 1)
                Text("Wind Slab problem reported on primary loading aspects — evaluate carefully before committing to leeward terrain.")
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .background(.orange.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(.orange.opacity(0.15), lineWidth: 0.5)
            )
        }
    }

    // MARK: - Helpers

    private var headerColor: Color {
        switch result.level {
        case .minimal: return .gray
        case .localized: return .cautionAmber
        case .active: return .warningOrange
        case .severe: return .dangerRed
        }
    }

    private var levelColor: Color {
        switch result.level {
        case .minimal: return .safeGreen
        case .localized: return .cautionAmber
        case .active: return .warningOrange
        case .severe: return .dangerRed
        }
    }

    private var windArrowRotation: Angle {
        guard let deg = result.windFromDeg else { return .zero }
        return .degrees(deg)
    }
}

// MARK: - Aspect Rose

private struct AspectRose: View {
    let primaryAspects: Set<TerrainAspect>
    let secondaryAspects: Set<TerrainAspect>
    let windFromDeg: Double?

    private let aspects = WindLoadingEngine.aspectOrder
    private let rings: [(inner: CGFloat, outer: CGFloat)] = [
        (12, 30), (30, 48), (48, 62),
    ]
    private let labelRadius: CGFloat = 72
    private let arrowRadius: CGFloat = 44

    var body: some View {
        Canvas { context, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let scale = min(size.width, size.height) / 160

            // Sector cells
            for ring in rings {
                let r1 = ring.inner * scale
                let r2 = ring.outer * scale
                for aspect in aspects {
                    let centerDeg = aspectSvgCenter(aspect)
                    let path = sectorPath(cx: cx, cy: cy, r1: r1, r2: r2, centerDeg: centerDeg)
                    let fill: Color
                    if primaryAspects.contains(aspect) {
                        fill = Color.warningOrange.opacity(0.5)
                    } else if secondaryAspects.contains(aspect) {
                        fill = Color.cautionAmber.opacity(0.3)
                    } else {
                        fill = Color.gray.opacity(0.08)
                    }
                    context.fill(path, with: .color(fill))
                    context.stroke(path, with: .color(.gray.opacity(0.2)), lineWidth: 0.5)
                }
            }

            // Ring boundary circles
            for ring in rings {
                let r = ring.outer * scale
                let circlePath = Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
                context.stroke(circlePath, with: .color(.gray.opacity(0.25)), lineWidth: 0.5)
            }
            let coreR = 12 * scale
            let corePath = Path(ellipseIn: CGRect(x: cx - coreR, y: cy - coreR, width: coreR * 2, height: coreR * 2))
            context.stroke(corePath, with: .color(.gray.opacity(0.25)), lineWidth: 0.5)
            context.fill(corePath, with: .color(Color(.secondarySystemGroupedBackground)))

            // Spoke dividers
            let spokeAngles: [Double] = [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5]
            let outerR = rings.last!.outer * scale
            for deg in spokeAngles {
                let rad = deg * .pi / 180
                var spokePath = Path()
                spokePath.move(to: CGPoint(x: cx, y: cy))
                spokePath.addLine(to: CGPoint(x: cx + outerR * cos(rad), y: cy + outerR * sin(rad)))
                context.stroke(spokePath, with: .color(.gray.opacity(0.15)), lineWidth: 0.5)
            }

            // Wind arrow
            if let windDeg = windFromDeg {
                let svgDeg = windDeg - 90
                let rad = svgDeg * .pi / 180
                let arrowR = arrowRadius * scale
                let tipX = cx + arrowR * cos(rad)
                let tipY = cy + arrowR * sin(rad)
                let tailR: CGFloat = 6 * scale
                let tailX = cx - tailR * cos(rad)
                let tailY = cy - tailR * sin(rad)

                var arrowLine = Path()
                arrowLine.move(to: CGPoint(x: tailX, y: tailY))
                arrowLine.addLine(to: CGPoint(x: tipX, y: tipY))
                context.stroke(arrowLine, with: .color(.blue.opacity(0.7)), lineWidth: 2 * scale)

                let headAngle = 28 * Double.pi / 180
                let headLen: CGFloat = 8 * scale
                let backRad = rad + .pi
                let leftX = tipX + headLen * cos(backRad - headAngle)
                let leftY = tipY + headLen * sin(backRad - headAngle)
                let rightX = tipX + headLen * cos(backRad + headAngle)
                let rightY = tipY + headLen * sin(backRad + headAngle)

                var arrowHead = Path()
                arrowHead.move(to: CGPoint(x: tipX, y: tipY))
                arrowHead.addLine(to: CGPoint(x: leftX, y: leftY))
                arrowHead.addLine(to: CGPoint(x: rightX, y: rightY))
                arrowHead.closeSubpath()
                context.fill(arrowHead, with: .color(.blue.opacity(0.7)))
            }

            // Compass labels
            let labelR = labelRadius * scale
            for aspect in aspects {
                let deg = aspectSvgCenter(aspect)
                let rad = deg * .pi / 180
                let x = cx + labelR * cos(rad)
                let y = cy + labelR * sin(rad)
                context.draw(
                    Text(aspect.rawValue)
                        .font(.system(size: 9 * scale, weight: .medium))
                        .foregroundColor(.secondary),
                    at: CGPoint(x: x, y: y)
                )
            }
        }
    }

    private func aspectSvgCenter(_ aspect: TerrainAspect) -> Double {
        let map: [TerrainAspect: Double] = [
            .N: -90, .NE: -45, .E: 0, .SE: 45,
            .S: 90, .SW: 135, .W: 180, .NW: 225,
        ]
        return map[aspect] ?? 0
    }

    private func sectorPath(cx: CGFloat, cy: CGFloat, r1: CGFloat, r2: CGFloat, centerDeg: Double) -> Path {
        let halfSpan = 22.5
        let startDeg = centerDeg - halfSpan
        let endDeg = centerDeg + halfSpan
        let startRad = startDeg * .pi / 180
        let endRad = endDeg * .pi / 180

        var path = Path()
        path.move(to: CGPoint(x: cx + r2 * cos(startRad), y: cy + r2 * sin(startRad)))
        path.addArc(center: CGPoint(x: cx, y: cy), radius: r2,
                     startAngle: .degrees(startDeg), endAngle: .degrees(endDeg), clockwise: false)
        path.addLine(to: CGPoint(x: cx + r1 * cos(endRad), y: cy + r1 * sin(endRad)))
        path.addArc(center: CGPoint(x: cx, y: cy), radius: r1,
                     startAngle: .degrees(endDeg), endAngle: .degrees(startDeg), clockwise: true)
        path.closeSubpath()
        return path
    }
}
