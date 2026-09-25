import SwiftUI

extension Plan {
    /// The report as the report assistant reads it (the web's `rawReportPayload`).
    func chatPayload(_ report: Report) -> String {
        let json = report.json
        var object: [String: JSON] = [
            "objective": .object([
                "name": .string(objective.shortName),
                "activity": .string(activity.rawValue),
                "coordinates": .object(["lat": .number((objective.lat * 1e5).rounded() / 1e5), "lon": .number((objective.lon * 1e5).rounded() / 1e5)]),
                "forecastDate": .string(report.selectedDate ?? date),
                "startTime": .string(start),
                "backByTime": .string(DateText.clock(DateText.clockAdding(start, hours: travelHours))),
                "targetElevationFt": .null,
            ]),
            "forecast": json["forecast"],
            "featureFlags": json["featureFlags"],
            "weather": json["weather"],
            "alerts": json["alerts"],
            "rainfall": json["rainfall"],
            "pleasantness": json["pleasantness"],
            "safety": json["safety"],
            "decision": report.evaluation["decision"],
        ]
        for key in ["solar", "avalanche", "airQuality", "snowpack", "fireRisk", "heatRisk"] where !json[key].isNull {
            object[key] = json[key]
        }
        if let analysis = route?.analysis {
            object["route"] = .object(["name": .string(route?.name ?? ""), "summaries": analysis["summaries"], "analysis": analysis["analysis"]])
        }
        return String(decoding: JSON.object(object).data(), as: UTF8.self)
    }
}

// MARK: - AI explanation

/// "The report, explained": a plain-language read of the report, written by the server's AI.
struct AIBriefCard: View {
    @Environment(PlanStore.self) private var store
    @Environment(AccountStore.self) private var account
    var plan: Plan
    var report: Report
    /// A saved snapshot's explanation, shown read-only.
    var savedText: String?
    var readOnly: Bool
    var onSignIn: () -> Void

    @State private var loading = false
    @State private var error: String?

    private var text: String? { savedText ?? store.aiBrief(plan) }

