import SwiftUI

struct StatusView: View {
    @State private var statusVM = StatusViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WebPageHeader(
                    kicker: "Live operations",
                    title: "System status",
                    subtitle: "A direct health check across the services that power every mountain brief.",
                    systemImage: "waveform.path.ecg"
                )

                Button { Task { await statusVM.loadHealth() } } label: {
                    Label(statusVM.isLoading ? "Checking services…" : "Refresh status", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(WebPrimaryButtonStyle())
                .disabled(statusVM.isLoading)

                if statusVM.isLoading && statusVM.healthResponse == nil {
                    HStack(spacing: 12) { ProgressView(); Text("Checking backend health…").font(.webSans(13)) }
                        .foregroundStyle(Color.webInkSecondary)
                        .webCard()
                }

                if let error = statusVM.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.webSans(13)).foregroundStyle(.red).webCard()
                }

                if let health = statusVM.healthResponse {
                    statusOverview(health)
                    serverCard(health)
                    if let checks = health.checks, !checks.isEmpty { servicesCard(checks) }
                }

                VStack(alignment: .leading, spacing: 6) {
                    WebKicker(text: "Connection")
                    Text(shortenedURL(Configuration.apiBaseURL)).font(.webMono(10)).foregroundStyle(Color.webInkSecondary)
                }
                .webCard()
            }
            .padding(16)
        }
        .background(Color.webBackground)
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await statusVM.loadHealth() }
        .task { await statusVM.loadHealth() }
    }

    private func statusOverview(_ health: HealthCheckResponse) -> some View {
        HStack(spacing: 14) {
            Image(systemName: health.status == "ok" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.system(size: 30)).foregroundStyle(health.status == "ok" ? .green : .orange)
            VStack(alignment: .leading, spacing: 4) {
                WebKicker(text: health.status == "ok" ? "Operational" : "Degraded")
                Text(health.status == "ok" ? "All systems operational" : "Degraded performance")
                    .font(.webDisplay(22, weight: .semibold)).foregroundStyle(Color.webInk)
                if let version = health.version { Text("Application v\(version)").font(.webMono(9)).foregroundStyle(Color.webInkTertiary) }
            }
            Spacer()
        }
        .webCard(padding: 18)
    }

    private func serverCard(_ health: HealthCheckResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            WebSectionHeader("Server", number: "01", subtitle: "Runtime health and response performance.")
            if let env = health.env { metricRow("Environment", env.capitalized) }
            if let uptime = health.uptime { metricRow("Uptime", formatUptime(uptime)) }
            if let node = health.nodeVersion { metricRow("Node.js", node) }
            if let heap = health.heapUsedMb { metricRow("Memory", String(format: "%.1f MB", heap)) }
            if let latency = health.latencyMs { metricRow("Latency", String(format: "%.0f ms", latency)) }
        }
        .webCard(padding: 18)
    }

    private func servicesCard(_ checks: [HealthCheckItem]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            WebSectionHeader("Services", number: "02", subtitle: "Current upstream provider checks.")
            ForEach(checks) { check in
                HStack(spacing: 11) {
                    Image(systemName: statusIcon(check.statusLevel)).foregroundStyle(statusColor(check.statusLevel))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(check.label).font(.webSans(14, weight: .semibold)).foregroundStyle(Color.webInk)
                        Text(check.detail).font(.webSans(11)).foregroundStyle(Color.webInkTertiary)
                    }
                    Spacer()
                    if let meta = check.meta { Text(meta).font(.webMono(9)).foregroundStyle(Color.webInkTertiary) }
                }
                if check.id != checks.last?.id { Divider().overlay(Color.webLine) }
            }
        }
        .webCard(padding: 18)
    }

    private func metricRow(_ label: String, _ value: String) -> some View {
        HStack { Text(label).font(.webSans(13)).foregroundStyle(Color.webInkSecondary); Spacer(); Text(value).font(.webMono(10)).foregroundStyle(Color.webInk) }
    }

    private func formatUptime(_ seconds: Double) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 24 {
            let days = hours / 24
            return "\(days)d \(hours % 24)h \(minutes)m"
        }
        return "\(hours)h \(minutes)m"
    }

    private func statusIcon(_ level: HealthCheckItem.StatusLevel) -> String {
        switch level {
        case .ok: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.circle.fill"
        case .down: return "xmark.circle.fill"
        }
    }

    private func statusColor(_ level: HealthCheckItem.StatusLevel) -> Color {
        switch level {
        case .ok: return .green
        case .warn: return .orange
        case .down: return .red
        }
    }

    private func shortenedURL(_ url: String) -> String {
        url.replacingOccurrences(of: "https://", with: "")
           .replacingOccurrences(of: "http://", with: "")
    }
}

#Preview {
    NavigationStack {
        StatusView()
    }
}
