package expo.modules.backupexport

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.URLConnection
import java.util.concurrent.Executors

private const val REQUEST_EXPORT_ARCHIVE = 7410
private const val REQUEST_COPY_FOLDER = 7411

private sealed class PendingBackup(val promise: Promise) {
  class Archive(
    promise: Promise,
    val source: File
  ) : PendingBackup(promise)

  class Folder(
    promise: Promise,
    val source: File,
    val destinationName: String
  ) : PendingBackup(promise)
}

private data class CopyStats(
  var fileCount: Int = 0,
  var totalBytes: Long = 0
)

/** Native SAF transfer so large recordings never cross the JS bridge. */
class BackupExportModule : Module() {
  @Volatile
  private var pending: PendingBackup? = null
  private val copyExecutor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("BackupExport")

    AsyncFunction("exportArchive") {
      archivePath: String,
      suggestedName: String,
      promise: Promise ->
      val source = File(archivePath)
      if (!source.isFile) {
        promise.reject(
          "ERR_BACKUP_SOURCE_MISSING",
          "The backup archive no longer exists.",
          null
        )
        return@AsyncFunction
      }
      if (!begin(PendingBackup.Archive(promise, source))) return@AsyncFunction
      val activity = appContext.currentActivity
      if (activity == null) {
        rejectPending("ERR_BACKUP_PRESENT", "Type could not open the file picker.")
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/zip"
        putExtra(Intent.EXTRA_TITLE, suggestedName)
      }
      activity.startActivityForResult(intent, REQUEST_EXPORT_ARCHIVE)
    }

