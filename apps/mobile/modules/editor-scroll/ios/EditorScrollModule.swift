import ExpoModulesCore
import UIKit

public final class EditorScrollModule: Module {
  #if targetEnvironment(simulator)
  private var probe: UIView?
  #endif
  public func definition() -> ModuleDefinition {
    Name("EditorScroll")

    AsyncFunction("revealSelection") { (tag: Int) -> Double? in
      self.publishProbe("lookup")
      guard let view = self.appContext?.findView(withTag: tag, ofType: UIView.self),
            let input = self.textView(in: view), input.isFirstResponder, input.isEditable,
            input.bounds.width > 0 else { return nil }
      // Fabric does not reliably grow an uncontrolled, non-scrolling input
      // after native edits. Measure UIKit's actual text (including soft wraps
      // and insets) and let Yoga grow the paper before revealing the caret.
      let height = Double(ceil(input.sizeThatFits(CGSize(width: input.bounds.width,
                                                       height: CGFloat.greatestFiniteMagnitude)).height))
      guard let selection = input.selectedTextRange, selection.isEmpty else { return height }
      var ancestor = input.superview
      while let view = ancestor {
        if let scroll = view as? UIScrollView {
          // Native selection/scroll gestures keep ownership of their movement.
          guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return height }
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
          self.publishProbe("revealed", input: input, scroll: scroll)
          return height
        }
        ancestor = view.superview
      }
      return height
    }.runOnQueue(.main)
  }

  // XCTest observes real UIKit geometry, including a missing native lookup.
  // No note content is exposed; this view exists only in opted-in Dev simulators.
  private func publishProbe(_ status: String, input: UITextView? = nil, scroll: UIScrollView? = nil) {
    #if targetEnvironment(simulator)
    guard Bundle.main.bundleIdentifier == "com.typenotes.mobile.dev",
          ProcessInfo.processInfo.environment["TYPE_EDITOR_SCROLL_TRACE"] == "1",
          let window = input?.window ?? (UIApplication.shared.delegate?.window ?? nil) ?? UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) else { return }
    if probe == nil {
      let view = UIView(frame: CGRect(x: 0, y: window.safeAreaInsets.top, width: 1, height: 1))
      view.isAccessibilityElement = true
      view.accessibilityIdentifier = "editor-scroll-probe"
      view.accessibilityLabel = "Editor scroll geometry"
      window.addSubview(view)
      probe = view
    }
    var metrics: [String: Any] = ["status": status]
    if let input, let scroll, let selection = input.selectedTextRange {
      let caret = input.convert(input.caretRect(for: selection.end), to: window)
      metrics["caretBottom"] = caret.maxY
      metrics["caretTop"] = caret.minY
      metrics["offset"] = scroll.contentOffset.y
      metrics["viewport"] = scroll.bounds.height
      metrics["content"] = scroll.contentSize.height
      metrics["inputHeight"] = input.bounds.height
      metrics["length"] = input.text.utf16.count
    }
    if let data = try? JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys]) {
      probe?.accessibilityValue = String(data: data, encoding: .utf8)
    }
    #endif
  }

  private func textView(in view: UIView) -> UITextView? {
    if let input = view as? UITextView { return input }
    for child in view.subviews {
      if let input = textView(in: child) { return input }
    }
    return nil
  }
}
