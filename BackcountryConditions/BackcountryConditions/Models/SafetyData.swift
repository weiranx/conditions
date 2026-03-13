import Foundation

// MARK: - Root Response

struct SafetyData: Codable, Sendable {
    var generatedAt: String?
    var partialData: Bool?
    var apiWarning: String?
    var location: Location
    var forecast: Forecast?
    var weather: Weather
    var solar: Solar
    var avalanche: Avalanche
    var alerts: AlertsContainer?
    var airQuality: AirQuality?
    var rainfall: Rainfall?
    var snowpack: Snowpack?
    var fireRisk: FireRisk?
    var heatRisk: HeatRisk?
    var gear: [GearItem]?
    var trail: String?
    var terrainCondition: TerrainCondition?
    var safety: Safety
}

// MARK: - Location

struct Location: Codable, Sendable {
    var lat: Double
    var lon: Double
}

// MARK: - Forecast

struct Forecast: Codable, Sendable {
    var selectedDate: String?
    var selectedStartTime: String?
    var selectedEndTime: String?
    var isFuture: Bool?
    var availableRange: AvailableRange?

    struct AvailableRange: Codable, Sendable {
        var start: String?
        var end: String?
    }
}

// MARK: - Weather

struct Weather: Codable, Sendable {
    var temp: Double
    var feelsLike: Double?
    var dewPoint: Double?
    var description: String
    var windSpeed: Double
    var windGust: Double
    var windDirection: String?
    var pressure: Double?
    var humidity: Double
    var cloudCover: Double?
    var precipChance: Double
    var isDaytime: Bool?
    var forecastLink: String?
    var issuedTime: String?
    var generatedTime: String?
    var timezone: String?
    var forecastStartTime: String?
    var forecastEndTime: String?
    var forecastDate: String?
    var temperatureContext24h: TemperatureContext24h?
    var visibilityRisk: VisibilityRisk?
    var trend: [WeatherTrendPoint]?
    var elevation: Double?
    var elevationUnit: String?
    var elevationSource: String?
    var elevationForecast: [ElevationForecastBand]?
    var elevationForecastNote: String?
    var sourceDetails: WeatherSourceDetails?
}

struct TemperatureContext24h: Codable, Sendable {
    var windowHours: Int?
    var timezone: String?
    var minTempF: Double?
    var maxTempF: Double?
    var overnightLowF: Double?
    var daytimeHighF: Double?
}

struct VisibilityRisk: Codable, Sendable {
    var score: Double?
    var level: String?
    var summary: String?
    var factors: [String]?
    var activeHours: Double?
    var windowHours: Double?
    var source: String?
}

struct WeatherTrendPoint: Codable, Sendable, Identifiable {
    var time: String
    var temp: Double
    var wind: Double
    var gust: Double
    var windDirection: String?
    var pressure: Double?
    var precipChance: Double?
    var humidity: Double?
    var dewPoint: Double?
    var cloudCover: Double?
    var timeIso: String?
    var isDaytime: Bool?
    var condition: String

    var id: String { time }
}

struct ElevationForecastBand: Codable, Sendable, Identifiable {
    var label: String
    var elevationFt: Double
    var deltaFromObjectiveFt: Double
    var temp: Double
    var feelsLike: Double
    var windSpeed: Double
    var windGust: Double

    var id: String { label }
}

struct WeatherSourceDetails: Codable, Sendable {
    var primary: String?
    var blended: Bool?
    var supplementalSources: [String]?
    var fieldSources: [String: String]?
}

// MARK: - Solar

struct Solar: Codable, Sendable {
    var sunrise: String
    var sunset: String
    var dayLength: String
}

// MARK: - Avalanche

struct Avalanche: Codable, Sendable {
    var risk: String
    var dangerLevel: Int
    var dangerUnknown: Bool?
    var relevant: Bool?
    var relevanceReason: String?
    var coverageStatus: String?
    var center: String?
    var zone: String?
    var problems: [AvalancheProblem]?
    var bottomLine: String?
    var advice: String?
    var link: String?
    var elevations: AvalancheElevations?
    var publishedTime: String?
    var expiresTime: String?
    var generatedTime: String?
    var staleWarning: String?
}

