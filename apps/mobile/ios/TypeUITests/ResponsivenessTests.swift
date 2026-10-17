import XCTest

final class ResponsivenessTests: XCTestCase {
  private func shown(_ element: XCUIElement) -> Bool {
    element.exists || element.waitForExistence(timeout: 3)
  }
  private func launch(_ count: Int) -> XCUIApplication {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.typenotes.mobile.dev")
    app.launchEnvironment["TYPE_PERF_NOTES"] = String(count)
    app.launchEnvironment["TYPE_PERF_ID"] = UUID().uuidString
    app.launchEnvironment["TYPE_PERF_DELAY_MS"] = "750"
    app.launchEnvironment["TYPE_EDITOR_SCROLL_TRACE"] = "1"
    app.launch()
    XCTAssertTrue(app.textViews["note-editor"].waitForExistence(timeout: 180))
    return app
  }

  private func roundTrip(_ app: XCUIApplication) -> Double {
    app.buttons["Open menu"].tap()
    let settings = app.buttons["menu-settings"]
    XCTAssertTrue(shown(settings))
    let started = ProcessInfo.processInfo.systemUptime
    settings.tap()
    XCTAssertTrue(shown(app.navigationBars["Settings"]))
    let elapsed = ProcessInfo.processInfo.systemUptime - started
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(shown(app.buttons["Return to note"]))
    app.buttons["Return to note"].tap()
    XCTAssertTrue(shown(app.buttons["Open menu"]))
    return elapsed
  }

  func testSettingsDuringColdLoadingAtEachScale() {
    for count in [1000, 5000, 10000] {
      let app = launch(count)
      var timings: [Double] = []
      // Every touch must succeed; no retries hide a swallowed press.
      for _ in 0..<10 { timings.append(roundTrip(app)) }
      let report = "notes=\(count), settings XCTest tap→visible p95=\(timings.sorted()[Int(ceil(Double(timings.count) * 0.95)) - 1])s"
      let attachment = XCTAttachment(string: report)
      attachment.lifetime = .keepAlways
      add(attachment)
      // XCTest tap includes its own idle wait; actual feedback/frame latency
      // is measured with Instruments and the optional in-app trace.
      XCTAssertLessThan(timings.max()!, 3)
      app.terminate()
    }
  }

  func testOneHundredSingleTapsAndDraftSurvivesSettings() {
    let app = launch(10000)
    let editor = app.textViews["note-editor"]
    editor.tap()
    editor.typeText("Retained synthetic draft")
    // Typing intentionally hides the controls; a paper touch reveals them.
    editor.tap()
    for _ in 0..<100 { _ = roundTrip(app) }
    XCTAssertEqual(editor.value as? String, "Retained synthetic draft")
    app.terminate()
  }

  func testSwipeNavigationThenSingleToolbarTap() {
    let app = launch(1000)
    app.textViews["note-editor"].swipeRight()
    XCTAssertTrue(app.buttons["menu-settings"].waitForExistence(timeout: 3))
    app.swipeLeft()
    XCTAssertTrue(app.buttons["Open menu"].waitForExistence(timeout: 3))
    // A completed swipe cannot suppress the next independent button touch.
    app.buttons["Open menu"].tap()
    XCTAssertTrue(app.buttons["menu-settings"].waitForExistence(timeout: 3))
    app.terminate()
  }

  func testTypingPastKeyboard() {
    let app = launch(1000)
    let editor = app.textViews["note-editor"]
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    editor.typeText((1...32).map { "Keyboard regression line \($0)\n" }.joined())
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Long note after typing with keyboard"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    print("EDITOR GEOMETRY: \(editor.frame); KEYBOARD: \(app.keyboards.firstMatch.frame)")
    XCTAssertTrue((editor.value as? String)?.contains("Keyboard regression line 32") == true)
    let probe = app.otherElements["editor-scroll-probe"]
    XCTAssertTrue(probe.waitForExistence(timeout: 5), "Native caret module must run")
    let json = (probe.value as? String ?? "{}").data(using: .utf8)!
    let metrics = try! JSONSerialization.jsonObject(with: json) as! [String: Any]
    print("CARET METRICS: \(metrics)")
    XCTAssertEqual(metrics["status"] as? String, "revealed")
    XCTAssertGreaterThan(metrics["offset"] as? Double ?? 0, 0)
    XCTAssertLessThanOrEqual(metrics["caretBottom"] as? Double ?? .infinity,
                             app.keyboards.firstMatch.frame.minY - 8)
    XCTAssertGreaterThan(metrics["inputHeight"] as? Double ?? 0,
                         metrics["viewport"] as? Double ?? .infinity)

    // Native scrolling must still reach the beginning without filing a note.
    let paper = app.scrollViews.containing(.textView, identifier: "note-editor").firstMatch
    paper.swipeDown(velocity: .slow)
    paper.swipeDown(velocity: .slow)
    XCTAssertTrue((editor.value as? String)?.contains("Keyboard regression line 32") == true)
    XCTAssertGreaterThan(editor.frame.minY, 30)

    // Scrolling toward the end must retain the note; only the subsequent
    // pull past the end, deliberately and slowly, starts the next draft.
    let start = paper.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95))
    let end = paper.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
    start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
    XCTAssertTrue((editor.value as? String)?.contains("Keyboard regression line 32") == true)
    start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
    let fresh = NSPredicate { _, _ in
      !(editor.value as? String ?? "").contains("Keyboard regression line")
    }
    expectation(for: fresh, evaluatedWith: editor)
    waitForExpectations(timeout: 10)
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    editor.typeText("Fresh draft after pull")
    XCTAssertEqual(editor.value as? String, "Fresh draft after pull")
  }

  func testSoftWrappedTypingPastKeyboard() {
    let app = launch(1000)
    let editor = app.textViews["note-editor"]
    editor.tap()
    let text = String(repeating: "Soft wraps follow the typing caret. ", count: 30) + "Привет, мир"
    editor.typeText(text)
    XCTAssertEqual(editor.value as? String, text)
    let probe = app.otherElements["editor-scroll-probe"]
    XCTAssertTrue(probe.waitForExistence(timeout: 5))
    let metrics = try! JSONSerialization.jsonObject(with: (probe.value as! String).data(using: .utf8)!) as! [String: Any]
    print("WRAPPED CARET METRICS: \(metrics)")
    XCTAssertEqual(metrics["length"] as? Int, text.utf16.count)
    XCTAssertGreaterThan(metrics["offset"] as? Double ?? 0, 0)
    XCTAssertLessThanOrEqual(metrics["caretBottom"] as? Double ?? .infinity,
                             app.keyboards.firstMatch.frame.minY - 8)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Soft wraps keep the caret visible"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
