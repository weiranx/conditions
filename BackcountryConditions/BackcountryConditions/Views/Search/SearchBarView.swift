import SwiftUI

struct SearchBarView: View {
    var searchVM: SearchViewModel
    @Binding var isSearchActive: Bool
    var onSelect: (SearchResult) -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(isFocused ? .blue : .secondary)

                TextField("Search peaks, trailheads, coordinates...", text: Binding(
                    get: { searchVM.query },
                    set: { newValue in
                        searchVM.query = newValue
                        searchVM.performSearch(newValue)
                    }
                ))
                .font(.subheadline)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .focused($isFocused)

                if !searchVM.query.isEmpty {
                    Button {
                        searchVM.clearSuggestions()
                        hideKeyboard()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(.tertiary)
                    }
                    .accessibilityLabel("Clear search")
                }

                if searchVM.isSearching {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(isFocused ? Color.blue.opacity(0.4) : Color.gray.opacity(0.15), lineWidth: isFocused ? 1 : 0.5)
            )
            .shadow(color: isFocused ? Color.blue.opacity(0.08) : Color.clear, radius: 8, y: 2)
            .animation(.easeInOut(duration: 0.2), value: isFocused)
            .onChange(of: isFocused) { _, newValue in
                isSearchActive = newValue
            }

            // Suggestions dropdown
            if !searchVM.suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(searchVM.suggestions.enumerated()), id: \.element.id) { index, result in
                        Button {
                            Haptics.selection()
                            onSelect(result)
                            searchVM.clearSuggestions()
                            hideKeyboard()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: suggestionIcon(for: result))
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 28, height: 28)
                                    .background(
                                        LinearGradient(
                                            colors: [.blue, .blue.opacity(0.7)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        in: RoundedRectangle(cornerRadius: 7)
                                    )

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(result.name)
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)

                                    Text(String(format: "%.3f°%@, %.3f°%@", abs(result.lat), result.lat >= 0 ? "N" : "S", abs(result.lon), result.lon >= 0 ? "E" : "W"))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(.quaternary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                        }

                        if index < searchVM.suggestions.count - 1 {
                            Divider()
                                .padding(.leading, 54)
                        }
                    }
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(.quaternary.opacity(0.4), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.1), radius: 16, y: 8)
                .padding(.top, 6)
            } else if !searchVM.query.isEmpty && !searchVM.isSearching && searchVM.suggestions.isEmpty {
                // No results found
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13))
                        .foregroundStyle(.tertiary)
                    Text("No results for \"\(searchVM.query)\"")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(.quaternary.opacity(0.4), lineWidth: 0.5)
                )
                .padding(.top, 6)
            }
        }
    }

    private func hideKeyboard() {
        isFocused = false
    }

    private func suggestionIcon(for result: SearchResult) -> String {
        let type = result.type?.lowercased() ?? ""
        let cls = result.resultClass?.lowercased() ?? ""
        if type == "peak" || type == "mountain" || type == "volcano" || cls == "mountain" || cls == "popular" {
            return "mountain.2"
        }
        return "mappin"
    }
}
