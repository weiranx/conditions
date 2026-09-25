import Foundation

struct APIError: LocalizedError {
    let message: String
    var code: String?
    var status: Int?

    var errorDescription: String? { message }

    /// Multi-day checks need the server's usage service (accounts and a database).
    var multiDayUnavailable: Bool {
        code == "MULTI_DAY_USAGE_UNAVAILABLE" || (status == 503 && message.localizedCaseInsensitiveContains("multi-day"))
    }
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

    static var serverURL: URL {
        let raw = UserDefaults.standard.string(forKey: serverKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return URL(string: raw.isEmpty ? defaultServer : raw) ?? URL(string: defaultServer)!
    }

    static var demoMode: Bool { UserDefaults.standard.bool(forKey: demoKey) }
}

/// The backend's HTTP API. Every decision, check, ranking and trip verdict comes from here.
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

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw APIError(message: error.code == .timedOut
                ? "The server took too long to answer. Try again."
                : "Can’t reach the conditions server at \(baseURL.host() ?? baseURL.absoluteString). Check Settings.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let body = try? JSON.parse(data)
            throw APIError(message: body?["error"].string ?? "The server returned an error (\(status)).",
                           code: body?["code"].string, status: status)
        }
        return data
    }

    private func get(_ path: String, query: [String: String] = [:], timeout: TimeInterval = 90) async throws -> Data {
        var request = URLRequest(url: url(path, query: query), timeoutInterval: timeout)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func post(_ path: String, body: JSON, idempotent: Bool = false, timeout: TimeInterval = 180) async throws -> Data {
        var request = URLRequest(url: url(path), timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if idempotent { request.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key") }
        request.httpBody = body.data()
        return try await send(request)
    }

    // MARK: Endpoints

    func health() async throws -> JSON {
        try JSON.parse(try await get("/api/healthz", timeout: 10))
    }

    /// `GET /api/search`: the local peak catalog plus OpenStreetMap places. An empty query returns popular peaks.
    func search(_ query: String) async throws -> [Place] {
        let data = try await get("/api/search", query: ["q": query], timeout: 20)
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

    /// `POST /api/evaluate`: re-evaluates a loaded report for changed plan params
    /// (here, a different elevation to check). Returns the new evaluation.
    func evaluate(report: JSON, params: [String: String]) async throws -> JSON {
        let plan = JSON.object(params.mapValues { .string($0) })
        let data = try await post("/api/evaluate", body: .object(["report": report, "plan": plan]), timeout: 30)
        return try JSON.parse(data)["evaluation"]
    }

    /// `GET /api/start-time-scenarios`: the same plan at other departures, ranked by the backend.
    func startTimeScenarios(place: Place, params: [String: String]) async throws -> JSON {
        var query = params
        query["lat"] = String(place.lat)
        query["lon"] = String(place.lon)
        return try JSON.parse(try await get("/api/start-time-scenarios", query: query, timeout: 150))
    }

    /// `POST /api/trip-forecasts`: consecutive days at one objective, ranked by the backend.
    func tripForecasts(plan: Plan, startDate: String, days: Int) async throws -> JSON {
        let body: JSON = .object([
            "lat": .number(plan.objective.lat),
            "lon": .number(plan.objective.lon),
            "startDate": .string(startDate),
            "startTime": .string(plan.start),
            "durationDays": .number(Double(days)),
            "requestedDays": .number(Double(days)),
            "travelWindowHours": .number(Double(plan.travelHours)),
            "objectiveName": .string(plan.objective.shortName),
            "activity": .string(plan.activity.rawValue),
            "plan": .object(plan.planParams.mapValues { .string($0) }),
        ])
        return try JSON.parse(try await post("/api/trip-forecasts", body: body, idempotent: true))
    }

    /// `POST /api/itineraries/check`: every day and camp night of a trip, and the trip's verdict.
    func itineraryCheck(plan: Plan) async throws -> JSON {
        let point: (Place) -> JSON = { place in
            var object: [String: JSON] = ["name": .string(place.shortName), "lat": .number(place.lat), "lon": .number(place.lon)]
            if let ft = place.elevationFt { object["elevationFt"] = .number(ft) }
            return .object(object)
        }
        let stages: [JSON] = (plan.stages ?? []).map { stage in
            .object(["start": .string(stage.start), "travelHours": .number(Double(stage.travelHours)), "from": point(stage.from), "to": point(stage.to)])
        }
        let body: JSON = .object([
            "startDate": .string(plan.date),
            "name": .string(plan.objective.shortName),
            "activity": .string(plan.activity.rawValue),
            "plan": .object(plan.planParams.mapValues { .string($0) }),
            "stages": .array(stages),
        ])
        return try JSON.parse(try await post("/api/itineraries/check", body: body, idempotent: true))
    }
}
