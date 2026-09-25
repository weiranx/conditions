import Foundation
import UserNotifications

extension Notification.Name {
    /// Posted with a plan's `UUID` as the object when a notification or widget asks to open it.
    static let openPlan = Notification.Name("ConditionsOpenPlan")
}

/// Local notifications for watched plans whose decision changed on a check.
enum Notifier {
    static func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    static func decisionChanged(_ plan: Plan, from old: DecisionLevel, to new: DecisionLevel, reason: String?) {
        let content = UNMutableNotificationContent()
        content.title = "\(plan.objective.shortName): \(headline(from: old, to: new))"
        content.body = ["\(old.label) → \(new.label).", reason].compactMap { $0 }.joined(separator: " ")
        content.sound = .default
        content.userInfo = ["planID": plan.id.uuidString]
        let request = UNNotificationRequest(identifier: "watch-\(plan.id.uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Wording only: the levels themselves are the backend's.
    private static func headline(from old: DecisionLevel, to new: DecisionLevel) -> String {
        if new == .unknown { return "couldn’t be fully checked" }
        if old == .unknown { return "decision changed" }
        return new.severity > old.severity ? "risk increased" : "risk eased"
    }
}

/// Shows watch notifications while the app is open, and opens the plan when one is tapped.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let text = response.notification.request.content.userInfo["planID"] as? String, let id = UUID(uuidString: text) else { return }
        await MainActor.run { NotificationCenter.default.post(name: .openPlan, object: id) }
    }
}
