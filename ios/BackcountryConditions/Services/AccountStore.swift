import Foundation
import Observation

/// A signed-in account, as `/api/auth/session` returns it.
struct AccountUser: Hashable, Sendable {
    var id: String
    var email: String
    var displayName: String
    var createdAt: String
    var emailVerified: Bool
    var preferences: JSON

    init?(json: JSON) {
        guard let id = json["id"].string, let email = json["email"].string, let name = json["displayName"].string else { return nil }
        self.id = id
        self.email = email
        displayName = name
        createdAt = json["createdAt"].string ?? ""
        emailVerified = json["emailVerified"].bool ?? false
        preferences = json["preferences"]
    }

    var initial: String { displayName.first.map { String($0).uppercased() } ?? "?" }
}

/// One monthly allowance: reports, multi-day checks or AI tokens.
struct Allowance: Sendable {
    var used: Double?
    var limit: Double?
    var remaining: Double?
    var unlimited: Bool
    var resetAt: String?
    var exhausted: Bool

    init?(json: JSON, used: String, limit: String, remaining: String) {
        guard case .object = json else { return nil }
        self.used = json[used].double
        self.limit = json[limit].double
        self.remaining = json[remaining].double
        unlimited = json["unlimited"].bool ?? false
        resetAt = json["resetAt"].string
        exhausted = json["exhausted"].bool ?? (!unlimited && (json[remaining].double ?? 1) <= 0)
    }
}

/// The product features the server has on (`/api/feature-flags`). Unknown means on.
struct FeatureFlags: Sendable {
    var values: [String: Bool] = [:]

    func on(_ key: String) -> Bool { values[key] ?? true }

    var tripPlanning: Bool { on("tripPlanning") }
    var routeAnalysis: Bool { on("routeAnalysis") }
    var objectiveWatch: Bool { on("objectiveWatch") }
    var gpxImport: Bool { on("gpxImport") }
    var reportHistory: Bool { on("reportHistory") }
    var reportSharing: Bool { on("reportSharing") }
    var startTimeComparisons: Bool { on("startTimeComparisons") }
    var gearRecommendations: Bool { on("gearRecommendations") }
    var satelliteImagery: Bool { on("satelliteImagery") }
    var contingencyPlanning: Bool { on("contingencyPlanning") }
    var scoreBreakdown: Bool { on("scoreBreakdown") }
    var terrainWindow: Bool { on("terrainWindow") }

    static let keys = ["tripPlanning", "routeAnalysis", "satelliteImagery", "startTimeComparisons", "terrainWindow", "objectiveWatch",
                       "gpxImport", "reportHistory", "reportSharing", "hourlyWeatherCharts", "elevationForecast", "heatRiskDetails",
                       "fireRiskDetails", "snowpackDetails", "fieldObservations", "airQualityDetails", "gearRecommendations",
                       "windLoadingDetails", "daylightTimeline", "contingencyPlanning", "scoreBreakdown", "weatherContextDetails",
                       "avalancheDetails"]
}

/// Which AI features the server can run right now (`/api/healthz` → `ai.features`).
struct AIAvailability: Sendable {
    var aiBrief = false
    var reportChat = false
    var routeAnalysis = false
    var snowVision = false
    var known = false

    init() {}

    init?(health: JSON) {
        let ai = health["ai"]
        guard let available = ai["available"].bool else { return nil }
        let feature: (String) -> Bool = { ai.at("features.\($0).available").bool ?? available }
        aiBrief = feature("aiBrief")
        reportChat = feature("reportChat")
        routeAnalysis = feature("routeAnalysis")
        snowVision = feature("snowVision")
        known = true
    }
}

/// The account session, allowances, feature flags and AI availability. The session itself is the
/// backend's cookie; this mirrors what `/api/auth/session` says about it.
@Observable
final class AccountStore {
    static let shared = AccountStore()
    static let adminEmail = "weiranxiong@gmail.com"
    static let guestReportLimit = 10
    private static let guestCountKey = "guestReportCount.v1"

    private(set) var loading = false
    /// False when the server has accounts turned off; nil before the first answer.
    private(set) var available: Bool?
    private(set) var user: AccountUser?
    private(set) var tierKey: String?
    private(set) var tierLabel: String?
    private(set) var tierPeriodEnd: String?
    private(set) var tierCancelsAtPeriodEnd = false
    private(set) var reportCount: Int?
    private(set) var reportUsage: Allowance?
    private(set) var multiDayUsage: Allowance?
    private(set) var aiUsage: Allowance?
    private(set) var flags = FeatureFlags()
    private(set) var ai = AIAvailability()
    private(set) var syncError: String?
    var guestReportCount: Int = UserDefaults.standard.integer(forKey: AccountStore.guestCountKey) {
        didSet { UserDefaults.standard.set(guestReportCount, forKey: Self.guestCountKey) }
    }

    @ObservationIgnored private var preferenceOwner: String?
    @ObservationIgnored private var syncTask: Task<Void, Never>?

    private init() {
        PreferencesStore.shared.onChange = { [weak self] preferences in self?.schedulePreferenceSync(preferences) }
    }

    var signedIn: Bool { user != nil }
    var isAdmin: Bool { user?.email.lowercased() == Self.adminEmail }
    var isPremium: Bool { tierKey == "premium" }

    // MARK: Loading

    /// Reads the session, feature flags and AI availability. Safe to call often.
    func refresh() async {
        loading = true
        defer { loading = false }
        async let flags: Void = refreshFlags()
        async let ai: Void = refreshAI()
        do {
            apply(try await APIClient().session())
        } catch {
            // Keep what we knew; the account screen offers a retry.
        }
        _ = await (flags, ai)
    }

