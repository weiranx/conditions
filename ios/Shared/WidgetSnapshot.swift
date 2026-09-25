import Foundation

/// One upcoming plan as the widgets show it: the backend's latest decision, already worded by the app.
struct WidgetPlan: Codable, Hashable, Identifiable, Sendable {
    var id: UUID
    var name: String
    /// "Sat, Sep 26 · 3:00 AM", or "Jun 4–7 · 4 days" for a trip.
    var when: String
    var level: DecisionLevel
    /// Replaces the level's word, e.g. "No trip verdict".
    var levelLabel: String?
    /// One line on what limits the plan, when there is one.
    var line: String?
    var tiles: [SkyTile]
    var stripStart: String?
    var stripEnd: String?
    var checkedAt: Date?
    var watched: Bool

    var levelText: String { levelLabel ?? level.label }
}

/// What the app last told the widgets, kept in the shared App Group container.
struct WidgetSnapshot: Codable, Sendable {
    var plans: [WidgetPlan]
    var updatedAt: Date

    static let appGroup = "group.app.summitsafe.conditions"
    static let widgetKind = "ConditionsNextPlan"

    private static var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appending(path: "widget-snapshot.json")
    }

    static func load() -> WidgetSnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let url = Self.fileURL, let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

/// `conditions://plan/<id>` opens a plan's brief, from a widget or a notification.
enum DeepLink {
    static func plan(_ id: UUID) -> URL {
        URL(string: "conditions://plan/\(id.uuidString)")!
    }

    static func planID(from url: URL) -> UUID? {
        guard url.scheme == "conditions", url.host() == "plan" else { return nil }
        return UUID(uuidString: url.lastPathComponent)
    }
}