struct AvalancheElevations: Codable, Sendable {
    var below: AvalancheElevationBand?
    var at: AvalancheElevationBand?
    var above: AvalancheElevationBand?
}

struct AvalancheElevationBand: Codable, Sendable {
    var level: Int?
    var label: String?
}

struct AvalancheProblem: Codable, Sendable, Identifiable {
    var id: Int?
    var name: String?

    var stableId: String { "\(id ?? 0)-\(name ?? "")" }
    var likelihood: String?
    var size: AvalancheProblemSize?
    var location: AvalancheProblemLocation?
    var discussion: String?
    var problem_description: String?
    var icon: String?
}

enum AvalancheProblemSize: Codable, Sendable {
    case array([StringOrNumber])
    case single(StringOrNumber)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let arr = try? container.decode([StringOrNumber].self) {
            self = .array(arr)
        } else if let single = try? container.decode(StringOrNumber.self) {
            self = .single(single)
        } else {
            self = .single(.string(""))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .array(let arr): try container.encode(arr)
        case .single(let val): try container.encode(val)
        }
    }

    var displayString: String {
        switch self {
        case .array(let arr):
            return arr.map(\.displayString).joined(separator: "-")
        case .single(let val):
            return val.displayString
        }
    }
}

enum StringOrNumber: Codable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intVal = try? container.decode(Int.self) {
            self = .int(intVal)
        } else if let doubleVal = try? container.decode(Double.self) {
            self = .double(doubleVal)
        } else if let strVal = try? container.decode(String.self) {
            self = .string(strVal)
        } else {
            self = .string("")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .int(let i): try container.encode(i)
        case .double(let d): try container.encode(d)
        }
    }

    var displayString: String {
        switch self {
        case .string(let s): return s
        case .int(let i): return "\(i)"
        case .double(let d): return String(format: "%.1f", d)
        }
    }
}

enum AvalancheProblemLocation: Codable, Sendable {
    case array([String])
    case string(String)
    case dictionary([String: AnyCodable])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let arr = try? container.decode([String].self) {
            self = .array(arr)
        } else if let str = try? container.decode(String.self) {
            self = .string(str)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self = .dictionary(dict)
        } else {
            self = .array([])
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .array(let arr): try container.encode(arr)
        case .string(let str): try container.encode(str)
        case .dictionary(let dict): try container.encode(dict)
        }
    }
}

// MARK: - AnyCodable helper

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Bool must be decoded before Int — JSONDecoder decodes true/false as 1/0 for Int
        if let boolVal = try? container.decode(Bool.self) {
            value = boolVal
        } else if let intVal = try? container.decode(Int.self) {
            value = intVal
        } else if let doubleVal = try? container.decode(Double.self) {
            value = doubleVal
        } else if let strVal = try? container.decode(String.self) {
            value = strVal
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        // Bool must be checked before Int — Swift bridges Bool to NSNumber/Int
        if let boolVal = value as? Bool {
            try container.encode(boolVal)
        } else if let intVal = value as? Int {
            try container.encode(intVal)
        } else if let doubleVal = value as? Double {
            try container.encode(doubleVal)
        } else if let strVal = value as? String {
            try container.encode(strVal)
        } else {
            try container.encodeNil()
        }
    }
}


// MARK: - Alerts

struct AlertsContainer: Codable, Sendable {
    var source: String?
    var status: String?
    var activeCount: Int?
    var totalActiveCount: Int?
    var targetTime: String?
    var highestSeverity: String?
    var alerts: [NwsAlertItem]?
    var note: String?
    var generatedTime: String?
}

struct NwsAlertItem: Codable, Sendable, Identifiable {
    var event: String?
    var severity: String?
    var urgency: String?
    var certainty: String?
    var headline: String?
    var description: String?
    var instruction: String?
    var areaDesc: String?
    var affectedAreas: [String]?
    var senderName: String?
    var response: String?
    var messageType: String?
    var category: String?
    var sent: String?
    var onset: String?
    var ends: String?
    var effective: String?
    var expires: String?
    var link: String?

