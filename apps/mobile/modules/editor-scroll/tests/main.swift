import Foundation
import CoreGraphics

func check(_ name: String, caret: CGRect, offset: CGFloat, viewport: CGFloat = 300,
           content: CGFloat = 1000, expected: CGFloat) {
  let actual = editorSelectionOffset(caret: caret, offset: offset, viewport: viewport, content: content)
  precondition(actual == expected, "\(name): expected \(expected), got \(actual)")
}

check("wrapped line below viewport", caret: CGRect(x: 0, y: 490, width: 2, height: 24),
      offset: 200, expected: 230)
check("middle edit stays visible without jumping to EOF", caret: CGRect(x: 0, y: 350, width: 2, height: 24),
      offset: 200, content: 4000, expected: 200)
check("caret above viewport", caret: CGRect(x: 0, y: 170, width: 2, height: 24),
      offset: 200, expected: 154)
check("keyboard shrinks viewport", caret: CGRect(x: 0, y: 440, width: 2, height: 24),
      offset: 100, viewport: 200, expected: 280)
check("short blank page", caret: CGRect(x: 0, y: 44, width: 2, height: 24),
      offset: 0, content: 300, expected: 0)
check("content shrink clamps old offset", caret: CGRect(x: 0, y: 340, width: 2, height: 24),
      offset: 500, content: 400, expected: 100)
check("EOF clamps to content", caret: CGRect(x: 0, y: 976, width: 2, height: 24),
      offset: 600, expected: 700)
check("top has no negative overscroll", caret: CGRect(x: 0, y: 0, width: 2, height: 24),
      offset: 0, expected: 0)
check("layout not ready", caret: CGRect(x: 0, y: 490, width: 2, height: 24),
      offset: 200, viewport: 0, expected: 200)
print("9 editor scroll geometry checks passed")
