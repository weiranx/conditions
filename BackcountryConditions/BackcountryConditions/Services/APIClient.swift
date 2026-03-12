import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case networkError(Error)
    case httpError(statusCode: Int, message: String?)
    case decodingError(Error)
    case noData
    case serverUnreachable

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let code, let message):
            return message ?? "HTTP error \(code)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .noData:
            return "No data received"
        case .serverUnreachable:
            return "Unable to reach the server"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let baseURL: String
    private let decoder: JSONDecoder

    private static let retryableStatusCodes: Set<Int> = [408, 429, 502, 503]
    private static let maxRetries = 2
    private static let retryDelays: [UInt64] = [1_000_000_000, 2_000_000_000] // 1s, 2s in nanoseconds

    init(baseURL: String = Configuration.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.session = session
        self.decoder = JSONDecoder()
    }

    // MARK: - Core Request

    func fetch<T: Decodable>(_ path: String, type: T.Type) async throws -> T {
        let data = try await fetchRaw(path)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func fetchRaw(_ path: String) async throws -> Data {
        guard let url = buildURL(path) else {
            throw APIError.invalidURL
        }

        var lastError: Error?

        for attempt in 0...Self.maxRetries {
            do {
                let (data, response) = try await session.data(from: url)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.noData
                }

                if Self.retryableStatusCodes.contains(httpResponse.statusCode), attempt < Self.maxRetries {
                    try await Task.sleep(nanoseconds: Self.retryDelays[attempt])
                    continue
                }

                guard (200...299).contains(httpResponse.statusCode) else {
                    let message = extractErrorMessage(from: data)
                    throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
                }

                return data
            } catch let error as APIError {
                throw error
            } catch {
                lastError = error
                if attempt < Self.maxRetries {
                    try await Task.sleep(nanoseconds: Self.retryDelays[attempt])
                    continue
                }
            }
        }

        throw APIError.networkError(lastError ?? URLError(.unknown))
    }

    func post<T: Decodable>(_ path: String, body: Encodable, type: T.Type) async throws -> T {
        guard let url = buildURL(path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        var lastError: Error?

        for attempt in 0...Self.maxRetries {
            do {
                let (data, response) = try await session.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.noData
                }

                if Self.retryableStatusCodes.contains(httpResponse.statusCode), attempt < Self.maxRetries {
                    try await Task.sleep(nanoseconds: Self.retryDelays[attempt])
                    continue
                }

                guard (200...299).contains(httpResponse.statusCode) else {
                    let message = extractErrorMessage(from: data)
                    throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
                }

                return try decoder.decode(T.self, from: data)
            } catch let error as APIError {
                throw error
            } catch let error as DecodingError {
                throw APIError.decodingError(error)
            } catch {
                lastError = error
                if attempt < Self.maxRetries {
                    try await Task.sleep(nanoseconds: Self.retryDelays[attempt])
                    continue
                }
            }
        }

        throw APIError.networkError(lastError ?? URLError(.unknown))
    }

    // MARK: - Helpers

    private func buildURL(_ path: String) -> URL? {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(baseURL)\(normalizedPath)")
    }

    private func extractErrorMessage(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return (json["details"] as? String) ?? (json["error"] as? String)
    }
}
