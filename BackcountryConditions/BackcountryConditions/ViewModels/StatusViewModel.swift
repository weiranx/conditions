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
        do {
            healthResponse = try await client.fetch("/api/health", type: HealthCheckResponse.self)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
