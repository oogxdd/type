import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

private final class BackupDocumentPickerDelegate: NSObject, UIDocumentPickerDelegate {
  let onPick: ([URL]) -> Void
  let onCancel: () -> Void

  init(onPick: @escaping ([URL]) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
  }

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    onPick(urls)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    onCancel()
  }
}

private struct CopyStats {
  var fileCount = 0
  var totalBytes: Int64 = 0
}

/**
 * Presents the platform Files picker for two deliberately native operations:
 * exporting a ZIP and recursively copying a whole working folder. Keeping the
 * byte transfer native avoids loading large recording folders into JS/base64.
 */
public final class BackupExportModule: Module {
  private var pickerDelegate: BackupDocumentPickerDelegate?
  private var operationInProgress = false

  public func definition() -> ModuleDefinition {
    Name("BackupExport")

    AsyncFunction("exportArchive") {
      (archivePath: String, suggestedName: String, promise: Promise) in
      let source = URL(fileURLWithPath: archivePath)
      guard FileManager.default.fileExists(atPath: source.path) else {
        promise.reject("ERR_BACKUP_SOURCE_MISSING", "The backup archive no longer exists.")
        return
      }

      DispatchQueue.main.async {
        guard self.beginOperation(promise) else { return }
        let exportSource: URL
        if source.lastPathComponent == suggestedName {
          exportSource = source
        } else {
          let staged = FileManager.default.temporaryDirectory
            .appendingPathComponent(suggestedName)
          do {
            try? FileManager.default.removeItem(at: staged)
            try FileManager.default.copyItem(at: source, to: staged)
            exportSource = staged
          } catch {
            self.rejectAndFinish(promise, code: "ERR_BACKUP_STAGE", error: error)
            return
          }
        }

        let picker = UIDocumentPickerViewController(
          forExporting: [exportSource],
          asCopy: true
        )
        self.present(
          picker,
          promise: promise,
          onPick: { urls in
            self.resolveAndFinish(promise, [
              "cancelled": false,
              "destination_uri": urls.first?.absoluteString ?? "",
            ])
          }
        )
      }
    }

    AsyncFunction("copyFolder") {
      (sourcePath: String, destinationName: String, promise: Promise) in
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(
        atPath: sourcePath,
        isDirectory: &isDirectory
      ), isDirectory.boolValue else {
        promise.reject("ERR_BACKUP_SOURCE_MISSING", "The working folder no longer exists.")
        return
      }

      DispatchQueue.main.async {
        guard self.beginOperation(promise) else { return }
        let picker = UIDocumentPickerViewController(
          forOpeningContentTypes: [.folder],
          asCopy: false
        )
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true
        self.present(
          picker,
          promise: promise,
          onPick: { urls in
            guard let selectedDirectory = urls.first else {
              self.resolveAndFinish(promise, ["cancelled": true])
              return
            }
            DispatchQueue.global(qos: .userInitiated).async {
              self.copyFolder(
                from: URL(fileURLWithPath: sourcePath, isDirectory: true),
                into: selectedDirectory,
                destinationName: destinationName,
                promise: promise
              )
            }
          }
        )
      }
    }
  }

  private func beginOperation(_ promise: Promise) -> Bool {
    guard !operationInProgress else {
      promise.reject("ERR_BACKUP_BUSY", "Another backup picker is already open.")
      return false
    }
    guard topViewController() != nil else {
      promise.reject("ERR_BACKUP_PRESENT", "Type could not open the Files picker.")
      return false
    }
    operationInProgress = true
    return true
  }

  private func present(
    _ picker: UIDocumentPickerViewController,
    promise: Promise,
    onPick: @escaping ([URL]) -> Void
  ) {
    let delegate = BackupDocumentPickerDelegate(
      onPick: onPick,
      onCancel: { [weak self] in
        self?.resolveAndFinish(promise, ["cancelled": true])
      }
    )
    pickerDelegate = delegate
    picker.delegate = delegate
    guard let presenter = topViewController() else {
      rejectAndFinish(
        promise,
        code: "ERR_BACKUP_PRESENT",
        message: "Type could not open the Files picker."
      )
      return
    }
    presenter.present(picker, animated: true)
  }

