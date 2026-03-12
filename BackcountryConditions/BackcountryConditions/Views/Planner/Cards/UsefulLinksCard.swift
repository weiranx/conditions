import SwiftUI

struct UsefulLinksCard: View {
    let lat: Double
    let lon: Double

    private var links: [(name: String, icon: String, color: Color, subtitle: String, urlString: String)] {
        [
            ("Windy", "wind", .blue, "Weather radar & wind map",
             "https://www.windy.com/\(lat)/\(lon)?temp,\(lat),\(lon),12"),
            ("Gaia GPS", "map.fill", .green, "Topo maps & route planning",
             "https://www.gaiagps.com/map/?layer=GaiaTopoRasterFeet&lat=\(lat)&lon=\(lon)&zoom=14"),
            ("CalTopo", "mountain.2.fill", .orange, "Slope angle & terrain analysis",
             "https://caltopo.com/map.html#ll=\(lat),\(lon)&z=14&b=mbt"),
            ("NWS Forecast", "cloud.sun.fill", .cyan, "Official NOAA point forecast",
             "https://forecast.weather.gov/MapClick.php?lat=\(lat)&lon=\(lon)")
        ]
    }

    var body: some View {
        CollapsibleSection(title: "Useful Links", systemImage: "link", initiallyExpanded: false) {
            VStack(spacing: 0) {
                ForEach(Array(links.enumerated()), id: \.offset) { index, link in
                    if let url = URL(string: link.urlString) {
                        if index > 0 {
                            Divider().padding(.horizontal, 10)
                        }
                        linkRow(name: link.name, icon: link.icon, color: link.color, subtitle: link.subtitle, url: url)
                    }
                }
            }
            .background(.quaternary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func linkRow(name: String, icon: String, color: Color, subtitle: String, url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(
                        LinearGradient(
                            colors: [color, color.opacity(0.75)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 8)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
        }
    }
}