    func refreshFlags() async {
        guard let json = try? await APIClient().featureFlags() else { return }
        var values: [String: Bool] = [:]
        for key in FeatureFlags.keys { if let value = json[key].bool { values[key] = value } }
        flags = FeatureFlags(values: values)
    }

    func refreshAI() async {
        guard let health = try? await APIClient().health(), let availability = AIAvailability(health: health) else { return }
        ai = availability
    }

    /// Applies an account response (`/api/auth/session`, login, register, preferences).
    private func apply(_ json: JSON) {
        available = json["available"].bool ?? available
        let next = json["authenticated"].bool == true ? AccountUser(json: json["user"]) : nil
        user = next
        tierKey = json.at("accountTier.key").string
        tierLabel = json.at("accountTier.label").string
        tierPeriodEnd = json.at("accountTier.currentPeriodEnd").string
        tierCancelsAtPeriodEnd = json.at("accountTier.cancelAtPeriodEnd").bool ?? false
        reportCount = json["reportCount"].int
        reportUsage = Allowance(json: json["reportUsage"], used: "usedReports", limit: "limitReports", remaining: "remainingReports")
        multiDayUsage = Allowance(json: json["multiDayUsage"], used: "usedRuns", limit: "limitRuns", remaining: "remainingRuns")
        aiUsage = Allowance(json: json["aiUsage"], used: "usedTokens", limit: "limitTokens", remaining: "remainingTokens")
        adoptPreferences()
    }

    /// Adopts a signed-in account's saved preferences once per account, or seeds an account that
    /// has none with this device's (as the web app does).
    private func adoptPreferences() {
        guard let user else {
            preferenceOwner = nil
            return
        }
        guard preferenceOwner != user.id else { return }
        preferenceOwner = user.id
        if Preferences.stored(in: user.preferences) {
            PreferencesStore.shared.adopt(Preferences(web: user.preferences))
        } else {
            schedulePreferenceSync(PreferencesStore.shared.preferences, delay: 0)
        }
    }

    // MARK: Signing in

    func signIn(email: String, password: String) async throws {
        apply(try await APIClient().login(email: email.trimmingCharacters(in: .whitespaces), password: password))
    }

    func register(name: String, email: String, password: String) async throws {
        apply(try await APIClient().register(name: name.trimmingCharacters(in: .whitespaces), email: email.trimmingCharacters(in: .whitespaces),
                                             password: password, preferences: PreferencesStore.shared.preferences.web))
    }

    func signOut() async throws {
        syncTask?.cancel()
        if user != nil { _ = try? await APIClient().savePreferences(PreferencesStore.shared.preferences.web) }
        apply(try await APIClient().logout())
        // The session cookie is the server's; drop any copy the cookie store kept.
        let server = AppSettings.serverURL
        for cookie in HTTPCookieStorage.shared.cookies(for: server) ?? [] where cookie.name == "bc_session" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func requestPasswordReset(email: String) async throws -> String {
        try await APIClient().forgotPassword(email: email.trimmingCharacters(in: .whitespaces))
            ?? "If a password account exists for that email, a reset link will arrive shortly."
    }

    func resetPassword(token: String, password: String) async throws -> String {
        try await APIClient().resetPassword(token: token, password: password) ?? "Your password has been reset. Sign in with your new password."
    }

    func resendVerification() async throws -> String {
        try await APIClient().resendVerification() ?? "Verification email sent."
    }

    func verifyEmail(token: String) async throws -> String {
        let message = try await APIClient().verifyEmail(token: token) ?? "Your email address has been verified."
        await refresh()
        return message
    }

    // MARK: Preferences sync

    private func schedulePreferenceSync(_ preferences: Preferences, delay: Double = 1.2) {
        guard user != nil else { return }
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            do {
                let response = try await APIClient().savePreferences(preferences.web)
                self?.syncError = nil
                self?.applyUsage(response)
            } catch {
                self?.syncError = error.localizedDescription
            }
        }
    }

    /// Takes allowances from a response without re-adopting preferences.
    private func applyUsage(_ json: JSON) {
        if let count = json["reportCount"].int { reportCount = count }
        if let usage = Allowance(json: json["reportUsage"], used: "usedReports", limit: "limitReports", remaining: "remainingReports") { reportUsage = usage }
        if let usage = Allowance(json: json["multiDayUsage"], used: "usedRuns", limit: "limitRuns", remaining: "remainingRuns") { multiDayUsage = usage }
        if let usage = Allowance(json: json["aiUsage"], used: "usedTokens", limit: "limitTokens", remaining: "remainingTokens") { aiUsage = usage }
    }

    // MARK: Allowances

    /// Why a new report can't be generated now, or nil when it can (the web's `requestNewReportAccess`).
    var newReportBlocker: String? {
        if user != nil {
            return reportUsage?.exhausted == true
                ? "Your monthly report allowance is used up. It resets automatically; see Account for details."
                : nil
        }
        return guestReportCount >= Self.guestReportLimit
            ? "You’ve used the \(Self.guestReportLimit) reports available without an account. Sign in or create a free account to keep planning."
            : nil
    }

    /// Counts one newly generated report: against the account's allowance, or the guest count.
    func countNewReport() {
        if user != nil {
            Task { [weak self] in
                guard let response = try? await APIClient().recordReportGeneration(key: UUID().uuidString) else { return }
                self?.applyUsage(response)
            }
        } else {
            guestReportCount = min(Self.guestReportLimit, guestReportCount + 1)
        }
    }

    /// Takes allowances a saved-report or other account response carried.
    func noteUsage(_ json: JSON) { applyUsage(json) }
}
