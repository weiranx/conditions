import XCTest
@testable import BackcountryConditions

final class DateFormattingTests: XCTestCase {

    func testFormatDateInput() {
        let date = Date(timeIntervalSince1970: 0) // 1970-01-01
        let result = DateFormatting.formatDateInput(date)
        XCTAssertTrue(result.contains("1970"))
    }

    func testAddDays() {
        let result = DateFormatting.addDays(to: "2026-03-01", days: 5)
        XCTAssertEqual(result, "2026-03-06")
    }

    func testParseTimeInputMinutes24h() {
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("04:30"), 270)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("14:00"), 840)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("00:00"), 0)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("23:59"), 1439)
    }

    func testParseTimeInputMinutesAmPm() {
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("4:30 AM"), 270)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("2:00 PM"), 840)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("12:00 AM"), 0)
        XCTAssertEqual(DateFormatting.parseTimeInputMinutes("12:00 PM"), 720)
    }

    func testParseTimeInputMinutesInvalid() {
        XCTAssertNil(DateFormatting.parseTimeInputMinutes("not a time"))
        XCTAssertNil(DateFormatting.parseTimeInputMinutes("25:00"))
    }

    func testMinutesTo24hClock() {
        XCTAssertEqual(DateFormatting.minutesTo24hClock(0), "00:00")
        XCTAssertEqual(DateFormatting.minutesTo24hClock(270), "04:30")
        XCTAssertEqual(DateFormatting.minutesTo24hClock(1439), "23:59")
    }

    func testFormatAmPm() {
        XCTAssertEqual(DateFormatting.formatAmPm(0), "12:00 AM")
        XCTAssertEqual(DateFormatting.formatAmPm(270), "4:30 AM")
        XCTAssertEqual(DateFormatting.formatAmPm(720), "12:00 PM")
        XCTAssertEqual(DateFormatting.formatAmPm(840), "2:00 PM")
    }

    func testParseIsoToDate() {
        XCTAssertNotNil(DateFormatting.parseIsoToDate("2026-03-11"))
        XCTAssertNotNil(DateFormatting.parseIsoToDate("2026-03-11T12:00:00Z"))
        XCTAssertNil(DateFormatting.parseIsoToDate(nil))
        XCTAssertNil(DateFormatting.parseIsoToDate(""))
    }
}
