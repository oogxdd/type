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
}
