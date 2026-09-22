package com.daylight.writer.saf

import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject

/**
 * Manages external file ingestion via Android's Storage Access Framework (SAF)
 * and Intent.ACTION_VIEW.
 *
 * Provides:
 * 1. SAF Open Document picker via [ActivityResultContracts.OpenDocument].
 * 2. Ingestion of external file URIs from file managers and email attachments.
 * 3. Metadata resolution (display name, file size) via [OpenableColumns].
 * 4. Content streaming and dispatching into the web editor via `window.DaylightBridgeClient.importExternalDocument`.
 */
class SafFileImporter(
    private val activity: ComponentActivity,
    private val webViewProvider: () -> WebView?
) {

    companion object {
        private const val TAG = "SafFileImporter"
    }

    private val launcher: ActivityResultLauncher<Array<String>>
    private var isWebReady: Boolean = false
    private var pendingPayload: JSONObject? = null

    init {
        launcher = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
            if (uri != null) {
                importUri(uri)
            } else {
                Log.i(TAG, "OpenDocument picker was cancelled by user")
            }
        }
    }

    /**
     * Called when the web page finishes loading and `window.DaylightBridgeClient` is available.
     * Flushes any pending external document import that arrived before the web canvas was ready.
     */
    fun onWebPageReady() {
        isWebReady = true
        pendingPayload?.let { payload ->
            Log.i(TAG, "Flushing queued external document to ready web editor")
            dispatchPayloadToEditor(payload)
            pendingPayload = null
        }
    }

    /**
     * Launches the native SAF OpenDocument file picker.
     *
     * @param supportedExtensions Comma/semicolon-separated list of extensions (e.g. ".md,.txt")
     * @return True if extension parameter was valid and picker was launched, false otherwise
     */
    fun requestOpenDocument(supportedExtensions: String): Boolean {
        if (supportedExtensions.isBlank()) {
            Log.w(TAG, "requestOpenDocument rejected: supportedExtensions is empty or whitespace-only")
            return false
        }

        val mimeTypes = parseExtensionsToMimeTypes(supportedExtensions)

        activity.runOnUiThread {
            try {
                launcher.launch(mimeTypes)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch OpenDocument picker for extensions: $supportedExtensions", e)
            }
        }

        return true
    }

    /**
     * Ingests a document from an external URI (from SAF or Intent.ACTION_VIEW),
     * reads its contents via ContentResolver, and forwards it to the web editor.
     *
     * @param uri Content or file URI to ingest
     */
    fun importUri(uri: Uri) {
        try {
            var displayName = "Imported Document"
            var fileSize = -1L

            // Resolve file metadata via OpenableColumns
            try {
                activity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIndex != -1 && !cursor.isNull(nameIndex)) {
                            displayName = cursor.getString(nameIndex)
                        }
                        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIndex != -1 && !cursor.isNull(sizeIndex)) {
                            fileSize = cursor.getLong(sizeIndex)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not resolve metadata from OpenableColumns for uri: $uri", e)
                uri.lastPathSegment?.let { segment ->
                    displayName = segment.substringAfterLast('/')
                }
            }

            // Stream text content via ContentResolver
            val content = activity.contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            } ?: ""

            // Resolve MIME type
            val resolvedMime = activity.contentResolver.getType(uri) ?: when {
                displayName.endsWith(".md", ignoreCase = true) -> "text/markdown"
                displayName.endsWith(".txt", ignoreCase = true) -> "text/plain"
                displayName.endsWith(".pdf", ignoreCase = true) -> "application/pdf"
                displayName.endsWith(".docx", ignoreCase = true) -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                else -> "text/plain"
            }

            val payload = JSONObject().apply {
                put("title", displayName)
                put("content", content)
                put("mimeType", resolvedMime)
            }

            Log.i(TAG, "Ingested external file: title='$displayName', size=${content.length} chars, mime='$resolvedMime'")

            if (isWebReady) {
                dispatchPayloadToEditor(payload)
            } else {
                Log.i(TAG, "Web editor not yet ready; queuing import for '$displayName'")
                pendingPayload = payload
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed importing document from uri: $uri", e)
        }
    }

    /**
     * Evaluates JavaScript to forward the document into the web editor canvas.
     */
    private fun dispatchPayloadToEditor(payload: JSONObject) {
        val serializedPayload = payload.toString()
        val js = "window.DaylightBridgeClient?.importExternalDocument($serializedPayload);"
        activity.runOnUiThread {
            webViewProvider()?.evaluateJavascript(js) { result ->
                Log.i(TAG, "Dispatched imported document to editor; docId result: $result")
            }
        }
    }

    /**
     * Converts a comma/semicolon/space-delimited string of extensions into an array of MIME types.
     */
    private fun parseExtensionsToMimeTypes(extensions: String): Array<String> {
        val items = extensions.split(",", ";", " ", "|")
            .map { it.trim().removePrefix(".") }
            .filter { it.isNotEmpty() }

        val mimeSet = mutableSetOf<String>()
        for (item in items) {
            when (item.lowercase()) {
                "md", "markdown" -> {
                    mimeSet.add("text/markdown")
                    mimeSet.add("text/x-markdown")
                    mimeSet.add("text/plain")
                }
                "txt", "text" -> {
                    mimeSet.add("text/plain")
                }
                "pdf" -> {
                    mimeSet.add("application/pdf")
                }
                "docx" -> {
                    mimeSet.add("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                }
                "*" -> {
                    mimeSet.add("*/*")
                }
                else -> {
                    val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(item)
                    if (mime != null) {
                        mimeSet.add(mime)
                    }
                }
            }
        }

        if (mimeSet.isEmpty()) {
            mimeSet.add("*/*")
        }

        return mimeSet.toTypedArray()
    }
}