  private func copyFolder(
    from source: URL,
    into selectedDirectory: URL,
    destinationName: String,
    promise: Promise
  ) {
    let accessed = selectedDirectory.startAccessingSecurityScopedResource()
    defer {
      if accessed {
        selectedDirectory.stopAccessingSecurityScopedResource()
      }
    }

    let fileManager = FileManager.default
    let safeName = destinationName
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
    let finalDestination = selectedDirectory
      .appendingPathComponent(safeName, isDirectory: true)
    let stagingDestination = selectedDirectory.appendingPathComponent(
      ".type-backup-incomplete-\(UUID().uuidString)",
      isDirectory: true
    )

    let sourcePath = source.standardizedFileURL.path
    let destinationPath = finalDestination.standardizedFileURL.path
    guard !destinationPath.hasPrefix(sourcePath + "/") else {
      rejectAndFinish(
        promise,
        code: "ERR_BACKUP_DESTINATION",
        message: "Choose a folder outside the working folder."
      )
      return
    }

    do {
      guard !fileManager.fileExists(atPath: finalDestination.path) else {
        throw NSError(
          domain: "BackupExport",
          code: 2,
          userInfo: [
            NSLocalizedDescriptionKey:
              "A folder named \(safeName) already exists. Choose another destination or try again in a second."
          ]
        )
      }

      try fileManager.createDirectory(
        at: stagingDestination,
        withIntermediateDirectories: false
      )
      var stats = CopyStats()
      try copyDirectoryContents(
        from: source,
        to: stagingDestination,
        stats: &stats
      )
      try fileManager.moveItem(at: stagingDestination, to: finalDestination)
      resolveAndFinish(promise, [
        "cancelled": false,
        "destination_uri": finalDestination.absoluteString,
        "file_count": stats.fileCount,
        "total_bytes": stats.totalBytes,
      ])
    } catch {
      try? fileManager.removeItem(at: stagingDestination)
      rejectAndFinish(promise, code: "ERR_BACKUP_COPY", error: error)
    }
  }

  private func copyDirectoryContents(
    from source: URL,
    to destination: URL,
    stats: inout CopyStats
  ) throws {
    let fileManager = FileManager.default
    let children = try fileManager.contentsOfDirectory(
      at: source,
      includingPropertiesForKeys: [
        .isDirectoryKey,
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
      ],
      options: []
    ).sorted { $0.lastPathComponent < $1.lastPathComponent }

    for child in children {
      let values = try child.resourceValues(forKeys: [
        .isDirectoryKey,
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
      ])
      if values.isSymbolicLink == true {
        continue
      }
      let target = destination.appendingPathComponent(
        child.lastPathComponent,
        isDirectory: values.isDirectory == true
      )
      if values.isDirectory == true {
        try fileManager.createDirectory(at: target, withIntermediateDirectories: false)
        try copyDirectoryContents(from: child, to: target, stats: &stats)
      } else if values.isRegularFile == true {
        try fileManager.copyItem(at: child, to: target)
        stats.fileCount += 1
        stats.totalBytes += Int64(values.fileSize ?? 0)
      }
    }
  }

  private func resolveAndFinish(_ promise: Promise, _ result: [String: Any]) {
    DispatchQueue.main.async {
      self.operationInProgress = false
      self.pickerDelegate = nil
      promise.resolve(result)
    }
  }

  private func rejectAndFinish(
    _ promise: Promise,
    code: String,
    message: String
  ) {
    DispatchQueue.main.async {
      self.operationInProgress = false
      self.pickerDelegate = nil
      promise.reject(code, message)
    }
  }

  private func rejectAndFinish(_ promise: Promise, code: String, error: Error) {
    rejectAndFinish(promise, code: code, message: error.localizedDescription)
  }

  private func topViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow })?
      .rootViewController
    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    if let navigation = current as? UINavigationController {
      return navigation.visibleViewController ?? navigation
    }
    if let tabs = current as? UITabBarController {
      return tabs.selectedViewController ?? tabs
    }
    return current
  }
}
