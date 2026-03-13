import Foundation

enum MarkdownStrip {
    /// Converts block-level markdown (headings) into inline bold text
    /// that SwiftUI's `Text(LocalizedStringKey(...))` can render.
    static func inlineOnly(_ text: String) -> String {
        text
            .components(separatedBy: "\n")
            .map { line in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("#") {
                    let content = trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                    return "**\(content)**"
                }
                // Unordered list markers: "- ", "* ", "+ "
                if let first = trimmed.first, (first == "-" || first == "*" || first == "+"),
                   trimmed.count > 1, trimmed[trimmed.index(after: trimmed.startIndex)] == " " {
                    return "\u{2022} \(String(trimmed.dropFirst(2)))"
                }
                // Ordered list markers: "1. ", "2. ", etc.
                if let dotSpace = trimmed.range(of: #"^\d+\.\s"#, options: .regularExpression) {
                    return "\u{2022} \(trimmed[dotSpace.upperBound...])"
                }
                return line
            }
            .joined(separator: "\n")
    }
}
