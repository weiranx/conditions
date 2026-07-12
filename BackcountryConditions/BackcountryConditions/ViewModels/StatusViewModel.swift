import Foundation
import Observation

@Observable
final class StatusViewModel {
    var healthResponse: HealthCheckResponse?
    var isLoading = false
    var error: String?

    private let client = APIClient.shared

    @MainActor
    func loadHealth() async {
        isLoading = true
        error = nil
        let clock = ContinuousClock()
        let started = clock.now
        do {
            var response = try await client.fetch("/api/health", type: HealthCheckResponse.self)
            let latency = started.duration(to: clock.now)
            let milliseconds = Double(latency.components.seconds) * 1_000 + Double(latency.components.attoseconds) / 1e15
            response.latencyMs = milliseconds
            var checks = [
                HealthCheckItem(label: "Backend API", status: response.ok == true ? "ok" : "down", detail: response.ok == true ? "The planning API is responding." : "The planning API reported a failure.", meta: response.version.map { "v\($0)" }),
                HealthCheckItem(label: "API Latency", status: milliseconds < 750 ? "ok" : (milliseconds < 2_000 ? "warn" : "down"), detail: milliseconds < 750 ? "Response time is normal." : "Response time is elevated.", meta: "\(Int(milliseconds)) ms"),
                HealthCheckItem(label: "Device Storage", status: "ok", detail: "Saved reports and preferences are available on this device.", meta: nil)
            ]
            if let ai = response.ai {
                let provider = ai.provider == "anthropic" ? "Anthropic" : "OpenAI"
                checks.insert(
                    HealthCheckItem(
                        label: "AI Provider",
                        status: ai.configured ? "ok" : "warn",
                        detail: ai.configured ? "\(provider) is configured for AI-powered planning features." : "\(provider) is selected, but its API key is not configured.",
                        meta: "Primary: \(ai.primaryModel) · Fast: \(ai.fastModel)"
                    ),
                    at: 2
                )
            }
            response.checks = checks
            healthResponse = response
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
