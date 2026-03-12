import Foundation

enum Configuration {
    static let apiBaseURL = ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "https://apivps.conditions.weiranxiong.com"

    static let appDisclaimer = "Backcountry Conditions is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or wrong. Verify official weather, avalanche, fire, and land-management products, then make final decisions from field observations and team judgment."
    static let appCredit = "Built by Weiran Xiong with AI support."
    static let defaultCenter = (lat: 39.8283, lon: -98.5795)
}
