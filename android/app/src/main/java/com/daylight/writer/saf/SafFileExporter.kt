package com.daylight.writer.saf

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Manages native document exports using Android's Storage Access Framework (SAF).
 *
 * Utilizes [ActivityResultContracts.CreateDocument] to present the native file picker
 * allowing users to export Markdown (.md), Plain Text (.txt), Word (.docx), and PDF (.pdf)
 * files directly to internal storage, SD cards, or external USB-C drives.
 */
class SafFileExporter(
    private val activity: ComponentActivity
) {

    companion object {
        private const val TAG = "SafFileExporter"
    }

    /**
     * Payload containing document export metadata and decoded bytes.
     */
    data class ExportPayload(
        val filename: String,
        val mimeType: String,
        val rawBytes: ByteArray,
        val isBinary: Boolean
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false
            other as ExportPayload
            if (filename != other.filename) return false
            if (mimeType != other.mimeType) return false
            if (!rawBytes.contentEquals(other.rawBytes)) return false
            if (isBinary != other.isBinary) return false
            return true
        }

        override fun hashCode(): Int {
            var result = filename.hashCode()
            result = 31 * result + mimeType.hashCode()
            result = 31 * result + rawBytes.contentHashCode()
            result = 31 * result + isBinary.hashCode()
            return result
        }
    }

    /**
     * Dynamic contract extending [ActivityResultContracts.CreateDocument] to customize
     * the MIME type per export invocation.
     */
    class DynamicCreateDocumentContract : ActivityResultContracts.CreateDocument("*/*") {
        var mimeType: String = "*/*"

        override fun createIntent(context: Context, input: String): Intent {
            val intent = super.createIntent(context, input)
            intent.type = mimeType
            return intent
        }
    }

    private val contract = DynamicCreateDocumentContract()
    private val launcher: ActivityResultLauncher<String>
    private var pendingPayload: ExportPayload? = null

    init {
        launcher = activity.registerForActivityResult(contract) { uri: Uri? ->
            handleCreateDocumentResult(uri)
        }
    }

    /**
     * Prepares and launches the native SAF CreateDocument file picker.
     *
     * @param filename Target file name (e.g. "Chapter_1.md")
     * @param mimeType Target MIME type (e.g. "text/markdown")
     * @param base64Data UTF-8 text or Base64-encoded binary content
     * @param isBinary True if format is binary (.docx, .pdf), false for text (.md, .txt)
     * @return True if arguments are valid and picker was launched, false otherwise
     */
    fun exportDocument(
        filename: String,
        mimeType: String,
        base64Data: String,
        isBinary: Boolean
    ): Boolean {
        if (filename.isBlank() || mimeType.isBlank()) {
            Log.w(TAG, "exportDocument rejected: filename or mimeType is blank (filename='$filename', mimeType='$mimeType')")
            return false
        }

        val rawBytes = try {
            if (isBinary) {
                Base64.decode(base64Data, Base64.DEFAULT)
            } else {
                base64Data.toByteArray(Charsets.UTF_8)
            }
        } catch (e: Exception) {
            Log.e(TAG, "exportDocument rejected: failed to decode export payload", e)
            return false
        }

        val payload = ExportPayload(
            filename = filename,
            mimeType = mimeType,
            rawBytes = rawBytes,
            isBinary = isBinary
        )

        pendingPayload = payload
        contract.mimeType = mimeType

        activity.runOnUiThread {
            try {
                launcher.launch(filename)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch CreateDocument file picker for $filename", e)
                pendingPayload = null
            }
        }

        return true
    }

    /**
     * Streams payload bytes to the user-selected destination URI.
     */
    private fun handleCreateDocumentResult(uri: Uri?) {
        val payload = pendingPayload
        pendingPayload = null

        if (uri == null) {
            Log.i(TAG, "User dismissed or cancelled CreateDocument picker")
            return
        }

        if (payload == null) {
            Log.w(TAG, "CreateDocument returned uri $uri but pending payload was null")
            return
        }

        try {
            activity.contentResolver.openOutputStream(uri, "wt")?.use { outputStream ->
                outputStream.write(payload.rawBytes)
                outputStream.flush()
            }
            Log.i(TAG, "Successfully exported ${payload.rawBytes.size} bytes for '${payload.filename}' to $uri")
        } catch (e: Exception) {
            Log.e(TAG, "Failed writing export payload to SAF destination: $uri", e)
        }
    }
}
