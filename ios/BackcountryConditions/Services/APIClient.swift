import Foundation

struct APIError: LocalizedError {
    let message: String
    var code: String?
    var status: Int?
    var field: String?

    var errorDescription: String? { message }

    /// Multi-day checks need the server's usage service (accounts and a database).
    var multiDayUnavailable: Bool {
        code == "MULTI_DAY_USAGE_UNAVAILABLE" || (status == 503 && message.localizedCaseInsensitiveContains("multi-day"))
    }

    /// The request needs a signed-in account.
    var needsAccount: Bool { status == 401 || code == "ACCOUNT_REQUIRED" }

    /// A monthly allowance is used up.
    var limitReached: Bool { status == 429 || (code ?? "").hasSuffix("LIMIT_REACHED") }
}

/// App settings kept in UserDefaults.
enum AppSettings {
    static let serverKey = "serverURL"
    static let demoKey = "demoMode"
    /// The simulator reaches a local backend; a phone uses the deployed API.
    #if targetEnvironment(simulator)
    static let defaultServer = "http://localhost:3001"
    #else
    static let defaultServer = "https://apivps.conditions.weiranxiong.com"
    #endif
    /// The public web app, for share links and pages the app opens in the browser.
    static let webOrigin = "https://conditions.weiranxiong.com"
    static let mcpURL = "https://apivps.conditions.weiranxiong.com/mcp"

    static var serverURL: URL {
        let raw = UserDefaults.standard.string(forKey: serverKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return URL(string: raw.isEmpty ? defaultServer : raw) ?? URL(string: defaultServer)!
    }

    static var demoMode: Bool { UserDefaults.standard.bool(forKey: demoKey) }
}

/// One event of a streamed report chat answer (the AI SDK's UI message stream).
enum ChatStreamEvent: Sendable {
    case text(String)
    case suggestions([String])
    case error(String)
}

/// The backend's HTTP API. Every decision, check, ranking and trip verdict comes from here.
/// The account session is the backend's `bc_session` cookie, kept by the shared cookie store.
struct APIClient {
    var baseURL: URL = AppSettings.serverURL
    var session: URLSession = .shared