    var body: some View {
        if text != nil || (!readOnly && account.ai.aiBrief) || (!readOnly && !account.ai.known) {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(title: "The report, explained") {
                    Label("AI", systemImage: "sparkles").labelStyle(TightLabelStyle())
                }
                Card(spacing: 10) {
                    if let text {
                        MarkdownText(text: text).opacity(loading ? 0.5 : 1)
                        Label("Written by AI from this report’s data and can be wrong. It never changes the decision or score.", systemImage: "info.circle")
                            .font(.caption).foregroundStyle(Palette.secondary)
                        if !readOnly {
                            Button { Task { await request() } } label: {
                                Label(loading ? "Rewriting…" : "Regenerate", systemImage: "arrow.clockwise")
                            }
                            .buttonStyle(.glass).controlSize(.small).disabled(loading)
                        }
                    } else {
                        Caption("What drives the decision and what to watch, in plain language.", tone: Palette.label)
                        Button { Task { await request() } } label: {
                            Label(loading ? "Writing explanation…" : "Explain this report", systemImage: "sparkles").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent).tint(Palette.prominent)
                        .disabled(loading)
                        if loading { ProgressView().frame(maxWidth: .infinity) }
                    }
                    if let error { Caption(error, tone: Palette.caution) }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func request() async {
        guard account.signedIn else { return onSignIn() }
        loading = true
        defer { loading = false }
        do {
            var payload = report.json.object
            if let analysis = plan.route?.analysis {
                payload["route"] = .object(["name": .string(plan.route?.name ?? ""), "summaries": analysis["summaries"]])
            }
            let narrative = try await APIClient().aiBrief(report: .object(payload), decisionLevel: report.level.rawValue, units: Units.current)
            store.setAIBrief(narrative, for: plan)
            error = nil
        } catch let apiError as APIError where apiError.needsAccount {
            onSignIn()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Report chat

/// Opens the report assistant.
struct ChatLauncher: View {
    @Environment(AccountStore.self) private var account
    var title: String
    var context: String
    var messageCount: Int
    var readOnly: Bool
    var action: () -> Void

    var body: some View {
        if messageCount > 0 || (!readOnly && (account.ai.reportChat || !account.ai.known)) {
            Button(action: action) {
                Card(spacing: 4) {
                    HStack(spacing: 12) {
                        Image(systemName: "bubble.left.and.text.bubble.right").font(.title3).foregroundStyle(Palette.accent)
                            .frame(width: 36, height: 36).background(Palette.fill, in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(readOnly ? "Saved conversation" : title).font(.headline).foregroundStyle(Palette.label)
                            Text(messageCount > 0 ? "\(context) · \(messageCount) messages" : context).font(.footnote).foregroundStyle(Palette.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Palette.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
        }
    }
}

/// A conversation with the report assistant about one report, trip or comparison. Answers stream
/// from `/api/report-chat`; the report is the context, and the decision stays the backend's.
struct ChatView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AccountStore.self) private var account
    var title: String
    var context: String
    /// "report", "trip" or "itinerary".
    var contextType: String
    var payload: String
    var readOnly: Bool
    @State var messages: [ChatMessage]
    var onChange: ([ChatMessage]) -> Void
    var onSignIn: () -> Void

    @State private var input = ""
    @State private var streaming: Task<Void, Never>?
    /// Which answer is streaming, so a stopped one can't clear the state of the next.
    @State private var streamID = UUID()
    @State private var suggestions: [String] = []
    @State private var failed = false
    @FocusState private var focused: Bool

    private var busy: Bool { streaming != nil }

    private var starters: [String] {
        switch contextType {
        case "trip": ["Which day has the best weather window?", "What are the tradeoffs between these days?", "What should I verify before committing?"]
        case "itinerary": ["What makes the weakest day or night hard?", "Is my sleep system warm enough for these nights?", "What would make this trip safer to run?"]
        default: ["What is driving the risk score?", "How does the timing affect my plan?", "What should I verify before leaving?"]
        }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if messages.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Image(systemName: "sparkles").font(.title2).foregroundStyle(Palette.accent)
                                Text(readOnly ? "No messages saved" : "Make sense of the conditions.").font(.display(26))
                                Caption(readOnly ? "This report does not have a saved conversation."
                                        : "Explore the forecast, weigh the tradeoffs, or work through your timing. Answers use the conditions in this \(contextType == "trip" ? "comparison" : contextType == "itinerary" ? "trip" : "report").")
                            }
                            .padding(.top, 12)
                        }
                        ForEach(messages) { message in bubble(message).id(message.id) }
                        if busy && (messages.last?.role != "assistant" || messages.last?.text.isEmpty == true) {
                            HStack(spacing: 8) { ProgressView().controlSize(.small); Caption("Reading the conditions…") }
                        }
                        if failed && !readOnly {
                            Notice(tone: .caution, text: "The response was interrupted. You can retry your last question.", actionTitle: "Retry response") { retry() }
                                .padding(.horizontal, -16)
                        }
                        if !readOnly && !busy {
                            let prompts = messages.isEmpty ? starters : suggestions
                            if !prompts.isEmpty {
                                Text(messages.isEmpty ? "Try asking" : "Follow up").font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
                                ForEach(prompts, id: \.self) { prompt in
                                    Button(prompt) { send(prompt) }
                                        .buttonStyle(.glass).controlSize(.small).multilineTextAlignment(.leading)
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }
                .onChange(of: messages) { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .background(Palette.bg)
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(readOnly ? "Saved conversation" : title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                if !messages.isEmpty && !readOnly {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New conversation", systemImage: "square.and.pencil") {
                            stop()
                            messages = []
                            suggestions = []
                            onChange(messages)
                        }
                    }
                }
            }
        }
        .onDisappear { stop() }
    }

    private func bubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                if message.role == "assistant" {
                    Label("Conditions assistant", systemImage: "sparkles").font(.caption.weight(.semibold)).foregroundStyle(Palette.secondary)
                    MarkdownText(text: message.text.isEmpty ? "…" : message.text)
                } else {
                    Text(message.text).font(.subheadline).foregroundStyle(Palette.onAccent)
                }
            }
            .padding(12)
            .background(message.role == "user" ? Palette.accent : Palette.surface, in: RoundedRectangle(cornerRadius: 16))
            if message.role == "assistant" { Spacer(minLength: 0) }
        }
    }

    @ViewBuilder private var composer: some View {
        VStack(spacing: 6) {
            if !readOnly {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Ask about the conditions…", text: $input, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($focused)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
                        .onChange(of: input) { if input.count > 1000 { input = String(input.prefix(1000)) } }
                    if busy {
                        Button("Stop", systemImage: "stop.fill") { stop() }
                            .buttonStyle(.glass).labelStyle(.iconOnly)
                    } else {
                        Button("Send", systemImage: "arrow.up") { send(input) }
                            .buttonStyle(.glassProminent).tint(Palette.prominent).labelStyle(.iconOnly)
                            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            Text(readOnly ? "Saved with this report · Read only" : "AI planning support that can be wrong. Confirm official forecasts and current field conditions.")
                .font(.caption2).foregroundStyle(Palette.secondary).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func send(_ question: String) {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy, !readOnly else { return }
        guard account.signedIn else {
            dismiss()
            onSignIn()
            return
        }
        input = ""
        messages.append(ChatMessage(role: "user", text: text))
        run()
    }

    private func retry() {
        if messages.last?.role == "assistant" { messages.removeLast() }
        run()
    }

    /// Stops the answer being written, keeping what arrived so far.
    private func stop() {
        guard let streaming else { return }
        streaming.cancel()
        self.streaming = nil
        streamID = UUID()
        messages.removeAll { $0.role == "assistant" && $0.text.isEmpty }
        onChange(messages)
    }

    private func run() {
        failed = false
        suggestions = []
        let history = Array(messages.suffix(16))
        let id = UUID()
        streamID = id
        let placeholder = ChatMessage(role: "assistant", text: "")
        messages.append(placeholder)
        streaming = Task {
            var answer = placeholder
            do {
                for try await event in APIClient().reportChat(messages: history, report: payload, contextType: contextType) {
                    guard streamID == id else { return }
                    switch event {
                    case .text(let delta):
                        answer.text += delta
                        if let index = messages.lastIndex(where: { $0.id == answer.id }) { messages[index] = answer }
                    case .suggestions(let next):
                        suggestions = Array(next.prefix(3))
                    case .error(let message):
                        answer.text += answer.text.isEmpty ? message : "\n\n\(message)"
                        if let index = messages.lastIndex(where: { $0.id == answer.id }) { messages[index] = answer }
                    }
                }
                // Stopped: `stop()` already tidied up.
                guard streamID == id else { return }
                if answer.text.isEmpty {
                    messages.removeAll { $0.id == answer.id }
                    failed = true
                }
            } catch {
                guard streamID == id else { return }
                if answer.text.isEmpty { messages.removeAll { $0.id == answer.id } }
                failed = true
                if let apiError = error as? APIError, apiError.needsAccount { onSignIn() }
            }
            streaming = nil
            onChange(messages)
        }
    }
}
