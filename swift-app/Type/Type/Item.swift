//
//  Item.swift
//  Type
//
//  Created by Maxim Ignatev on 6/23/26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
