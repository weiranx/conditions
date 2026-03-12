import Foundation

// MARK: - Constants

enum UnitConstants {
    static let ftPerMeter: Double = 3.28084
    static let meterPerFoot: Double = 1.0 / ftPerMeter
    static let kphPerMph: Double = 1.60934
    static let mmPerInch: Double = 25.4
    static let cmPerInch: Double = 2.54
    static let kmPerMile: Double = 1.60934
}

// MARK: - Temperature

func convertTempFToDisplay(_ tempF: Double, unit: UserPreferences.TemperatureUnit) -> Double {
    guard tempF.isFinite else { return tempF }
    if unit == .celsius {
        return (tempF - 32) * (5.0 / 9.0)
    }
    return tempF
}

func convertDisplayTempToF(_ value: Double, unit: UserPreferences.TemperatureUnit) -> Double {
    guard value.isFinite else { return value }
    if unit == .celsius {
        return value * (9.0 / 5.0) + 32
    }
    return value
}

func formatTemperature(_ tempF: Double?, unit: UserPreferences.TemperatureUnit, includeUnit: Bool = true, precision: Int = 0) -> String {
    guard let tempF, tempF.isFinite else { return "N/A" }
    let value = convertTempFToDisplay(tempF, unit: unit)
    let rounded = precision > 0 ? String(format: "%.\(precision)f", value) : "\(Int(value.rounded()))"
    if !includeUnit {
        return "\(rounded)°"
    }
    return "\(rounded)\(unit.symbol)"
}

// MARK: - Wind

func convertWindMphToDisplay(_ mph: Double, unit: UserPreferences.WindSpeedUnit) -> Double {
    guard mph.isFinite else { return mph }
    if unit == .kph {
        return mph * UnitConstants.kphPerMph
    }
    return mph
}

func convertDisplayWindToMph(_ value: Double, unit: UserPreferences.WindSpeedUnit) -> Double {
    guard value.isFinite else { return value }
    if unit == .kph {
        return value / UnitConstants.kphPerMph
    }
    return value
}

func formatWind(_ mph: Double?, unit: UserPreferences.WindSpeedUnit, includeUnit: Bool = true) -> String {
    guard let mph, mph.isFinite else { return "N/A" }
    let value = convertWindMphToDisplay(mph, unit: unit)
    let rounded = "\(Int(value.rounded()))"
    if !includeUnit {
        return rounded
    }
    return "\(rounded) \(unit.symbol)"
}

// MARK: - Elevation

func convertElevationFtToDisplay(_ feet: Double, unit: UserPreferences.ElevationUnit) -> Double {
    guard feet.isFinite else { return feet }
    if unit == .meters {
        return feet * UnitConstants.meterPerFoot
    }
    return feet
}

func convertDisplayElevationToFt(_ value: Double, unit: UserPreferences.ElevationUnit) -> Double {
    guard value.isFinite else { return value }
    if unit == .meters {
        return value * UnitConstants.ftPerMeter
    }
    return value
}

func formatElevation(_ feet: Double?, unit: UserPreferences.ElevationUnit, includeUnit: Bool = true) -> String {
    guard let feet, feet.isFinite else { return "N/A" }
    let value = convertElevationFtToDisplay(feet, unit: unit)
    let formatted = Int(value.rounded()).formatted()
    if !includeUnit {
        return formatted
    }
    return "\(formatted) \(unit.symbol)"
}

func formatElevationDelta(_ deltaFt: Double?, unit: UserPreferences.ElevationUnit) -> String {
    guard let deltaFt, deltaFt.isFinite else { return "N/A" }
    let value = convertElevationFtToDisplay(deltaFt, unit: unit)
    let rounded = Int(value.rounded())
    if rounded == 0 {
        return "objective"
    }
    let sign = rounded > 0 ? "+" : "-"
    return "\(sign)\(abs(rounded).formatted()) \(unit.symbol)"
}

func formatDistance(_ distanceKm: Double?, elevationUnit: UserPreferences.ElevationUnit) -> String {
    guard let distanceKm, distanceKm.isFinite else { return "N/A" }
    if elevationUnit == .meters {
        return String(format: "%.1f km", distanceKm)
    }
    return String(format: "%.1f mi", distanceKm / UnitConstants.kmPerMile)
}

// MARK: - Snow / Rain

func formatSnowDepth(_ inches: Double?, unit: UserPreferences.ElevationUnit) -> String {
    guard let inches, inches.isFinite else { return "N/A" }
    if unit == .meters {
        return "\(Int((inches * UnitConstants.cmPerInch).rounded())) cm"
    }
    return "\(Int(inches.rounded())) in"
}

func formatSwe(_ inches: Double?, unit: UserPreferences.ElevationUnit) -> String {
    guard let inches, inches.isFinite else { return "N/A" }
    if unit == .meters {
        return "\(Int((inches * UnitConstants.mmPerInch).rounded())) mm SWE"
    }
    return String(format: "%.1f in SWE", inches)
}

func formatRainAmount(inches: Double?, millimeters: Double?, unit: UserPreferences.ElevationUnit) -> String {
    if unit == .meters {
        if let mm = millimeters, mm.isFinite {
            return "\(Int(mm.rounded())) mm"
        }
        if let inches, inches.isFinite {
            return "\(Int((inches * UnitConstants.mmPerInch).rounded())) mm"
        }
        return "N/A"
    }
    if let inches, inches.isFinite {
        return String(format: "%.2f in", inches)
    }
    if let mm = millimeters, mm.isFinite {
        return String(format: "%.2f in", mm / UnitConstants.mmPerInch)
    }
    return "N/A"
}
