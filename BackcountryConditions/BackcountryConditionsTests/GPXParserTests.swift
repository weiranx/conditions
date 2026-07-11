import XCTest
@testable import BackcountryConditions

final class GPXParserTests: XCTestCase {
    func testParsesTrackMetadataAndCheckpoints() throws {
        let xml = """
        <?xml version="1.0"?>
        <gpx version="1.1"><trk><name>North Ridge</name><trkseg>
          <trkpt lat="40.0000" lon="-105.0000"><ele>2000</ele></trkpt>
          <trkpt lat="40.0100" lon="-105.0100"><ele>2100</ele></trkpt>
          <trkpt lat="40.0200" lon="-105.0200"><ele>2250</ele></trkpt>
          <trkpt lat="40.0300" lon="-105.0300"><ele>2200</ele></trkpt>
          <trkpt lat="40.0400" lon="-105.0400"><ele>2400</ele></trkpt>
        </trkseg></trk></gpx>
        """
        let route = try GPXParser.parse(data: Data(xml.utf8), fileName: "route.gpx")
        XCTAssertEqual(route.name, "North Ridge")
        XCTAssertEqual(route.pointCount, 5)
        XCTAssertEqual(route.checkpoints.count, 5)
        XCTAssertEqual(route.checkpoints.first?.name, "Route start")
        XCTAssertEqual(route.checkpoints.last?.name, "Route finish")
        XCTAssertEqual(route.checkpoints.last?.progressPercent, 100)
        XCTAssertGreaterThan(route.distanceMiles, 0)
        XCTAssertGreaterThan(route.elevationGainFt ?? 0, 0)
    }

    func testRejectsTrackWithTooFewPoints() {
        let xml = #"<gpx><rte><rtept lat="40" lon="-105"/></rte></gpx>"#
        XCTAssertThrowsError(try GPXParser.parse(data: Data(xml.utf8), fileName: "short.gpx"))
    }
}