    AsyncFunction("copyFolder") {
      sourcePath: String,
      destinationName: String,
      promise: Promise ->
      val source = File(sourcePath)
      if (!source.isDirectory) {
        promise.reject(
          "ERR_BACKUP_SOURCE_MISSING",
          "The working folder no longer exists.",
          null
        )
        return@AsyncFunction
      }
      if (!begin(PendingBackup.Folder(promise, source, destinationName))) {
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        rejectPending("ERR_BACKUP_PRESENT", "Type could not open the folder picker.")
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        )
      }
      activity.startActivityForResult(intent, REQUEST_COPY_FOLDER)
    }

    OnActivityResult { _, payload ->
      if (
        payload.requestCode != REQUEST_EXPORT_ARCHIVE &&
        payload.requestCode != REQUEST_COPY_FOLDER
      ) {
        return@OnActivityResult
      }
      val operation = pending ?: return@OnActivityResult
      val destination = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || destination == null) {
        resolvePending(mapOf("cancelled" to true))
        return@OnActivityResult
      }

      when (operation) {
        is PendingBackup.Archive -> copyArchive(operation, destination)
        is PendingBackup.Folder -> copyFolder(operation, destination, payload.data)
      }
    }

    OnDestroy {
      pending?.promise?.reject(
        "ERR_BACKUP_INTERRUPTED",
        "The backup was interrupted before it finished.",
        null
      )
      pending = null
      copyExecutor.shutdown()
    }
  }

  private fun begin(operation: PendingBackup): Boolean {
    if (pending != null) {
      operation.promise.reject(
        "ERR_BACKUP_BUSY",
        "Another backup picker is already open.",
        null
      )
      return false
    }
    pending = operation
    return true
  }

  private fun copyArchive(operation: PendingBackup.Archive, destination: Uri) {
    copyExecutor.execute {
      try {
        val resolver = appContext.reactContext?.contentResolver
          ?: throw IllegalStateException("Android storage is unavailable.")
        val output = resolver.openOutputStream(destination, "w")
          ?: throw IllegalStateException("The selected file cannot be written.")
        val copied = BufferedInputStream(FileInputStream(operation.source)).use { input ->
          BufferedOutputStream(output).use { target ->
            val bytes = input.copyTo(target, DEFAULT_BUFFER_SIZE * 8)
            target.flush()
            bytes
          }
        }
        if (copied != operation.source.length()) {
          throw IllegalStateException("The saved ZIP did not match the source archive.")
        }
        resolvePending(
          mapOf(
            "cancelled" to false,
            "destination_uri" to destination.toString(),
            "file_count" to 1,
            "total_bytes" to operation.source.length()
          )
        )
      } catch (error: Exception) {
        val resolver = appContext.reactContext?.contentResolver
        if (resolver != null) {
          try {
            DocumentsContract.deleteDocument(resolver, destination)
          } catch (_: Exception) {
            // Best effort cleanup of the partially written picker file.
          }
        }
        rejectPending("ERR_BACKUP_COPY", error.message ?: "The backup could not be saved.")
      }
    }
  }

  private fun copyFolder(
    operation: PendingBackup.Folder,
    destination: Uri,
    resultIntent: Intent?
  ) {
    val resolver = appContext.reactContext?.contentResolver
    if (resolver == null) {
      rejectPending("ERR_BACKUP_COPY", "Android storage is unavailable.")
      return
    }
    val grantFlags = (resultIntent?.flags ?: 0) and
      (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      resolver.takePersistableUriPermission(destination, grantFlags)
    } catch (_: SecurityException) {
      // The transient picker grant remains valid for this copy. Some document
      // providers simply do not offer persistable grants.
    }

    copyExecutor.execute {
      var createdRoot: Uri? = null
      try {
        val safeName = operation.destinationName
          .replace('/', '-')
          .replace(':', '-')
        val destinationDocument = DocumentsContract.buildDocumentUriUsingTree(
          destination,
          DocumentsContract.getTreeDocumentId(destination)
        )
        createdRoot = DocumentsContract.createDocument(
          resolver,
          destinationDocument,
          DocumentsContract.Document.MIME_TYPE_DIR,
          safeName
        ) ?: throw IllegalStateException("The selected provider could not create the backup folder.")

        val stats = CopyStats()
        copyDirectoryContents(operation.source, createdRoot, stats)
        resolvePending(
          mapOf(
            "cancelled" to false,
            "destination_uri" to createdRoot.toString(),
            "file_count" to stats.fileCount,
            "total_bytes" to stats.totalBytes
          )
        )
      } catch (error: Exception) {
        if (createdRoot != null) {
          try {
            DocumentsContract.deleteDocument(resolver, createdRoot)
          } catch (_: Exception) {
            // Best effort: the original error is more useful to the caller.
          }
        }
        rejectPending("ERR_BACKUP_COPY", error.message ?: "The folder could not be copied.")
      }
    }
  }

  private fun copyDirectoryContents(source: File, destination: Uri, stats: CopyStats) {
    val resolver = appContext.reactContext?.contentResolver
      ?: throw IllegalStateException("Android storage is unavailable.")
    val children = source.listFiles()?.sortedBy { it.name }
      ?: throw IllegalStateException("Could not read ${source.name}.")

    for (child in children) {
      if (isSymbolicLink(child)) continue
      if (child.isDirectory) {
        val directory = DocumentsContract.createDocument(
          resolver,
          destination,
          DocumentsContract.Document.MIME_TYPE_DIR,
          child.name
        ) ?: throw IllegalStateException("Could not create ${child.name}.")
        copyDirectoryContents(child, directory, stats)
      } else if (child.isFile) {
        val mime = URLConnection.guessContentTypeFromName(child.name)
          ?: "application/octet-stream"
        val fileUri = DocumentsContract.createDocument(
          resolver,
          destination,
          mime,
          child.name
        ) ?: throw IllegalStateException("Could not create ${child.name}.")
        val output = resolver.openOutputStream(fileUri, "w")
          ?: throw IllegalStateException("Could not write ${child.name}.")
        val copied = BufferedInputStream(FileInputStream(child)).use { input ->
          BufferedOutputStream(output).use { target ->
            val bytes = input.copyTo(target, DEFAULT_BUFFER_SIZE * 8)
            target.flush()
            bytes
          }
        }
        if (copied != child.length()) {
          throw IllegalStateException("The copied file ${child.name} was incomplete.")
        }
        stats.fileCount += 1
        stats.totalBytes += copied
      }
    }
  }

  private fun isSymbolicLink(file: File): Boolean = try {
    OsConstants.S_ISLNK(Os.lstat(file.absolutePath).st_mode)
  } catch (_: Exception) {
    false
  }

  private fun resolvePending(result: Map<String, Any>) {
    val operation = pending ?: return
    pending = null
    operation.promise.resolve(result)
  }

  private fun rejectPending(code: String, message: String) {
    val operation = pending ?: return
    pending = null
    operation.promise.reject(code, message, null)
  }
}
