import XCTest
@testable import BackcountryConditions

final class DecisionEngineTests: XCTestCase {

    private func makeSafetyData(
        score: Double = 85,
        dangerLevel: Int = 1,
        windGust: Double = 20,
        precipChance: Double = 10,
        feelsLike: Double = 45,
        alertCount: Int = 0
    ) -> SafetyData {
        SafetyData(
            location: Location(lat: 40.0, lon: -105.0),
            weather: Weather(
                temp: 50,
                feelsLike: feelsLike,
                description: "Clear",
                windSpeed: 15,
                windGust: windGust,
                humidity: 30,
                cloudCover: 10,
                precipChance: precipChance
            ),
            solar: Solar(sunrise: "6:00 AM", sunset: "7:00 PM", dayLength: "13:00:00"),
            avalanche: Avalanche(risk: "Low", dangerLevel: dangerLevel),
            alerts: AlertsContainer(activeCount: alertCount),
            safety: Safety(
                score: score,
                primaryHazard: "None",
                explanations: ["Conditions look good"]
            )
        )
    }

    func testGoDecision() {
        let data = makeSafetyData()
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .go)
        XCTAssertTrue(decision.blockers.isEmpty)
    }

    func testGoWithLowScoreButNoHazards() {
        let data = makeSafetyData(score: 55)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .go, "Score alone should not drive decision level")
        XCTAssertTrue(decision.blockers.isEmpty)
        XCTAssertTrue(decision.cautions.isEmpty)
    }

    func testNoGoFromHighAvalanche() {
        let data = makeSafetyData(dangerLevel: 4)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .noGo)
    }

    func testCautionFromWind() {
        let data = makeSafetyData(windGust: 50)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .caution)
    }

    func testNoGoFromExtremeWind() {
        let data = makeSafetyData(windGust: 70)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .noGo)
    }

    func testCautionFromPrecip() {
        let data = makeSafetyData(precipChance: 60)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .caution)
    }

    func testCautionFromCold() {
        let data = makeSafetyData(feelsLike: 10)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .caution)
    }

    func testNoGoFromExtremeCold() {
        let data = makeSafetyData(feelsLike: -10)
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertEqual(decision.level, .noGo)
    }

    func testChecksPopulated() {
        let data = makeSafetyData()
        let decision = DecisionEngine.evaluate(data: data, preferences: .init())
        XCTAssertFalse(decision.checks.isEmpty)
        XCTAssertTrue(decision.checks.contains { $0.key == "wind" })
    }
}
