import Foundation

struct HealthCheckResponse: Decodable, Sendable {
    var ok: Bool?
    var service: String?
    var status: String?
    var version: String?
    var env: String?
    var uptime: Double?
    var nodeVersion: String?
    var heapUsedMb: Double?
    var rssMb: Double?
    var latencyMs: Double?
    var checks: [HealthCheckItem]?
    var caches: [CacheHealth]?

    struct CacheHealth: Codable, Sendable, Identifiable {
        var name: String
        var size: Int?
        var hits: Int?
        var misses: Int?
        var staleHits: Int?
        var coalesced: Int?
        var id: String { name }
    }

    enum CodingKeys: String, CodingKey {
        case ok, service, version, env, uptime, nodeVersion, memory, caches
    }

    enum MemoryKeys: String, CodingKey { case heapUsedMb, rssMb }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        ok = try values.decodeIfPresent(Bool.self, forKey: .ok)
        service = try values.decodeIfPresent(String.self, forKey: .service)
        version = try values.decodeIfPresent(String.self, forKey: .version)
        env = try values.decodeIfPresent(String.self, forKey: .env)
        uptime = try values.decodeIfPresent(Double.self, forKey: .uptime)
        nodeVersion = try values.decodeIfPresent(String.self, forKey: .nodeVersion)
        caches = try values.decodeIfPresent([CacheHealth].self, forKey: .caches)
        status = ok == true ? "ok" : "down"
        checks = nil
        latencyMs = nil
        if values.contains(.memory) {
            let memory = try values.nestedContainer(keyedBy: MemoryKeys.self, forKey: .memory)
            heapUsedMb = try memory.decodeIfPresent(Double.self, forKey: .heapUsedMb)
            rssMb = try memory.decodeIfPresent(Double.self, forKey: .rssMb)
        }
    }
}

struct HealthCheckItem: Codable, Sendable, Identifiable {
    var label: String
    var status: String
    var detail: String
    var meta: String?

    var id: String { label }

    var statusLevel: StatusLevel {
        switch status {
        case "ok": return .ok
        case "warn": return .warn
        default: return .down
        }
    }

    enum StatusLevel: String {
        case ok, warn, down
    }
}
