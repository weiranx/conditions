import SwiftUI

/// Avalanche aspect-elevation rose: 8 compass aspects x 3 elevation bands (ATL, NTL, BTL).
/// Active cells are highlighted when the avalanche problem location covers that aspect+elevation.
struct AspectElevationRose: View {
    let aspects: Set<TerrainAspect>
    let elevations: Set<ElevationBand>

    enum ElevationBand: String, CaseIterable, Sendable {
        case upper, middle, lower

        var abbreviation: String {
            switch self {
            case .upper: return "ATL"
            case .middle: return "NTL"
            case .lower: return "BTL"
            }
        }
    }

    private let aspectOrder = WindLoadingEngine.aspectOrder
    private let rings: [(band: ElevationBand, inner: CGFloat, outer: CGFloat)] = [
        (.upper, 12, 30),   // ATL — innermost
        (.middle, 30, 48),  // NTL
        (.lower, 48, 62),   // BTL — outermost
    ]
    private let labelRadius: CGFloat = 72

    private static let aspectSvgCenter: [TerrainAspect: Double] = [
        .N: -90, .NE: -45, .E: 0, .SE: 45,
        .S: 90, .SW: 135, .W: 180, .NW: 225,
    ]

    var body: some View {
        Canvas { context, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let scale = min(size.width, size.height) / 160

            let allAspects = aspects.isEmpty
            let allElevs = elevations.isEmpty

            // Sector cells: 3 rings x 8 aspects
            for ring in rings {
                let r1 = ring.inner * scale
                let r2 = ring.outer * scale
                for aspect in aspectOrder {
                    let centerDeg = Self.aspectSvgCenter[aspect] ?? 0
                    let active = (allAspects || aspects.contains(aspect)) &&
                                 (allElevs || elevations.contains(ring.band))
                    let path = sectorPath(cx: cx, cy: cy, r1: r1, r2: r2, centerDeg: centerDeg)
                    let fill: Color = active ? .warningOrange.opacity(0.45) : .gray.opacity(0.06)
                    context.fill(path, with: .color(fill))
                    context.stroke(path, with: .color(.gray.opacity(0.2)), lineWidth: 0.5)
                }
            }

            // Ring boundary circles
            for ring in rings {
                let r = ring.outer * scale
                let circle = Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
                context.stroke(circle, with: .color(.gray.opacity(0.25)), lineWidth: 0.5)
            }
            let coreR = 12 * scale
            let core = Path(ellipseIn: CGRect(x: cx - coreR, y: cy - coreR, width: coreR * 2, height: coreR * 2))
            context.stroke(core, with: .color(.gray.opacity(0.25)), lineWidth: 0.5)
            context.fill(core, with: .color(Color(.secondarySystemGroupedBackground)))

            // Spoke dividers
            let outerR = rings.last!.outer * scale
            let spokeAngles: [Double] = [-67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5]
            for deg in spokeAngles {
                let rad = deg * .pi / 180
                var spoke = Path()
                spoke.move(to: CGPoint(x: cx, y: cy))
                spoke.addLine(to: CGPoint(x: cx + outerR * cos(rad), y: cy + outerR * sin(rad)))
                context.stroke(spoke, with: .color(.gray.opacity(0.15)), lineWidth: 0.5)
            }

            // Compass labels
            let labelR = labelRadius * scale
            for aspect in aspectOrder {
                let deg = Self.aspectSvgCenter[aspect] ?? 0
                let rad = deg * .pi / 180
                context.draw(
                    Text(aspect.rawValue)
                        .font(.system(size: 9 * scale, weight: .medium))
                        .foregroundColor(.secondary),
                    at: CGPoint(x: cx + labelR * cos(rad), y: cy + labelR * sin(rad))
                )
            }

            // Elevation band labels (right side)
            for (idx, ring) in rings.enumerated() {
                let labelY = cy + CGFloat(idx - 1) * 15 * scale
                let dotX = cx + ring.outer * scale
                let active = allElevs || elevations.contains(ring.band)

                // Leader line
                var line = Path()
                line.move(to: CGPoint(x: dotX + 2 * scale, y: cy))
                line.addLine(to: CGPoint(x: cx + 78 * scale, y: labelY))
                context.stroke(line, with: .color(.gray.opacity(0.2)), lineWidth: 0.5)

                // Dot
                let dot = Path(ellipseIn: CGRect(x: dotX - 1.5 * scale, y: cy - 1.5 * scale, width: 3 * scale, height: 3 * scale))
                context.fill(dot, with: .color(.gray.opacity(0.4)))

                // Label
                context.draw(
                    Text(ring.band.abbreviation)
                        .font(.system(size: 8 * scale, weight: active ? .bold : .regular))
                        .foregroundColor(active ? .primary : .secondary),
                    at: CGPoint(x: cx + 86 * scale, y: labelY)
                )
            }
        }
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

// MARK: - Parsing helpers

extension AspectElevationRose {
    /// Parse avalanche problem locations into aspect + elevation sets.
    static func parseFromProblems(_ problems: [AvalancheProblem]) -> (aspects: Set<TerrainAspect>, elevations: Set<ElevationBand>) {
        var aspects = Set<TerrainAspect>()
        var elevations = Set<ElevationBand>()

        for problem in problems {
            let parsedAspects = WindLoadingEngine.parseAspectsFromLocation(problem.location)
            aspects.formUnion(parsedAspects)

            // Parse elevation bands
            if let location = problem.location {
                let texts: [String]
                switch location {
                case .array(let arr): texts = arr
                case .string(let str): texts = [str]
                case .dictionary: continue
                }
                for text in texts {
                    let lower = text.lowercased()
                    if lower.contains("above") || lower.contains("alpine") || lower.contains("atl") {
                        elevations.insert(.upper)
                    }
                    if lower.contains("near") || lower.contains("treeline") || lower.contains("ntl") {
                        elevations.insert(.middle)
                    }
                    if lower.contains("below") || lower.contains("btl") {
                        elevations.insert(.lower)
                    }
                }
            }
        }
        return (aspects, elevations)
    }
}
