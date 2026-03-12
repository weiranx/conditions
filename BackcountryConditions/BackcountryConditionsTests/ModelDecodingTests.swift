import XCTest
@testable import BackcountryConditions

final class ModelDecodingTests: XCTestCase {

    func testMinimalSafetyDataDecoding() throws {
        let json = """
        {
            "location": {"lat": 40.2549, "lon": -105.615},
            "weather": {
                "temp": 45,
                "description": "Clear",
                "windSpeed": 12,
                "windGust": 25,
                "humidity": 35,
                "cloudCover": 10,
                "precipChance": 5
            },
            "solar": {"sunrise": "6:15 AM", "sunset": "7:30 PM", "dayLength": "13:15:00"},
            "avalanche": {"risk": "Low", "dangerLevel": 1},
            "safety": {
                "score": 82,
                "primaryHazard": "Wind",
                "explanations": ["Light wind expected"]
            }
        }
        """
        let data = try JSONDecoder().decode(SafetyData.self, from: Data(json.utf8))
        XCTAssertEqual(data.location.lat, 40.2549)
        XCTAssertEqual(data.weather.temp, 45)
        XCTAssertEqual(data.avalanche.dangerLevel, 1)
        XCTAssertEqual(data.safety.score, 82)
    }

    func testFullSafetyDataWithOptionals() throws {
        let json = """
        {
            "generatedAt": "2026-03-11T10:00:00Z",
            "partialData": false,
            "location": {"lat": 46.8523, "lon": -121.7603},
            "weather": {
                "temp": 28,
                "feelsLike": 18,
                "description": "Snow Showers",
                "windSpeed": 25,
                "windGust": 45,
                "windDirection": "NW",
                "humidity": 80,
                "cloudCover": 90,
                "precipChance": 70,
                "trend": [
                    {"time": "6:00 AM", "temp": 25, "wind": 20, "gust": 35, "condition": "Snow"},
                    {"time": "7:00 AM", "temp": 26, "wind": 22, "gust": 40, "condition": "Snow"}
                ]
            },
            "solar": {"sunrise": "6:30 AM", "sunset": "6:15 PM", "dayLength": "11:45:00"},
            "avalanche": {
                "risk": "Considerable",
                "dangerLevel": 3,
                "relevant": true,
                "center": "NWAC",
                "zone": "Mt Rainier",
                "problems": [
                    {"name": "Wind Slab", "likelihood": "Likely", "size": [2, 3]}
                ],
                "elevations": {
                    "below": {"level": 2, "label": "Moderate"},
                    "at": {"level": 3, "label": "Considerable"},
                    "above": {"level": 3, "label": "Considerable"}
                }
            },
            "alerts": {
                "activeCount": 1,
                "alerts": [
                    {"event": "Winter Storm Warning", "severity": "Severe", "headline": "Heavy snow expected"}
                ]
            },
            "airQuality": {"usAqi": 42, "category": "Good"},
            "fireRisk": {"level": 1, "label": "Minimal"},
            "heatRisk": {"level": 1, "label": "Minimal"},
            "gear": [
                "Ice axe",
                {"title": "Avalanche beacon", "detail": "Required in avalanche terrain", "category": "Safety", "tone": "critical"}
            ],
            "terrainCondition": {
                "code": "snow_packed",
                "label": "Packed Snow",
                "impact": "moderate",
                "footwear": "Mountaineering boots with crampons"
            },
            "safety": {
                "score": 48,
                "confidence": 75,
                "primaryHazard": "Avalanche",
                "explanations": ["Considerable avalanche danger", "Winter storm warning active"],
                "factors": [
                    {"hazard": "Avalanche", "impact": -25, "message": "Considerable danger"}
                ]
            }
        }
        """
        let data = try JSONDecoder().decode(SafetyData.self, from: Data(json.utf8))
        XCTAssertEqual(data.generatedAt, "2026-03-11T10:00:00Z")
        XCTAssertEqual(data.weather.trend?.count, 2)
        XCTAssertEqual(data.avalanche.problems?.first?.name, "Wind Slab")
        XCTAssertEqual(data.alerts?.alerts?.first?.event, "Winter Storm Warning")
        XCTAssertEqual(data.gear?.count, 2)
        XCTAssertEqual(data.safety.factors?.first?.impact, -25)
    }

    func testGearItemDecoding() throws {
        let simpleJson = "\"Ice axe\""
        let simple = try JSONDecoder().decode(GearItem.self, from: Data(simpleJson.utf8))
        XCTAssertEqual(simple.title, "Ice axe")
        XCTAssertNil(simple.detail)

        let detailedJson = """
        {"title": "Beacon", "detail": "Required", "category": "Safety", "tone": "critical"}
        """
        let detailed = try JSONDecoder().decode(GearItem.self, from: Data(detailedJson.utf8))
        XCTAssertEqual(detailed.title, "Beacon")
        XCTAssertEqual(detailed.detail, "Required")
        XCTAssertEqual(detailed.category, "Safety")
    }

    func testAvalancheProblemSizeDecoding() throws {
        let arrayJson = "[2, 3]"
        let array = try JSONDecoder().decode(AvalancheProblemSize.self, from: Data(arrayJson.utf8))
        XCTAssertEqual(array.displayString, "2-3")

        let singleJson = "\"D2\""
        let single = try JSONDecoder().decode(AvalancheProblemSize.self, from: Data(singleJson.utf8))
        XCTAssertEqual(single.displayString, "D2")
    }

    func testSearchResultCreation() {
        let result = SearchResult(name: "Mount Rainier, Washington", lat: 46.8523, lon: -121.7603, resultClass: "popular", type: "peak")
        XCTAssertEqual(result.name, "Mount Rainier, Washington")
        XCTAssertFalse(result.id.isEmpty)
    }

    func testUserPreferencesDefaultValues() {
        let prefs = UserPreferences()
        XCTAssertEqual(prefs.temperatureUnit, .fahrenheit)
        XCTAssertEqual(prefs.elevationUnit, .feet)
        XCTAssertEqual(prefs.windSpeedUnit, .mph)
        XCTAssertEqual(prefs.maxWindGustMph, 40)
        XCTAssertEqual(prefs.defaultStartTime, "04:30")
    }

    func testUserPreferencesEncodingRoundtrip() throws {
        var prefs = UserPreferences()
        prefs.temperatureUnit = .celsius
        prefs.elevationUnit = .meters
        prefs.maxWindGustMph = 50

        let data = try JSONEncoder().encode(prefs)
        let decoded = try JSONDecoder().decode(UserPreferences.self, from: data)
        XCTAssertEqual(decoded.temperatureUnit, .celsius)
        XCTAssertEqual(decoded.elevationUnit, .meters)
        XCTAssertEqual(decoded.maxWindGustMph, 50)
    }
}
