import Foundation

enum DateFormatting {
    static func formatDateInput(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: date)
    }

    static func addDays(to dateStr: String, days: Int) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return dateStr }
        guard let newDate = Calendar.current.date(byAdding: .day, value: days, to: date) else { return dateStr }
        return formatter.string(from: newDate)
    }

    static func parseIsoToDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)

        let formatters: [ISO8601DateFormatter] = {
            let full = ISO8601DateFormatter()
            full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            return [full, standard]
        }()

        for formatter in formatters {
            if let date = formatter.date(from: trimmed) {
                return date
            }
        }

        // Date-only
        if trimmed.count == 10 {
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM-dd"
            df.timeZone = TimeZone(identifier: "UTC")
            return df.date(from: trimmed)
        }

        return nil
    }

    static func formatCompactAge(_ value: String?) -> String? {
        guard let date = parseIsoToDate(value) else { return nil }
        let ageMinutes = max(0, Int(Date().timeIntervalSince(date) / 60))
        if ageMinutes < 60 {
            return "\(ageMinutes)m old"
        }
        let ageHours = ageMinutes / 60
        if ageHours < 24 {
            return "\(ageHours)h old"
        }
        let ageDays = ageHours / 24
        return "\(ageDays)d old"
    }

    static func formatAgeFromNow(_ value: String?) -> String {
        guard let date = parseIsoToDate(value) else { return "Unavailable" }
        let ageMinutes = max(0, Int(Date().timeIntervalSince(date) / 60))
        if ageMinutes < 60 {
            return "\(ageMinutes)m ago"
        }
        let hours = ageMinutes / 60
        let minutes = ageMinutes % 60
        return minutes == 0 ? "\(hours)h ago" : "\(hours)h \(minutes)m ago"
    }

    static func formatClockForStyle(_ value: String?, style: UserPreferences.TimeStyle) -> String {
        guard let value, !value.isEmpty else { return "N/A" }
        guard let minutes = parseTimeInputMinutes(value) ?? parseSolarClockMinutes(value) else {
            return value
        }
        if style == .twentyFourHour {
            return minutesTo24hClock(minutes)
        }
        return formatAmPm(minutes)
    }

    static func parseTimeInputMinutes(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)

        // 24h format
        let pattern24 = try? NSRegularExpression(pattern: #"^(\d{1,2}):(\d{2})$"#)
        if let match = pattern24?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) {
            let hourStr = String(trimmed[Range(match.range(at: 1), in: trimmed)!])
            let minStr = String(trimmed[Range(match.range(at: 2), in: trimmed)!])
            guard let hour = Int(hourStr), let minute = Int(minStr), hour <= 23, minute <= 59 else { return nil }
            return hour * 60 + minute
        }

        // AM/PM format
        let patternAmPm = try? NSRegularExpression(pattern: #"^(\d{1,2}):(\d{2})\s*(AM|PM)$"#, options: .caseInsensitive)
        if let match = patternAmPm?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) {
            let hourStr = String(trimmed[Range(match.range(at: 1), in: trimmed)!])
            let minStr = String(trimmed[Range(match.range(at: 2), in: trimmed)!])
            let meridiem = String(trimmed[Range(match.range(at: 3), in: trimmed)!]).uppercased()
            guard let hour12 = Int(hourStr), let minute = Int(minStr), hour12 >= 1, hour12 <= 12, minute <= 59 else { return nil }
            let hour24 = meridiem == "PM" ? (hour12 % 12) + 12 : hour12 % 12
            return hour24 * 60 + minute
        }

        return nil
    }

    static func parseSolarClockMinutes(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        let pattern = try? NSRegularExpression(pattern: #"^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$"#, options: .caseInsensitive)
        guard let match = pattern?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) else { return nil }
        let hourStr = String(trimmed[Range(match.range(at: 1), in: trimmed)!])
        let minStr = String(trimmed[Range(match.range(at: 2), in: trimmed)!])
        let meridiem = String(trimmed[Range(match.range(at: 3), in: trimmed)!]).uppercased()
        guard var hour = Int(hourStr), let minute = Int(minStr) else { return nil }
        if meridiem == "PM" && hour < 12 { hour += 12 }
        if meridiem == "AM" && hour == 12 { hour = 0 }
        return hour * 60 + minute
    }

    static func minutesTo24hClock(_ minutes: Int) -> String {
        let clamped = max(0, min(1439, minutes))
        let hour = clamped / 60
        let minute = clamped % 60
        return String(format: "%02d:%02d", hour, minute)
    }

    static func formatAmPm(_ minutes: Int) -> String {
        let clamped = max(0, min(1439, minutes))
        let hour24 = clamped / 60
        let minute = clamped % 60
        let ampm = hour24 >= 12 ? "PM" : "AM"
        let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
        return String(format: "%d:%02d %@", hour12, minute, ampm)
    }
}
