import ExpoModulesCore
import UIKit

public final class EditorScrollModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EditorScroll")

    AsyncFunction("revealSelection") { (tag: Int) in
      guard let view = self.appContext?.findView(withTag: tag, ofType: UIView.self),
            let input = self.textView(in: view), input.isFirstResponder, input.isEditable,
            let selection = input.selectedTextRange, selection.isEmpty else { return }
      var ancestor = input.superview
      while let view = ancestor {
        if let scroll = view as? UIScrollView {
          // Native selection/scroll gestures keep ownership of their movement.
          guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return }
          scroll.superview?.layoutIfNeeded()
          input.layoutIfNeeded()
          let caret = input.convert(input.caretRect(for: selection.end), to: scroll)
          let target = editorSelectionOffset(
            caret: caret, offset: scroll.contentOffset.y,
            viewport: scroll.bounds.height, content: scroll.contentSize.height
          )
          if abs(target - scroll.contentOffset.y) > 0.5 {
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: target), animated: false)
          }
          return
        }
        ancestor = view.superview
      }
    }.runOnQueue(.main)
  }

  private func textView(in view: UIView) -> UITextView? {
    if let input = view as? UITextView { return input }
    for child in view.subviews {
      if let input = textView(in: child) { return input }
    }
    return nil
  }
}
