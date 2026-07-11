import SwiftUI

struct ReportLogsView: View {
    @State private var draft = ""
    @State private var secret = ""
    @State private var logs: [ReportLogEntry] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var filter: LogFilter = .all
    @State private var query = ""

    private let service = ReportLogsService()

    private enum LogFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case healthy = "Healthy"
        case issues = "Issues"
        var id: String { rawValue }
    }

    var body: some View {
        Group {
            if secret.isEmpty { unlockView } else { dashboard }
        }
        .background(Color.webBackground)
        .navigationTitle("Report Logs")
        .toolbar {
            if !secret.isEmpty {
                ToolbarItemGroup(placement: .primaryAction) {
                    ShareLink(item: csvText) { Image(systemName: "square.and.arrow.up") }
                    Button { lock() } label: { Image(systemName: "lock") }
                }
            }
        }
    }

    private var unlockView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WebPageHeader(
                    kicker: "Restricted operations",
                    title: "Report logs",
                    subtitle: "Inspect request health, latency, and partial-data outcomes from the last seven days.",
                    systemImage: "doc.text.magnifyingglass"
                )

                VStack(alignment: .leading, spacing: 12) {
                    WebSectionHeader("Unlock activity", number: "01", subtitle: "The access key stays in memory only while this screen is open.")
                    SecureField("Access key", text: $draft)
                        .textContentType(.password)
                        .textFieldStyle(.roundedBorder)
                    Button("Unlock") {
                        secret = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        draft = ""
                        Task { await load() }
                    }
                    .buttonStyle(WebPrimaryButtonStyle())
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .webCard(padding: 18)
                if let error { Label(error, systemImage: "exclamationmark.triangle.fill").font(.webSans(13)).foregroundStyle(.red).webCard() }
            }
            .padding(16)
        }
    }

    private var dashboard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WebPageHeader(kicker: "Restricted operations", title: "Request activity", subtitle: "Seven-day server health for generated conditions briefs.", systemImage: "waveform.path.ecg")
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.webSans(13)).foregroundStyle(.orange).webCard()
                }
                VStack(alignment: .leading, spacing: 12) {
                    WebKicker(text: "Last seven days", systemImage: "calendar")
                    HStack {
                        metric("Requests", "\(logs.count)")
                        metric("Success", "\(successRate)%")
                        metric("Partial", "\(logs.filter { $0.partialData == true }.count)")
                        metric("Avg", formatDuration(averageDuration))
                    }
                }
                .webCard()
                VStack(spacing: 12) {
                    Picker("Status", selection: $filter) {
                        ForEach(LogFilter.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField("Search location, date, network…", text: $query)
                        .textFieldStyle(.roundedBorder)
                }
                .webCard()
                VStack(alignment: .leading, spacing: 12) {
                    WebKicker(text: "Request activity", systemImage: "list.bullet.rectangle")
                    if isLoading && logs.isEmpty {
                        HStack { ProgressView(); Text("Loading report activity…") }
                    } else if filteredLogs.isEmpty {
                        ContentUnavailableView("No matching requests", systemImage: "doc.text.magnifyingglass")
                    } else {
                        ForEach(filteredLogs) { entry in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Text(entry.name ?? "Unnamed objective").font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Spacer()
                                    Text("HTTP \(entry.statusCode)")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(entry.statusCode == 200 ? .green : .red)
                                }
                                HStack(spacing: 8) {
                                    Text(entry.date ?? "No date")
                                    if let score = entry.safetyScore { Text("Score \(Int(score))") }
                                    Text(formatDuration(entry.durationMs))
                                    if entry.partialData == true { Text("Partial").foregroundStyle(.orange) }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                Text("\(entry.ip ?? "Unknown network") · \(formattedTimestamp(entry.timestamp))")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 3)
                            if entry.id != filteredLogs.last?.id { Divider().overlay(Color.webLine) }
                        }
                    }
                }
                .webCard()
            }
            .padding(16)
        }
        .refreshable { await load() }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack { Text(value).font(.headline.monospacedDigit()); Text(label).font(.caption2).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity)
    }

    private var filteredLogs: [ReportLogEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return logs.filter { entry in
            let statusMatch = filter == .all || (filter == .healthy ? entry.statusCode == 200 && entry.partialData != true : entry.statusCode != 200 || entry.partialData == true)
            guard statusMatch else { return false }
            guard !needle.isEmpty else { return true }
            return [entry.name, entry.date, entry.startTime, entry.ip, entry.userAgent].compactMap { $0 }.contains { $0.lowercased().contains(needle) }
        }
    }

    private var successRate: Int { logs.isEmpty ? 0 : Int((Double(logs.filter { $0.statusCode == 200 }.count) / Double(logs.count) * 100).rounded()) }
    private var averageDuration: Double { logs.isEmpty ? 0 : logs.reduce(0) { $0 + $1.durationMs } / Double(logs.count) }

    private var csvText: String {
        let header = "timestamp,name,lat,lon,date,startTime,statusCode,safetyScore,partialData,durationMs,ip,userAgent"
        let rows = filteredLogs.map { entry in
            let values: [String] = [
                entry.timestamp,
                entry.name ?? "",
                entry.lat.map { String($0) } ?? "",
                entry.lon.map { String($0) } ?? "",
                entry.date ?? "",
                entry.startTime ?? "",
                String(entry.statusCode),
                entry.safetyScore.map { String($0) } ?? "",
                entry.partialData.map { String($0) } ?? "",
                String(entry.durationMs),
                entry.ip ?? "",
                entry.userAgent ?? ""
            ]
            return values.map(csvEscape).joined(separator: ",")
        }
        return ([header] + rows).joined(separator: "\n")
    }

    @MainActor private func load() async {
        guard !secret.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do { logs = try await service.load(secret: secret); error = nil }
        catch { self.error = error.localizedDescription; if case APIError.httpError(let code, _) = error, code == 401 || code == 403 { lock(rejected: true) } }
    }

    private func lock(rejected: Bool = false) { secret = ""; logs = []; error = rejected ? "That key was not accepted. Try again." : nil }
    private func csvEscape(_ value: String) -> String { value.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" }) ? "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\"" : value }
    private func formatDuration(_ value: Double) -> String { value >= 1_000 ? String(format: "%.1fs", value / 1_000) : "\(Int(value))ms" }
    private func formattedTimestamp(_ value: String) -> String { ISO8601DateFormatter().date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? value }
}
