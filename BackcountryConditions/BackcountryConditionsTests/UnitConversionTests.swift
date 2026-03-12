import XCTest
@testable import BackcountryConditions

final class UnitConversionTests: XCTestCase {

    // MARK: - Temperature

    func testFahrenheitPassthrough() {
        XCTAssertEqual(convertTempFToDisplay(72, unit: .fahrenheit), 72)
    }

    func testFahrenheitToCelsius() {
        let result = convertTempFToDisplay(32, unit: .celsius)
        XCTAssertEqual(result, 0, accuracy: 0.01)
    }

    func testCelsiusToFahrenheit() {
        let result = convertDisplayTempToF(100, unit: .celsius)
        XCTAssertEqual(result, 212, accuracy: 0.01)
    }

    func testFormatTemperatureFahrenheit() {
        XCTAssertEqual(formatTemperature(72, unit: .fahrenheit), "72°F")
    }

    func testFormatTemperatureCelsius() {
        XCTAssertEqual(formatTemperature(32, unit: .celsius), "0°C")
    }

    func testFormatTemperatureNil() {
        XCTAssertEqual(formatTemperature(nil, unit: .fahrenheit), "N/A")
    }

    // MARK: - Wind

    func testMphPassthrough() {
        XCTAssertEqual(convertWindMphToDisplay(30, unit: .mph), 30)
    }

    func testMphToKph() {
        let result = convertWindMphToDisplay(10, unit: .kph)
        XCTAssertEqual(result, 16.0934, accuracy: 0.01)
    }

    func testFormatWindMph() {
        XCTAssertEqual(formatWind(25, unit: .mph), "25 mph")
    }

    func testFormatWindKph() {
        XCTAssertEqual(formatWind(10, unit: .kph), "16 kph")
    }

    // MARK: - Elevation

    func testFeetPassthrough() {
        XCTAssertEqual(convertElevationFtToDisplay(14000, unit: .feet), 14000)
    }

    func testFeetToMeters() {
        let result = convertElevationFtToDisplay(14000, unit: .meters)
        XCTAssertEqual(result, 4267.2, accuracy: 0.1)
    }

    func testFormatElevationFeet() {
        let result = formatElevation(14000, unit: .feet)
        XCTAssertTrue(result.contains("14,000") || result.contains("14000"))
        XCTAssertTrue(result.contains("ft"))
    }

    func testFormatElevationMeters() {
        let result = formatElevation(14000, unit: .meters)
        XCTAssertTrue(result.contains("m"))
    }

    func testFormatElevationDelta() {
        XCTAssertEqual(formatElevationDelta(0, unit: .feet), "objective")
        let result = formatElevationDelta(1000, unit: .feet)
        XCTAssertTrue(result.hasPrefix("+"))
    }

    // MARK: - Snow / Rain

    func testFormatSnowDepthFeet() {
        XCTAssertEqual(formatSnowDepth(24, unit: .feet), "24 in")
    }

    func testFormatSnowDepthMeters() {
        XCTAssertEqual(formatSnowDepth(24, unit: .meters), "61 cm")
    }

    func testFormatSweImperial() {
        XCTAssertEqual(formatSwe(5.2, unit: .feet), "5.2 in SWE")
    }

    func testFormatSweMetric() {
        let result = formatSwe(1.0, unit: .meters)
        XCTAssertTrue(result.contains("mm SWE"))
    }
}
