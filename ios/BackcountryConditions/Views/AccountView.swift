import SwiftUI

/// Your account: sign in or create one, then your profile, allowances, plan and connected AI apps.
/// The same account as the web app; the session is the server's cookie.
struct AccountView: View {
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    /// Why the screen was opened, e.g. a feature that needs an account.
    var reason: String?

    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in", create = "Create account", forgot = "Reset password", reset = "New password"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var resetToken = ""
    @State private var busy = false
    @State private var error: String?
    @State private var message: String?

    var body: some View {
        Form {
            if let reason {
                Section { Label(reason, systemImage: "person.crop.circle.badge.exclamationmark").font(.subheadline) }
            }
            if let user = account.user {
                signedIn(user)
            } else {
                signedOut
            }
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(Palette.caution) }
            }
            if let message {
                Section { Text(message).font(.footnote) }
            }
        }
        .pageBackground()
        .navigationTitle(account.signedIn ? "Your account" : "Account")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .overlay { if busy || account.loading { ProgressView() } }
        .task { await account.refresh() }
        .refreshable { await account.refresh() }
    }

    // MARK: Signed out

    @ViewBuilder private var signedOut: some View {
        if account.available == false {
            Section {
                Text("Accounts are not enabled on this server. Your plans and preferences stay on this iPhone.").font(.footnote)
            }
        }
        Section {
            if mode == .signIn || mode == .create {
                Picker("Account action", selection: $mode) {
                    Text("Sign in").tag(Mode.signIn)
                    Text("Create account").tag(Mode.create)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            }
            if mode == .create {
                TextField("Your name", text: $name).textContentType(.name)
            }
            if mode == .reset {
                TextField("Reset code from the email link", text: $resetToken)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            } else {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if mode != .forgot {
                SecureField(mode == .reset ? "New password" : "Password", text: $password)
                    .textContentType(mode == .signIn ? .password : .newPassword)
            }
            if mode == .create || mode == .reset {
                SecureField("Confirm password", text: $confirm).textContentType(.newPassword)
            }
            Button(action: submit) {
                Text(busy ? "Please wait…" : mode == .forgot ? "Send reset link" : mode == .reset ? "Save new password" : mode == .create ? "Create account" : "Sign in")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent).tint(Palette.prominent)
            .disabled(!canSubmit || account.available == false)
            .listRowBackground(Color.clear)
        } header: {
            Text(mode == .forgot ? "Reset your password" : mode == .reset ? "Choose a new password" : mode == .create ? "Create your account" : "Sign in to your account")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Save reports, sync preferences, watch objectives from the server, and use AI planning tools. It’s the same account as the web app.")
                if mode == .create || mode == .reset { Text("Use at least 12 characters.") }
                if mode == .create {
                    Text("By creating an account, you agree to the Terms of Use and acknowledge the Privacy Policy.")
                }
            }
        }
        Section {
            Button(mode == .signIn || mode == .create ? "Forgot your password?" : "Back to sign in") { switchMode(mode == .signIn || mode == .create ? .forgot : .signIn) }
            if mode == .forgot { Button("I have a reset code") { switchMode(.reset) } }
            NavigationLink("Terms of Use") { LegalView(kind: .terms) }
            NavigationLink("Privacy Policy") { LegalView(kind: .privacy) }
        }
        Section("Without an account") {
            LabeledContent("Reports on this iPhone", value: "\(account.guestReportCount) of \(AccountStore.guestReportLimit)")
            Text("Google sign-in is available on the web. An account made with Google can set a password with Reset password, then sign in here.")
                .font(.footnote).foregroundStyle(Palette.secondary)
        }
    }

    private var canSubmit: Bool {
        switch mode {
        case .signIn: !email.isEmpty && !password.isEmpty
        case .create: !name.isEmpty && !email.isEmpty && password.count >= 12 && !confirm.isEmpty
        case .forgot: !email.isEmpty
        case .reset: !resetToken.isEmpty && password.count >= 12 && !confirm.isEmpty
        }
    }

    private func switchMode(_ next: Mode) {
        mode = next
        password = ""
        confirm = ""
        error = nil
        message = nil
    }

    private func submit() {
        guard canSubmit, !busy else { return }
        if (mode == .create || mode == .reset) && password != confirm {
            error = "Passwords do not match."
            return
        }
        run {
            switch mode {
            case .signIn:
                try await account.signIn(email: email, password: password)
                password = ""
                return nil
            case .create:
                try await account.register(name: name, email: email, password: password)
                password = ""
                confirm = ""
                return "Account created. Check your email to verify your address."
            case .forgot:
                return try await account.requestPasswordReset(email: email)
            case .reset:
                let result = try await account.resetPassword(token: resetToken.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                switchMode(.signIn)
                return result
            }
        }
    }

    private func run(_ action: @escaping () async throws -> String?) {
        busy = true
        error = nil
        message = nil
        Task {
            do {
                message = try await action()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    // MARK: Signed in

    @ViewBuilder private func signedIn(_ user: AccountUser) -> some View {
        Section {
            HStack(spacing: 14) {
                Text(user.initial).font(.title2.weight(.semibold)).foregroundStyle(Palette.onAccent)
                    .frame(width: 52, height: 52).background(Palette.accent, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.displayName).font(.headline)
                    Text(user.email).font(.subheadline).foregroundStyle(Palette.secondary)
                    if let since = DateText.date(String(user.createdAt.prefix(10))) {
                        Text("Member since \(since.formatted(.dateTime.month(.abbreviated).year()))").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
                Spacer()
                Label("\(account.tierLabel ?? "Free")", systemImage: account.isPremium ? "sparkles" : "person")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Palette.fill, in: Capsule())
            }
            if user.emailVerified {
                Label("Email verified", systemImage: "checkmark.seal").font(.footnote).foregroundStyle(Palette.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Verify your email to use account email delivery.", systemImage: "envelope.badge").font(.footnote)
                    Button("Send verification email") { run { try await account.resendVerification() } }.font(.footnote.weight(.semibold))
                }
            }
        }
        Section("Usage this month") {
            UsageRow(label: "Generated reports", allowance: account.reportUsage)
            UsageRow(label: "Multi-day checks", allowance: account.multiDayUsage)
            UsageRow(label: "AI tokens", allowance: account.aiUsage)
            if let count = account.reportCount { LabeledContent("Saved reports", value: "\(count)") }
        }
        Section {
            LabeledContent("Plan", value: account.tierLabel ?? "Free")
            if let end = account.tierPeriodEnd.flatMap({ DateText.date(String($0.prefix(10))) }) {
                LabeledContent(account.tierCancelsAtPeriodEnd ? "Access ends" : "Current period through", value: end.formatted(.dateTime.month().day().year()))
            }
        } header: {
            Text("Your plan")
        } footer: {
            Text(account.isPremium
                 ? "Unlimited AI, report generation, and multi-day comparisons. Up to 10 watches with automatic checks, email alerts, and 90 days of history."
                 : "Separate monthly allowances for reports, AI tokens, and comparisons. One watch with manual refresh and 14 days of check history.")
        }
        Section {
            NavigationLink {
                ConnectedAppsView(user: user)
            } label: {
                Label("Use Conditions with AI apps", systemImage: "app.connected.to.app.below.fill")
            }
        } footer: {
            Text("Search objectives, compare forecasts, and read your saved reports and watches from ChatGPT, Claude and other MCP clients. Access is read-only.")
        }
        if let syncError = account.syncError {
            Section { Label("Preferences didn’t sync: \(syncError)", systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Palette.caution) }
        }
        Section {
            Button("Refresh account", systemImage: "arrow.clockwise") { Task { await account.refresh() } }
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                run {
                    try await account.signOut()
                    return "Signed out. Plans on this iPhone stay here."
                }
            }
        }
    }
}

struct UsageRow: View {
    var label: String
    var allowance: Allowance?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(valueText).foregroundStyle(allowance?.exhausted == true ? Palette.caution : Palette.secondary).monospacedDigit()
            }
            if let allowance, !allowance.unlimited, let used = allowance.used, let limit = allowance.limit, limit > 0 {
                ProgressView(value: min(used, limit), total: limit).tint(allowance.exhausted ? Palette.caution : Palette.accent)
            }
            if let reset = allowance?.resetAt.flatMap(ISO8601DateFormatter.parse) {
                Text("Resets \(reset.formatted(.dateTime.month().day()))").font(.caption2).foregroundStyle(Palette.secondary)
            }
        }
    }

    private var valueText: String {
        guard let allowance else { return "Unavailable" }
        if allowance.unlimited { return "Unlimited" }
        let used = allowance.used.map { Int($0).formatted() } ?? "—"
        let limit = allowance.limit.map { Int($0).formatted() } ?? "—"
        return "\(used) of \(limit)"
    }
}

