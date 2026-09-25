import Foundation

/// A decoded JSON value. Reports from `/api/safety` are large and many fields can be
/// null or missing, so the app reads them through this type instead of rigid models:
/// a missing value stays missing and is never turned into zero.
enum JSON: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSON].self) { self = .array(value) }
        else if let value = try? container.decode([String: JSON].self) { self = .object(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    static func parse(_ data: Data) throws -> JSON {
        try JSONDecoder().decode(JSON.self, from: data)
    }

    func data() -> Data {
        (try? JSONEncoder().encode(self)) ?? Data("null".utf8)
    }

    subscript(key: String) -> JSON {
        if case .object(let object) = self { return object[key] ?? .null }
        return .null
    }

    subscript(index: Int) -> JSON {
        if case .array(let array) = self, array.indices.contains(index) { return array[index] }
        return .null
    }

    /// A dotted path such as `"evaluation.decision.level"`.
    func at(_ path: String) -> JSON {
        path.split(separator: ".").reduce(self) { value, key in
            if let index = Int(key) { return value[index] }
            return value[String(key)]
        }
    }

    var isNull: Bool { self == .null }

    var string: String? {
        switch self {
        case .string(let value): return value.isEmpty ? nil : value
        case .number(let value): return value.rounded() == value ? String(Int(value)) : String(value)
        default: return nil
        }
    }

    /// Finite numbers only; numeric strings are accepted, as the backend sometimes sends them.
    var double: Double? {
        switch self {
        case .number(let value): return value.isFinite ? value : nil
        case .string(let value): return Double(value.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    var int: Int? { double.map { Int($0.rounded()) } }

    var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var array: [JSON] {
        if case .array(let value) = self { return value }
        return []
    }

    var object: [String: JSON] {
        if case .object(let value) = self { return value }
        return [:]
    }

    var strings: [String] { array.compactMap(\.string) }
}
