import Foundation
import CoreGraphics

// Coordinates are in the parent scroll view's content space. Move only far
// enough to reveal the caret; content growth does not imply editing at EOF.
func editorSelectionOffset(
  caret: CGRect, offset: CGFloat, viewport: CGFloat, content: CGFloat,
  margin: CGFloat = 16
) -> CGFloat {
  guard viewport > 0, !caret.isNull, !caret.isInfinite else { return offset }
  let padding = min(margin, max(0, (viewport - caret.height) / 2))
  var target = offset
  if caret.maxY + padding > offset + viewport {
    target = caret.maxY + padding - viewport
  } else if caret.minY - padding < offset {
    target = caret.minY - padding
  }
  return min(max(0, target), max(0, content - viewport))
}
