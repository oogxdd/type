//
//  OrderFile.swift
//  Type
//
//  Persisted per-directory sort order (`.notes-order.json`). Mirror of the Rust
//  `OrderFile`. Keys are `folder_order` / `note_order`. The `Feed` folder never
//  keeps an order file (it sorts by date).
//

import Foundation

struct OrderFile: Codable, Equatable {
    var folderOrder: [String] = []
    var noteOrder: [String] = []

    enum CodingKeys: String, CodingKey {
        case folderOrder = "folder_order"
        case noteOrder = "note_order"
    }

    init(folderOrder: [String] = [], noteOrder: [String] = []) {
        self.folderOrder = folderOrder
        self.noteOrder = noteOrder
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        folderOrder = (try? c.decode([String].self, forKey: .folderOrder)) ?? []
        noteOrder = (try? c.decode([String].self, forKey: .noteOrder)) ?? []
    }

    /// Sort `names` by their position in `order`, falling back to case-insensitive
    /// alphabetical (port of Rust `sort_by_order`).
    nonisolated static func sort(_ names: [String], by order: [String]) -> [String] {
        var index: [String: Int] = [:]
        for (i, name) in order.enumerated() { index[name] = i }
        return names.sorted { a, b in
            let ai = index[a] ?? Int.max
            let bi = index[b] ?? Int.max
            if ai != bi { return ai < bi }
            return a.lowercased() < b.lowercased()
        }
    }
}
