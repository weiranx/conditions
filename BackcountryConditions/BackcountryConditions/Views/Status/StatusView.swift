import SwiftUI

struct StatusView: View {
    @State private var statusVM = StatusViewModel()

    var body: some View {
            List {
                if statusVM.isLoading {
                    Section {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Checking backend health...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let error = statusVM.error {
                    Section {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(.red)
                            Text(error)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                if let health = statusVM.healthResponse {
                    // Overall status banner
                    Section {
                        HStack(spacing: 12) {
                            Image(systemName: health.status == "ok" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(health.status == "ok" ? .green : .orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(health.status == "ok" ? "All Systems Operational" : "Degraded Performance")
                                    .font(.subheadline.weight(.semibold))
                                if let version = health.version {
                                    Text("v\(version)")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }

                    // Server metrics
                    Section("Server") {
                        if let env = health.env {
                            LabeledContent("Environment", value: env.capitalized)
                        }
                        if let uptime = health.uptime {
                            LabeledContent("Uptime", value: formatUptime(uptime))
                        }
                        if let node = health.nodeVersion {
                            LabeledContent("Node.js", value: node)
                        }
                        if let heap = health.heapUsedMb {
                            HStack {
                                Text("Memory")
                                Spacer()
                                Text(String(format: "%.1f MB", heap))
                                    .foregroundStyle(.secondary)
                                if let rss = health.rssMb {
                                    Text("/ \(String(format: "%.0f MB", rss))")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        if let latency = health.latencyMs {
                            HStack {
                                Text("Latency")
                                Spacer()
                                Text(String(format: "%.0f ms", latency))
                                    .foregroundStyle(latency < 200 ? .green : (latency < 500 ? .orange : .red))
                            }
                        }
                    }

                    // Service checks
                    if let checks = health.checks, !checks.isEmpty {
                        Section("Services") {
                            ForEach(checks) { check in
                                HStack(spacing: 10) {
                                    Image(systemName: statusIcon(check.statusLevel))
                                        .foregroundStyle(statusColor(check.statusLevel))
                                        .font(.system(size: 14))

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(check.label)
                                            .font(.subheadline.weight(.medium))
                                        Text(check.detail)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    if let meta = check.meta {
                                        Text(meta)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }

                // Connection info
                Section("Connection") {
                    LabeledContent("API Endpoint", value: shortenedURL(Configuration.apiBaseURL))
                }
            }
            .navigationTitle("Status")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await statusVM.loadHealth() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .refreshable {
                await statusVM.loadHealth()
            }
            .task {
                await statusVM.loadHealth()
            }
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
