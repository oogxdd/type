import React
import UIKit

@objc(NativeEdgeMenu)
final class NativeEdgeMenu: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "NativeEdgeMenu"
  }

  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc func openMenu() {
    DispatchQueue.main.async {
      NativeEdgeMenuController.shared.open(animated: true)
    }
  }

  @objc func closeMenu() {
    DispatchQueue.main.async {
      NativeEdgeMenuController.shared.close(animated: true)
    }
  }
}

final class NativeEdgeMenuController: NSObject, UIGestureRecognizerDelegate {
  static let shared = NativeEdgeMenuController()

  private weak var window: UIWindow?
  private weak var rootViewController: UIViewController?
  private var rootViewFactory: RCTRootViewFactory?
  private weak var contentView: UIView?

  private var panelView: UIView?
  private var menuRootView: UIView?
  private var openEdgePan: UIScreenEdgePanGestureRecognizer?
  private var closePan: UIPanGestureRecognizer?
  private var progress: CGFloat = 0
  private var isOpen = false

  func install(
    in window: UIWindow,
    rootViewController: UIViewController,
    rootViewFactory: RCTRootViewFactory
  ) {
    self.window = window
    self.rootViewController = rootViewController
    self.rootViewFactory = rootViewFactory
    self.contentView = rootViewController.view

    openEdgePan?.view?.removeGestureRecognizer(openEdgePan!)

    let edgePan = UIScreenEdgePanGestureRecognizer(
      target: self,
      action: #selector(handleOpenEdgePan(_:))
    )
    edgePan.edges = .right
    edgePan.cancelsTouchesInView = false
    edgePan.delegate = self
    window.addGestureRecognizer(edgePan)
    openEdgePan = edgePan
  }

  func open(animated: Bool) {
    guard ensurePanel() else {
      return
    }
    window?.endEditing(true)
    animate(to: 1, velocity: 0, animated: animated)
  }

  func close(animated: Bool) {
    animate(to: 0, velocity: 0, animated: animated)
  }

  @objc private func handleOpenEdgePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
    guard let window else {
      return
    }

    switch recognizer.state {
    case .began:
      window.endEditing(true)
      guard ensurePanel() else {
        return
      }
      setProgress(0)
    case .changed:
      let translation = recognizer.translation(in: window)
      setProgress(min(1, max(0, -translation.x / max(window.bounds.width, 1))))
    case .ended, .cancelled, .failed:
      let velocity = recognizer.velocity(in: window).x
      let shouldOpen = progress > 0.35 || velocity < -450
      animate(to: shouldOpen ? 1 : 0, velocity: velocity, animated: true)
    default:
      break
    }
  }

  @objc private func handleClosePan(_ recognizer: UIPanGestureRecognizer) {
    guard let window else {
      return
    }

    switch recognizer.state {
    case .began:
      guard isOpen else {
        return
      }
      setProgress(1)
    case .changed:
      let translation = recognizer.translation(in: window)
      setProgress(min(1, max(0, 1 - translation.x / max(window.bounds.width, 1))))
    case .ended, .cancelled, .failed:
      let velocity = recognizer.velocity(in: window).x
      let shouldClose = progress < 0.65 || velocity > 450
      animate(to: shouldClose ? 0 : 1, velocity: velocity, animated: true)
    default:
      break
    }
  }

  private func ensurePanel() -> Bool {
    guard let window, let rootViewFactory else {
      return false
    }

    if let panelView {
      panelView.frame = window.bounds
      panelView.isHidden = false
      window.bringSubviewToFront(panelView)
      return true
    }

    let panel = UIView(frame: window.bounds)
    panel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    panel.backgroundColor = .systemBackground
    panel.layer.shadowColor = UIColor.black.cgColor
    panel.layer.shadowOpacity = 0.16
    panel.layer.shadowRadius = 18
    panel.layer.shadowOffset = CGSize(width: -4, height: 0)
    panel.isHidden = false

    let menuRoot = rootViewFactory.view(
      withModuleName: "NativeMenu",
      initialProperties: nil,
      launchOptions: nil
    )
    menuRoot.frame = panel.bounds
    menuRoot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    panel.addSubview(menuRoot)

    let pan = UIPanGestureRecognizer(target: self, action: #selector(handleClosePan(_:)))
    pan.cancelsTouchesInView = false
    pan.delegate = self
    panel.addGestureRecognizer(pan)

    window.addSubview(panel)
    window.bringSubviewToFront(panel)

    panelView = panel
    menuRootView = menuRoot
    closePan = pan
    setProgress(0)
    return true
  }

  private func setProgress(_ nextProgress: CGFloat) {
    guard let window, let panelView else {
      return
    }

    progress = min(1, max(0, nextProgress))
    let width = max(window.bounds.width, 1)
    panelView.isHidden = false
    panelView.transform = CGAffineTransform(translationX: width * (1 - progress), y: 0)
  }

  private func animate(to target: CGFloat, velocity: CGFloat, animated: Bool) {
    guard ensurePanel(), let panelView else {
      return
    }

    let animations = {
      self.setProgress(target)
    }
    let completion: (Bool) -> Void = { _ in
      self.progress = target
      self.isOpen = target >= 1
      if target <= 0 {
        panelView.isHidden = true
      }
    }

    if animated {
      let initialVelocity = CGVector(dx: min(2, abs(velocity) / 1600), dy: 0)
      UIView.animate(
        withDuration: 0.32,
        delay: 0,
        usingSpringWithDamping: 0.92,
        initialSpringVelocity: initialVelocity.dx,
        options: [.allowUserInteraction, .beginFromCurrentState, .curveEaseOut],
        animations: animations,
        completion: completion
      )
    } else {
      animations()
      completion(true)
    }
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer === closePan {
      guard isOpen, let pan = gestureRecognizer as? UIPanGestureRecognizer else {
        return false
      }
      let translation = pan.translation(in: panelView)
      let velocity = pan.velocity(in: panelView)
      return translation.x > 0 && abs(velocity.x) > abs(velocity.y)
    }
    return true
  }
}
