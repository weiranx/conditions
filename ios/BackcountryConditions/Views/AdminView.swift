import SwiftUI

/// Administration for the owner account (the web's Administration): service overview, accounts,
/// feature flags, activity and maintenance. The server checks the account on every request.
struct AdminView: View {
    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview", users = "Users", flags = "Features", activity = "Activity", maintenance = "Maintenance"
        var id: String { rawValue }
    }

    @State private var section: Section = .overview

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $section) {
                ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            switch section {
            case .overview: AdminOverview()
            case .users: AdminUsers()
            case .flags: AdminFlags()
            case .activity: AdminActivity()
            case .maintenance: AdminMaintenance()
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Administration")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Loads one admin endpoint and keeps its error.
@Observable
final class AdminLoader {
    var value: JSON = .null
    var loading = false
    var error: String?

    func load(_ path: String, query: [String: String] = [:]) async {
        loading = true
        defer { loading = false }
        do {
            value = try await APIClient().admin("GET", path, query: query)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct AdminOverview: View {
    @State private var resources = AdminLoader()
    @State private var runtime = AdminLoader()
    @State private var scheduler = AdminLoader()
    @State private var history = AdminLoader()
    @State private var message: String?

    var body: some View {
        Form {
            if let message { SwiftUI.Section { Text(message).font(.footnote) } }
            SwiftUI.Section("System resources") {
                if let error = resources.error { Text(error).foregroundStyle(Palette.caution).font(.footnote) }
                ForEach(resources.value.object.keys.sorted().filter { !resources.value[$0].isNull && resources.value[$0].object.isEmpty && resources.value[$0].array.isEmpty }, id: \.self) { key in
                    LabeledContent(key, value: resources.value[key].string ?? resources.value[key].pretty)
                }
                RawDataDisclosure(title: "All resource data", value: resources.value)
            }
            SwiftUI.Section("Objective watch scheduler") {
                if let error = scheduler.error { Text(error).foregroundStyle(Palette.caution).font(.footnote) }
                let status = scheduler.value
                if let enabled = status["enabled"].bool ?? status.at("scheduler.enabled").bool {
                    Toggle("Automatic checks", isOn: Binding(get: { enabled }, set: { value in Task { await setScheduler(value) } }))
                }
                RawDataDisclosure(title: "Scheduler status", value: status)
                Button("Run a check pass now", systemImage: "play") { Task { await runScheduler() } }
            }
            SwiftUI.Section("Runtime environment") {
                RawDataDisclosure(title: "Environment", value: runtime.value)
                if let error = runtime.error { Text(error).foregroundStyle(Palette.caution).font(.footnote) }
            }
            SwiftUI.Section("Health monitor") {
                let entries = history.value["entries"].array.isEmpty ? history.value.array : history.value["entries"].array
                ForEach(Array(entries.prefix(12).enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry["status"].string ?? entry["state"].string ?? "Check").font(.subheadline.weight(.semibold))
                        Text(DateText.stamp(entry["checkedAt"].string ?? entry["timestamp"].string) ?? "").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
                RawDataDisclosure(title: "History", value: history.value)
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        async let a: Void = resources.load("system-resources")
        async let b: Void = runtime.load("runtime-environment")
        async let c: Void = scheduler.load("objective-watch-scheduler")
        async let d: Void = history.load("health-monitor-history")
        _ = await (a, b, c, d)
    }

    private func setScheduler(_ enabled: Bool) async {
        do {
            _ = try await APIClient().admin("PATCH", "objective-watch-scheduler", body: .object(["enabled": .bool(enabled)]))
            await scheduler.load("objective-watch-scheduler")
        } catch { message = error.localizedDescription }
    }

    private func runScheduler() async {
        do {
            let result = try await APIClient().admin("POST", "objective-watch-scheduler/run")
            message = result["message"].string ?? "Check pass finished."
            await scheduler.load("objective-watch-scheduler")
        } catch { message = error.localizedDescription }
    }
}

private struct AdminUsers: View {
    @State private var directory = AdminLoader()
    @State private var search = ""
    @State private var message: String?
    @State private var busy: String?

    var body: some View {
        let users = directory.value["users"].array.filter { user in
            search.isEmpty || "\(user["displayName"].string ?? "") \(user["email"].string ?? "")".localizedCaseInsensitiveContains(search)
        }
        Form {
            if let message { SwiftUI.Section { Text(message).font(.footnote) } }
            if let error = directory.error { SwiftUI.Section { Text(error).foregroundStyle(Palette.caution).font(.footnote) } }
            let summary = directory.value["summary"]
            if !summary.isNull {
                SwiftUI.Section("Accounts") {
                    LabeledContent("Total", value: "\(directory.value["total"].int ?? 0)")
                    LabeledContent("Active · suspended", value: "\(summary["active"].int ?? 0) · \(summary["suspended"].int ?? 0)")
                    LabeledContent("Free · premium", value: "\(summary["free"].int ?? 0) · \(summary["premium"].int ?? 0)")
                    LabeledContent("Verified · unverified", value: "\(summary["verified"].int ?? 0) · \(summary["unverified"].int ?? 0)")
                    LabeledContent("Active sessions", value: "\(summary["activeSessions"].int ?? 0)")
                }
            }
            SwiftUI.Section {
                ForEach(Array(users.enumerated()), id: \.offset) { _, user in
                    DisclosureGroup {
                        userDetail(user)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(user["displayName"].string ?? "Account").font(.subheadline.weight(.semibold))
                                if user["tier"].string == "premium" { Image(systemName: "sparkles").foregroundStyle(Palette.accent) }
                                if user["status"].string == "suspended" { Text("Suspended").font(.caption).foregroundStyle(Palette.caution) }
                            }
                            Text(user["email"].string ?? "").font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                }
            } header: {
                Text("\(users.count) shown")
            }
        }
        .searchable(text: $search, prompt: "Name or email")
        .task { await directory.load("users") }
        .refreshable { await directory.load("users") }
    }

    @ViewBuilder
    private func userDetail(_ user: JSON) -> some View {
        let id = user["id"].string ?? ""
        let owner = user["isOwner"].bool == true
        LabeledContent("Sign-in", value: user["authMethods"].strings.joined(separator: ", "))
        LabeledContent("Email", value: user["emailVerified"].bool == true ? "Verified" : "Not verified")
        LabeledContent("Saved reports", value: "\(user["savedReports"].int ?? 0)")
        LabeledContent("AI this month", value: "\(user["aiCalls"].int ?? 0) calls · \(user["aiTokens"].int ?? 0) tokens")
        LabeledContent("Sessions", value: "\(user["activeSessions"].int ?? 0)")
        if let last = DateText.stamp(user["lastActivityAt"].string) { LabeledContent("Last active", value: last) }
        if !owner {
            Button(user["tier"].string == "premium" ? "Move to Free" : "Move to Premium") {
                act(id, "PATCH", "users/\(id)/tier", ["tier": .string(user["tier"].string == "premium" ? "free" : "premium")])
            }
            Button(user["status"].string == "suspended" ? "Reactivate" : "Suspend", role: user["status"].string == "suspended" ? nil : .destructive) {
                act(id, "PATCH", "users/\(id)", ["status": .string(user["status"].string == "suspended" ? "active" : "suspended")])
            }
            Button("Sign out everywhere") { act(id, "POST", "users/\(id)/revoke-sessions", [:]) }
        }
        if user["emailVerified"].bool != true { Button("Send verification email") { act(id, "POST", "users/\(id)/send-verification", [:]) } }
        Button("Reset this month’s usage") { act(id, "POST", "users/\(id)/reset-usage", [:]) }
    }

    private func act(_ id: String, _ method: String, _ path: String, _ body: [String: JSON]) {
        busy = id
        Task {
            do {
                let result = try await APIClient().admin(method, path, body: .object(body))
                message = result["message"].string ?? "Done."
                await directory.load("users")
            } catch {
                message = error.localizedDescription
            }
            busy = nil
        }
    }
}

private struct AdminFlags: View {
    @State private var loader = AdminLoader()
    @State private var message: String?

    var body: some View {
        Form {
            if let message { SwiftUI.Section { Text(message).font(.footnote) } }
            if let error = loader.error { SwiftUI.Section { Text(error).foregroundStyle(Palette.caution).font(.footnote) } }
            SwiftUI.Section {
                ForEach(FeatureFlags.keys, id: \.self) { key in
                    if let value = loader.value.at("flags.\(key)").bool {
                        Toggle(Self.label(key), isOn: Binding(get: { value }, set: { next in Task { await set(key, next) } }))
                    }
                }
            } footer: {
                Text(loader.value["persistent"].bool == true ? "Saved on the server and kept across restarts." : "Not persistent: these reset when the server restarts.")
            }
        }
        .task { await loader.load("feature-flags") }
        .refreshable { await loader.load("feature-flags") }
    }

    private static func label(_ key: String) -> String {
        key.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).capitalized
    }

    private func set(_ key: String, _ value: Bool) async {
        do {
            _ = try await APIClient().admin("PATCH", "feature-flags", body: .object(["flags": .object([key: .bool(value)])]))
            await loader.load("feature-flags")
            await AccountStore.shared.refreshFlags()
            message = nil
        } catch { message = error.localizedDescription }
    }
}

private struct AdminActivity: View {
    @State private var audit = AdminLoader()
    @State private var logs: [JSON] = []
    @State private var aiUsage: [JSON] = []
    @State private var error: String?

    var body: some View {
        Form {
            if let error { SwiftUI.Section { Text(error).foregroundStyle(Palette.caution).font(.footnote) } }
            SwiftUI.Section("Admin activity") {
                let entries = audit.value["entries"].array.isEmpty ? audit.value.array : audit.value["entries"].array
                ForEach(Array(entries.prefix(40).enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry["summary"].string ?? entry["action"].string ?? "Event").font(.subheadline)
                        Text([entry["category"].string, entry["status"].string, DateText.stamp(entry["createdAt"].string ?? entry["timestamp"].string)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
            }
            SwiftUI.Section("Recent reports (\(logs.count))") {
                ForEach(Array(logs.prefix(40).enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry["name"].string ?? entry["objectiveName"].string ?? entry["location"].string ?? "Report").font(.subheadline)
                        Text([DateText.stamp(entry["timestamp"].string ?? entry["createdAt"].string), entry["status"].string, entry["statusCode"].string].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
            }
            SwiftUI.Section("AI usage (\(aiUsage.count))") {
                ForEach(Array(aiUsage.prefix(40).enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(entry["feature"].string ?? "AI") · \(entry["model"].string ?? "")").font(.subheadline)
                        Text([DateText.stamp(entry["createdAt"].string ?? entry["timestamp"].string), entry["status"].string,
                              entry["totalTokens"].int.map { "\($0) tokens" }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        await audit.load("audit-log")
        do {
            let client = APIClient()
            let reports = try await client.adminRaw("/api/report-logs")
            logs = reports.array.isEmpty ? reports["entries"].array : reports.array
            let usage = try await client.adminRaw("/api/ai-usage")
            aiUsage = usage.array.isEmpty ? usage["entries"].array : usage.array
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct AdminMaintenance: View {
    @State private var message: String?
    @State private var confirm: Action?

    enum Action: String, Identifiable {
        case caches = "Clear server caches", reportLogs = "Clear report logs", aiUsage = "Clear AI usage log", flags = "Reset feature flags"
        case diagnostics = "Run diagnostics", restart = "Restart the backend", resetUsage = "Reset every account’s monthly usage"
        var id: String { rawValue }

        var path: String {
            switch self {
            case .caches: "maintenance/caches"
            case .reportLogs: "maintenance/report-logs"
            case .aiUsage: "maintenance/ai-usage"
            case .flags: "maintenance/feature-flags"
            case .diagnostics: "diagnostics"
            case .restart: "maintenance/backend-restart"
            case .resetUsage: "users/reset-usage"
            }
        }
    }

    var body: some View {
        Form {
            if let message { SwiftUI.Section { Text(message).font(.footnote).textSelection(.enabled) } }
            SwiftUI.Section {
                Button(Action.diagnostics.rawValue, systemImage: "stethoscope") { Task { await run(.diagnostics) } }
                Button(Action.caches.rawValue, systemImage: "trash") { confirm = .caches }
            }
            SwiftUI.Section {
                Button(Action.reportLogs.rawValue, role: .destructive) { confirm = .reportLogs }
                Button(Action.aiUsage.rawValue, role: .destructive) { confirm = .aiUsage }
                Button(Action.flags.rawValue, role: .destructive) { confirm = .flags }
                Button(Action.resetUsage.rawValue, role: .destructive) { confirm = .resetUsage }
                Button(Action.restart.rawValue, role: .destructive) { confirm = .restart }
            } footer: {
                Text("These change the live server. Each one is recorded in the admin activity log.")
            }
        }
        .confirmationDialog(confirm?.rawValue ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if let action = confirm {
                Button(action.rawValue, role: .destructive) { Task { await run(action) } }
            }
        } message: {
            Text("This can’t be undone.")
        }
    }

    private func run(_ action: Action) async {
        do {
            let result = try await APIClient().admin("POST", action.path)
            message = result["message"].string ?? (action == .diagnostics ? result.pretty : "Done.")
        } catch {
            message = error.localizedDescription
        }
    }
}

extension APIClient {
    /// An admin endpoint outside `/api/admin` (report logs, AI usage).
    func adminRaw(_ path: String) async throws -> JSON {
        var request = URLRequest(url: baseURL.appending(path: path), timeoutInterval: 60)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let body = try? JSON.parse(data)
            throw APIError(message: body?["error"].string ?? "The server returned an error (\(status)).", status: status)
        }
        return try JSON.parse(data)
    }
}
