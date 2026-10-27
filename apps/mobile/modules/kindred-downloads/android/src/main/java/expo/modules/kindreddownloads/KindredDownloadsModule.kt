package expo.modules.kindreddownloads

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Saves a file into the phone's public Downloads folder through MediaStore (Android 10+, no permission
 * needed), like a browser download. Returns the name the system gave it (it adds " (1)" for duplicates).
 */
class KindredDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KindredDownloads")

    Constant("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    AsyncFunction("saveToDownloads") { sourceUri: String, name: String, mimeType: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw CodedException("Saving to Downloads needs Android 10 or newer")
      val resolver = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).contentResolver
      val source = File(Uri.parse(sourceUri).path ?: throw CodedException("Bad file path"))
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw CodedException("Couldn't create the file in Downloads")
      try {
        resolver.openOutputStream(target)?.use { out -> source.inputStream().use { it.copyTo(out) } }
          ?: throw CodedException("Couldn't write to Downloads")
        // Visible to other apps only once complete.
        resolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      } catch (e: Exception) {
        resolver.delete(target, null, null)
        throw e
      }
      resolver.query(target, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else name
      } ?: name
    }
  }
}