    var id: String { "\(event ?? "")|\(areaDesc ?? "")|\(onset ?? sent ?? expires ?? "")|\(headline ?? "")" }
}

// MARK: - Air Quality

struct AirQuality: Codable, Sendable {
    var source: String?
    var status: String?
    var usAqi: Int?
    var category: String?
    var pm25: Double?
    var pm10: Double?
    var ozone: Double?
    var measuredTime: String?
    var note: String?
    var generatedTime: String?
}

// MARK: - Rainfall

struct Rainfall: Codable, Sendable {
    var source: String?
    var status: String?
    var mode: String?
    var issuedTime: String?
    var anchorTime: String?
    var timezone: String?
    var expected: RainfallExpected?
    var totals: RainfallTotals?
    var note: String?
    var link: String?
    var generatedTime: String?
}

struct RainfallExpected: Codable, Sendable {
    var status: String?
    var travelWindowHours: Double?
    var startTime: String?
    var endTime: String?
    var rainWindowMm: Double?
    var rainWindowIn: Double?
    var snowWindowCm: Double?
    var snowWindowIn: Double?
    var note: String?
}

struct RainfallTotals: Codable, Sendable {
    var rainPast12hMm: Double?
    var rainPast24hMm: Double?
    var rainPast48hMm: Double?
    var rainPast12hIn: Double?
    var rainPast24hIn: Double?
    var rainPast48hIn: Double?
    var snowPast12hCm: Double?
    var snowPast24hCm: Double?
    var snowPast48hCm: Double?
    var snowPast12hIn: Double?
    var snowPast24hIn: Double?
    var snowPast48hIn: Double?
    var past12hMm: Double?
    var past24hMm: Double?
    var past48hMm: Double?
    var past12hIn: Double?
    var past24hIn: Double?
    var past48hIn: Double?
}

// MARK: - Snowpack

struct Snowpack: Codable, Sendable {
    var source: String?
    var status: String?
    var summary: String?
    var snotel: SnotelData?
    var nohrsc: NohrscData?
    var cdec: CdecData?
    var historical: SnowpackHistorical?
    var generatedTime: String?
}

struct SnotelData: Codable, Sendable {
    var source: String?
    var status: String?
    var stationTriplet: String?
    var stationId: String?
    var stationName: String?
    var networkCode: String?
    var stateCode: String?
    var distanceKm: Double?
    var elevationFt: Double?
    var observedDate: String?
    var snowDepthIn: Double?
    var sweIn: Double?
    var precipIn: Double?
    var obsTempF: Double?
    var link: String?
    var note: String?
}

struct NohrscData: Codable, Sendable {
    var source: String?
    var status: String?
    var sampledTime: String?
    var snowDepthIn: Double?
    var sweIn: Double?
    var depthMeters: Double?
    var sweMillimeters: Double?
    var depthDataset: String?
    var sweDataset: String?
    var link: String?
    var note: String?
}

struct CdecData: Codable, Sendable {
    var source: String?
    var status: String?
    var stationCode: String?
    var stationName: String?
    var elevationFt: Double?
    var distanceKm: Double?
    var snowDepthIn: Double?
    var sweIn: Double?
    var observedDate: String?
    var link: String?
    var note: String?
}

struct SnowpackHistorical: Codable, Sendable {
    var targetDate: String?
    var monthDay: String?
    var lookbackYears: Int?
    var source: String?
    var stationTriplet: String?
    var stationName: String?
    var swe: HistoricalMetric?
    var depth: HistoricalMetric?
    var overall: HistoricalOverall?
    var summary: String?
}

struct HistoricalMetric: Codable, Sendable {
    var currentIn: Double?
    var averageIn: Double?
    var status: String?
    var percentOfAverage: Double?
    var sampleCount: Int?
    var maxOffsetDays: Int?
}

struct HistoricalOverall: Codable, Sendable {
    var metric: String?
    var status: String?
    var percentOfAverage: Double?
}