/// The MCP connection for AI apps: the server URL, how to set it up, and the apps connected now.
struct ConnectedAppsView: View {
    var user: AccountUser
    @State private var connections: [JSON] = []
    @State private var loading = true
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                Text(AppSettings.mcpURL).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                Button(copied ? "Copied" : "Copy server URL", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = AppSettings.mcpURL
                    copied = true
                }
            } header: {
                Text("MCP server URL · OAuth · scope conditions:read")
            }
            Section("Set up ChatGPT") {
                Text("In ChatGPT on the web, open Settings → Plugins (or Apps), enable Developer mode if available, and create a custom app named Conditions. Paste the server URL, choose OAuth, and leave the client ID and secret blank. Sign in to your Conditions account and choose “Allow read access”.")
                    .font(.footnote)
            }
            Section("Set up Claude, Grok, Gemini or another client") {
                Text("Claude: Customize → Connectors → add a custom connector with the server URL, then connect and sign in. Grok: Plugins → Connectors → New Connector → Custom. Gemini: Settings → Connected Apps → Custom apps. Desktop and CLI apps: add the URL as a remote Streamable HTTP MCP server with OAuth.")
                    .font(.footnote)
            }
            Section {
                if loading {
                    ProgressView()
                } else if connections.isEmpty {
                    Text("No active connections.").foregroundStyle(Palette.secondary)
                }
                ForEach(Array(connections.enumerated()), id: \.offset) { _, connection in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(connection["clientName"].string ?? "MCP client").font(.headline)
                        Text([connection["created_at"].string.flatMap(ISO8601DateFormatter.parse).map { "Connected \($0.formatted(date: .abbreviated, time: .omitted))" },
                              connection["expires_at"].string.flatMap(ISO8601DateFormatter.parse).map { "expires \($0.formatted(date: .abbreviated, time: .omitted))" }]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.secondary)
                        Button("Disconnect", role: .destructive) { Task { await disconnect(connection) } }.font(.footnote.weight(.semibold))
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Palette.caution) }
            } header: {
                Text("Connected apps")
            } footer: {
                Text("Access is read-only and limited to your account, including saved trip locations and dates. Signing out or letting your sign-in expire ends access.")
            }
        }
        .pageBackground()
        .navigationTitle("AI apps")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            connections = try await APIClient().mcpConnections()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func disconnect(_ connection: JSON) async {
        guard let id = connection["id"].string else { return }
        do {
            try await APIClient().mcpDisconnect(id: id, userID: user.id)
            connections.removeAll { $0["id"].string == id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