    private func url(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    private func reachError(_ error: URLError) -> APIError {
        APIError(message: error.code == .timedOut
            ? "The server took too long to answer. Try again."
            : error.code == .cancelled ? "The request was cancelled."
            : "Can’t reach the conditions server at \(baseURL.host() ?? baseURL.absoluteString). Check Settings.")
    }

    private static func error(from data: Data, status: Int) -> APIError {
        let body = try? JSON.parse(data)
        let message = body?["details"].string ?? body?["error"].string ?? body?["message"].string ?? "The server returned an error (\(status))."
        return APIError(message: message, code: body?["code"].string, status: status, field: body?["field"].string)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw reachError(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.error(from: data, status: status) }
        return data
    }

    private func request(_ method: String, _ path: String, query: [String: String] = [:], body: JSON? = nil,
                         idempotent: Bool = false, timeout: TimeInterval = 60) -> URLRequest {
        var request = URLRequest(url: url(path, query: query), timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body.data()
        }
        if idempotent { request.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key") }
        return request
    }

    private func get(_ path: String, query: [String: String] = [:], timeout: TimeInterval = 90) async throws -> Data {
        try await send(request("GET", path, query: query, timeout: timeout))
    }

    private func post(_ path: String, body: JSON = .object([:]), idempotent: Bool = false, timeout: TimeInterval = 180) async throws -> Data {
        try await send(request("POST", path, body: body, idempotent: idempotent, timeout: timeout))
    }

    private func json(_ method: String, _ path: String, query: [String: String] = [:], body: JSON? = nil, timeout: TimeInterval = 60) async throws -> JSON {
        let data = try await send(request(method, path, query: query, body: body, timeout: timeout))
        return data.isEmpty ? .null : try JSON.parse(data)
    }

    // MARK: Service

    func health() async throws -> JSON {
        try JSON.parse(try await get("/api/healthz", timeout: 10))
    }

    func featureFlags() async throws -> JSON {
        try JSON.parse(try await get("/api/feature-flags", timeout: 15))
    }

    // MARK: Planning

    /// `GET /api/search`: the local peak catalog plus OpenStreetMap places. An empty query returns popular peaks.
    func search(_ query: String, near: (lat: Double, lon: Double)? = nil) async throws -> [Place] {
        var params = ["q": query]
        if let near { params["near"] = "\(near.lat),\(near.lon)" }
        let data = try await get("/api/search", query: params, timeout: 20)
        return try JSON.parse(data).array.compactMap { item in
            guard let name = item["name"].string, let lat = item["lat"].double, let lon = item["lon"].double else { return nil }
            return Place(name: name, lat: lat, lon: lon, elevationFt: item["elevationFt"].double, kind: item["kind"].string ?? item["type"].string)
        }
    }

    /// `GET /api/safety`: the full report, evaluated for the plan's params.
    func safety(at place: Place, params: [String: String], extra: [String: String] = [:]) async throws -> Report {
        var query = params.merging(extra) { _, new in new }
        query["lat"] = String(place.lat)
        query["lon"] = String(place.lon)
        query["name"] = place.shortName
        return try Report(data: try await get("/api/safety", query: query, timeout: 120))
    }

    /// `POST /api/evaluate`: re-evaluates a loaded report for changed plan params. Returns the new evaluation.
    func evaluate(report: JSON, params: [String: String]) async throws -> JSON {
        let plan = JSON.object(params.mapValues { .string($0) })
        let data = try await post("/api/evaluate", body: .object(["report": report, "plan": plan]), timeout: 30)
        return try JSON.parse(data)["evaluation"]
    }

    /// `GET /api/start-time-scenarios`: the same plan at other departures, ranked by the backend.
    func startTimeScenarios(place: Place, params: [String: String], extended: Bool = false) async throws -> JSON {
        var query = params
        query["lat"] = String(place.lat)
        query["lon"] = String(place.lon)
        if extended { query["set"] = "extended" }
        return try JSON.parse(try await get("/api/start-time-scenarios", query: query, timeout: 150))
    }

    /// `GET /api/day-over-day`: the plan against the same plan a day earlier.
    func dayOverDay(place: Place, params: [String: String]) async throws -> JSON {
        var query = params
        query["lat"] = String(place.lat)
        query["lon"] = String(place.lon)
        return try JSON.parse(try await get("/api/day-over-day", query: query, timeout: 120))["comparison"]
    }

    /// `POST /api/trip-forecasts`: consecutive days at one objective, ranked by the backend.
    func tripForecasts(place: Place, params: [String: String], activity: String, startDate: String, start: String, travelHours: Int, days: Int,
                       includeAvalanche: Bool = false) async throws -> JSON {
        var body: JSON = .object([
            "lat": .number(place.lat),
            "lon": .number(place.lon),
            "startDate": .string(startDate),
            "startTime": .string(start),
            "durationDays": .number(Double(days)),
            "requestedDays": .number(Double(days)),
            "travelWindowHours": .number(Double(travelHours)),
            "objectiveName": .string(place.shortName),
            "activity": .string(activity),
            "plan": .object(params.mapValues { .string($0) }),
        ])
        if includeAvalanche, case .object(var object) = body {
            object["includeAvalanche"] = .bool(true)
            body = .object(object)
        }
        return try JSON.parse(try await post("/api/trip-forecasts", body: body, idempotent: true))
    }

    func tripForecasts(plan: Plan, startDate: String, days: Int) async throws -> JSON {
        try await tripForecasts(place: plan.objective, params: plan.planParams, activity: plan.activity.rawValue,
                                startDate: startDate, start: plan.start, travelHours: plan.travelHours, days: days)
    }

    /// `POST /api/itineraries/check`: every day and camp night of a trip, and the trip's verdict.
    func itineraryCheck(plan: Plan, startDate: String? = nil) async throws -> JSON {
        try JSON.parse(try await post("/api/itineraries/check", body: plan.itineraryRequest(startDate: startDate), idempotent: true))
    }

    // MARK: Routes

    /// `GET /api/route-suggestions`: named routes to an objective.
    func routeSuggestions(peak: String, lat: Double, lon: Double) async throws -> JSON {
        try JSON.parse(try await get("/api/route-suggestions", query: ["peak": peak, "lat": String(lat), "lon": String(lon)], timeout: 60))
    }

    /// `POST /api/route-analysis`: checkpoints along a route with their forecasts. The server streams
    /// NDJSON progress lines when asked; the last line carries the result.
    func routeAnalysis(body: JSON, onProgress: @escaping (JSON) -> Void) async throws -> JSON {
        var request = request("POST", "/api/route-analysis", body: body, timeout: 240)
        request.setValue("application/x-ndjson, application/json", forHTTPHeaderField: "Accept")
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch let error as URLError {
            throw reachError(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let streaming = ((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "").contains("ndjson")
        if !streaming {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            guard (200..<300).contains(status) else { throw Self.error(from: data, status: status) }
            return try JSON.parse(data)
        }
        var last: JSON?
        for try await line in bytes.lines {
            guard let event = try? JSON.parse(Data(line.utf8)) else { continue }
            let type = event["type"].string
            if type == "result" || type == "error" { last = event } else { onProgress(event) }
        }
        guard let last else { throw APIError(message: "The route analysis stopped before it finished.") }
        if last["type"].string == "result" { return last["payload"] }
        throw APIError(message: last["error"].string ?? "The route analysis stopped before it finished.", status: last["status"].int)
    }

    // MARK: AI

    /// `POST /api/ai-brief`: a plain-language explanation of a report. Needs an account.
    func aiBrief(report: JSON, decisionLevel: String, units: Units) async throws -> String {
        let body: JSON = .object([
            "decisionLevel": .string(decisionLevel),
            "report": report,
            "units": .object(["temperature": .string(units.temperature.rawValue), "wind": .string(units.wind.rawValue),
                              "elevation": .string(units.elevation.rawValue)]),
        ])
        let json = try JSON.parse(try await post("/api/ai-brief", body: body, timeout: 90))
        guard let narrative = json["narrative"].string else { throw APIError(message: "The AI explanation came back empty.") }
        return narrative
    }

    /// `POST /api/snow-vision`: a satellite read of snow cover near the objective.
    func snowVision(lat: Double, lon: Double, snowpack: JSON, units: Units) async throws -> JSON {
        let body: JSON = .object(["lat": .number(lat), "lon": .number(lon), "snowpack": snowpack,
                                  "units": .object(["elevation": .string(units.elevation.rawValue)])])
        return try JSON.parse(try await post("/api/snow-vision", body: body, timeout: 120))
    }

    /// `POST /api/report-chat`: an answer about a report, streamed as the AI SDK's UI message stream
    /// (server-sent events of `text-delta`, `data-followUpSuggestions`, `error`).
    func reportChat(messages: [ChatMessage], report: String, contextType: String) -> AsyncThrowingStream<ChatStreamEvent, Error> {
        let body: JSON = .object([
            "id": .string(UUID().uuidString),
            "messages": .array(messages.map(\.json)),
            "trigger": .string("submit-message"),
            "report": .string(report),
            "contextType": .string(contextType),
        ])
        var request = request("POST", "/api/report-chat", body: body, timeout: 90)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let session = self.session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        throw Self.error(from: data, status: status)
                    }
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        if payload == "[DONE]" { break }
                        guard let event = try? JSON.parse(Data(payload.utf8)) else { continue }
                        switch event["type"].string {
                        case "text-delta": if let delta = event["delta"].string ?? event["textDelta"].string { continuation.yield(.text(delta)) }
                        case "data-followUpSuggestions": continuation.yield(.suggestions(event.at("data.suggestions").strings))
                        case "error": continuation.yield(.error(event["errorText"].string ?? "The report assistant is unavailable right now."))
                        default: break
                        }
                    }
                    continuation.finish()
                } catch let error as URLError {
                    continuation.finish(throwing: APIError(message: error.code == .cancelled ? "Stopped." : "The response was interrupted. You can retry your last question."))
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Account

    func session() async throws -> JSON { try await json("GET", "/api/auth/session", timeout: 20) }

    func login(email: String, password: String) async throws -> JSON {
        try await json("POST", "/api/auth/login", body: .object(["email": .string(email), "password": .string(password)]))
    }

    func register(name: String, email: String, password: String, preferences: JSON) async throws -> JSON {
        try await json("POST", "/api/auth/register", body: .object([
            "displayName": .string(name), "email": .string(email), "password": .string(password), "preferences": preferences,
        ]))
    }

    func logout() async throws -> JSON { try await json("POST", "/api/auth/logout", body: .object([:])) }

    func forgotPassword(email: String) async throws -> String? {
        try await json("POST", "/api/auth/forgot-password", body: .object(["email": .string(email)]))["message"].string
    }

    func resetPassword(token: String, password: String) async throws -> String? {
        try await json("POST", "/api/auth/reset-password", body: .object(["token": .string(token), "password": .string(password)]))["message"].string
    }

    func resendVerification() async throws -> String? {
        try await json("POST", "/api/auth/resend-verification", body: .object([:]))["message"].string
    }

    func verifyEmail(token: String) async throws -> String? {
        try await json("POST", "/api/auth/verify-email", body: .object(["token": .string(token)]))["message"].string
    }

    func savePreferences(_ preferences: JSON) async throws -> JSON {
        try await json("PATCH", "/api/account/preferences", body: .object(["preferences": preferences]))
    }

    func mcpConnections() async throws -> [JSON] {
        try await json("GET", "/api/auth/mcp/connections")["connections"].array
    }

    func mcpDisconnect(id: String, userID: String) async throws {
        _ = try await json("POST", "/api/auth/mcp/disconnect", body: .object(["id": .string(id), "userId": .string(userID)]))
    }

    // MARK: Saved reports

    func savedReports(search: String = "", aiOnly: Bool = false, cursor: String? = nil) async throws -> JSON {
        var query: [String: String] = [:]
        if !search.trimmingCharacters(in: .whitespaces).isEmpty { query["q"] = search.trimmingCharacters(in: .whitespaces) }
        if aiOnly { query["aiOnly"] = "true" }
        if let cursor { query["cursor"] = cursor }
        return try await json("GET", "/api/account/reports", query: query)
    }

    func savedReport(id: String) async throws -> JSON {
        try await json("GET", "/api/account/reports/\(id)")["report"]["snapshot"]
    }

    func sharedReport(token: String) async throws -> JSON {
        try await json("GET", "/api/reports/shared/\(token)")["report"]["snapshot"]
    }

    /// Saves a report snapshot to the account; returns its id and share token.
    func saveReport(_ snapshot: JSON) async throws -> (id: String, shareToken: String, response: JSON) {
        let json = try await json("POST", "/api/account/reports", body: .object(["report": snapshot]))
        guard let id = json.at("report.id").string, let token = json.at("report.shareToken").string else {
            throw APIError(message: "Report history returned an unexpected response.")
        }
        return (id, token, json)
    }

    func updateReport(id: String, snapshot: JSON) async throws {
        _ = try await json("PUT", "/api/account/reports/\(id)", body: .object(["report": snapshot]))
    }

    func emailReport(_ snapshot: JSON, shareToken: String) async throws -> String {
        let json = try await json("POST", "/api/account/reports/email", body: .object(["report": snapshot, "shareToken": .string(shareToken)]))
        return json["message"].string ?? "Report sent to your account email."
    }

    /// Counts one generated report against the account's monthly allowance.
    func recordReportGeneration(key: String) async throws -> JSON {
        try await json("POST", "/api/account/reports/generations", body: .object(["idempotencyKey": .string(key)]))
    }

    // MARK: Objective watches

    func watches() async throws -> JSON { try await json("GET", "/api/account/objective-watches") }

    func createWatch(_ snapshot: JSON) async throws -> JSON {
        try await json("POST", "/api/account/objective-watches", body: .object(["report": snapshot]))
    }

    func setWatchNotifications(id: String, enabled: Bool) async throws -> JSON {
        try await json("PATCH", "/api/account/objective-watches/\(id)", body: .object(["notificationsEnabled": .bool(enabled)]))
    }

    func reviewWatch(id: String) async throws -> JSON {
        try await json("POST", "/api/account/objective-watches/\(id)/review", body: .object([:]))
    }

    func refreshWatch(id: String) async throws -> JSON {
        try await json("POST", "/api/account/objective-watches/\(id)/refresh", body: .object([:]), timeout: 180)
    }

    func watchChecks(id: String) async throws -> [JSON] {
        try await json("GET", "/api/account/objective-watches/\(id)/checks")["checks"].array
    }

    func watchEvents(id: String) async throws -> [JSON] {
        try await json("GET", "/api/account/objective-watches/\(id)/events")["events"].array
    }

    func deleteWatch(id: String) async throws {
        _ = try await json("DELETE", "/api/account/objective-watches/\(id)")
    }

    // MARK: Saved trips

    func savedTrips() async throws -> [JSON] { try await json("GET", "/api/account/trips")["trips"].array }

    func saveTrip(_ trip: JSON) async throws -> JSON {
        try await json("POST", "/api/account/trips", body: .object(["trip": trip]))["trip"]
    }

    func savedTrip(id: String) async throws -> JSON { try await json("GET", "/api/account/trips/\(id)")["trip"]["snapshot"] }

    func deleteSavedTrip(id: String) async throws { _ = try await json("DELETE", "/api/account/trips/\(id)") }

    // MARK: Administration

    func admin(_ method: String, _ path: String, query: [String: String] = [:], body: JSON? = nil) async throws -> JSON {
        try await json(method, "/api/admin/\(path)", query: query, body: body ?? (method == "GET" ? nil : .object([:])), timeout: 90)
    }
}

/// A message in a report chat, in the AI SDK's UI message shape.
struct ChatMessage: Identifiable, Hashable, Codable, Sendable {
    var id = UUID().uuidString
    var role: String
    var text: String

    var json: JSON {
        .object(["id": .string(id), "role": .string(role), "parts": .array([.object(["type": .string("text"), "text": .string(text)])])])
    }

    init(role: String, text: String) {
        self.role = role
        self.text = text
    }

    /// A saved message (`{ id, role, parts: [{ type: "text", text }] }`).
    init?(json: JSON) {
        guard let role = json["role"].string, role == "user" || role == "assistant" else { return nil }
        let text = json["parts"].array.filter { $0["type"].string == "text" }.compactMap { $0["text"].string }.joined(separator: "\n")
        guard !text.isEmpty else { return nil }
        id = json["id"].string ?? UUID().uuidString
        self.role = role
        self.text = text
    }
}