// MARK: - Fire Risk

struct FireRisk: Codable, Sendable {
    var source: String?
    var status: String?
    var level: Int?
    var label: String?
    var guidance: String?
    var reasons: [String]?
    var alertsUsed: Int?
    var alertsConsidered: [FireAlertConsidered]?
}

struct FireAlertConsidered: Codable, Sendable {
    var event: String?
    var severity: String?
    var expires: String?
    var link: String?
}

// MARK: - Heat Risk

struct HeatRisk: Codable, Sendable {
    var source: String?
    var status: String?
    var level: Int?
    var label: String?
    var guidance: String?
    var reasons: [String]?
    var metrics: HeatRiskMetrics?
    var generatedTime: String?
}

struct HeatRiskMetrics: Codable, Sendable {
    var tempF: Double?
    var feelsLikeF: Double?
    var humidity: Double?
    var peakTemp12hF: Double?
    var peakFeelsLike12hF: Double?
    var lowerTerrainTempF: Double?
    var lowerTerrainFeelsLikeF: Double?
    var lowerTerrainLabel: String?
    var lowerTerrainElevationFt: Double?
    var isDaytime: Bool?
}

// MARK: - Gear

enum GearItem: Codable, Sendable {
    case simple(String)
    case detailed(GearDetail)

    struct GearDetail: Codable, Sendable {
        var id: String?
        var title: String
        var detail: String
        var category: String
        var tone: String
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let str = try? container.decode(String.self) {
            self = .simple(str)
        } else {
            let detail = try container.decode(GearDetail.self)
            self = .detailed(detail)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .simple(let str): try container.encode(str)
        case .detailed(let detail): try container.encode(detail)
        }
    }

    var title: String {
        switch self {
        case .simple(let str): return str
        case .detailed(let d): return d.title
        }
    }

    var detail: String? {
        switch self {
        case .simple: return nil
        case .detailed(let d): return d.detail
        }
    }

    var category: String {
        switch self {
        case .simple: return "General"
        case .detailed(let d): return d.category
        }
    }

    var tone: String {
        switch self {
        case .simple: return "neutral"
        case .detailed(let d): return d.tone
        }
    }
}

// MARK: - Terrain Condition

struct TerrainCondition: Codable, Sendable {
    var code: String?
    var label: String?
    var impact: String?
    var recommendedTravel: String?
    var footwear: String?
    var snowProfile: SnowProfile?
    var confidence: String?
    var summary: String?
    var reasons: [String]?
    var signals: TerrainSignals?
}

struct SnowProfile: Codable, Sendable {
    var code: String?
    var label: String?
    var summary: String?
    var confidence: String?
    var reasons: [String]?
}

struct TerrainSignals: Codable, Sendable {
    var tempF: Double?
    var precipChance: Double?
    var humidity: Double?
    var windMph: Double?
    var gustMph: Double?
    var wetTrendHours: Double?
    var snowTrendHours: Double?
    var rain12hIn: Double?
    var rain24hIn: Double?
    var rain48hIn: Double?
    var snow12hIn: Double?
    var snow24hIn: Double?
    var snow48hIn: Double?
    var expectedRainWindowIn: Double?
    var expectedSnowWindowIn: Double?
    var maxSnowDepthIn: Double?
    var maxSweIn: Double?
    var snotelDistanceKm: Double?
}

// MARK: - Safety Score

struct Safety: Codable, Sendable {
    var score: Double
    var confidence: Double?
    var primaryHazard: String
    var explanations: [String]
    var sourcesUsed: [String]?
    var factors: [SafetyFactor]?
    var groupImpacts: [String: GroupImpact]?
    var confidenceReasons: [String]?
    var airQualityCategory: String?
}

struct SafetyFactor: Codable, Sendable, Identifiable {
    var hazard: String?
    var impact: Double?
    var source: String?
    var message: String?

    var id: String { (hazard ?? "") + (message ?? "") }
}

struct GroupImpact: Codable, Sendable {
    var raw: Double?
    var capped: Double?
    var cap: Double?
}
