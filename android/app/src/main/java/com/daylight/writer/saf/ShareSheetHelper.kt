package com.daylight.writer.saf

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * Facilitates native system sharing via Android's Intent.ACTION_SEND share sheet.
 *
 * Supports:
 * 1. Plain text and markdown snippet sharing directly via Intent.EXTRA_TEXT.
 * 2. Binary document attachment sharing (.pdf, .docx) via [FileProvider] content URIs.
 */
class ShareSheetHelper(
    private val context: Context
) {

    companion object {
        private const val TAG = "ShareSheetHelper"
        private const val SHARED_EXPORTS_DIR = "shared_exports"
    }

    private val authority: String = "${context.packageName}.fileprovider"

    /**
     * Dispatches a document or excerpt to the native Android system share sheet.
     *
     * @param title Title or subject of the share payload
     * @param mimeType MIME type of the content (must not be blank)
     * @param contentOrBase64 Plain text or Base64-encoded binary data
     * @param isBinary True if content is Base64 binary, false if plain text
     * @return True if share intent was created and chooser launched, false otherwise
     */
    fun shareDocument(
        title: String,
        mimeType: String,
        contentOrBase64: String,
        isBinary: Boolean
    ): Boolean {
        if (mimeType.isBlank()) {
            Log.w(TAG, "shareDocument rejected: mimeType is blank")
            return false
        }

        return try {
            val shareIntent = if (isBinary) {
                createBinaryShareIntent(title, mimeType, contentOrBase64) ?: return false
            } else {
                createTextShareIntent(title, mimeType, contentOrBase64)
            }

            val chooserTitle = title.ifBlank { "Share Manuscript" }
            val chooser = Intent.createChooser(shareIntent, chooserTitle).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch Android system share sheet", e)
            false
        }
    }

    private fun createTextShareIntent(
        title: String,
        mimeType: String,
        text: String
    ): Intent {
        return Intent(Intent.ACTION_SEND).apply {
            type = mimeType.ifBlank { "text/plain" }
            putExtra(Intent.EXTRA_TITLE, title)
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, text)
        }
    }

    private fun createBinaryShareIntent(
        title: String,
        mimeType: String,
        base64Data: String
    ): Intent? {
        val binaryBytes = try {
            Base64.decode(base64Data, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.e(TAG, "Failed decoding base64 data for binary share", e)
            return null
        }

        // Sanitize filename to avoid path traversal, illegal slashes, or invalid characters
        val rawName = title.ifBlank { "manuscript" }
        val safeName = rawName.replace("[/\\\\:*?\"<>|]".toRegex(), "_")

        val exportDir = File(context.cacheDir, SHARED_EXPORTS_DIR).apply {
            if (!exists()) {
                mkdirs()
            }
        }
        val targetFile = File(exportDir, safeName)

        return try {
            FileOutputStream(targetFile).use { fos ->
                fos.write(binaryBytes)
                fos.flush()
            }

            val contentUri: Uri = FileProvider.getUriForFile(context, authority, targetFile)

            Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, contentUri)
                putExtra(Intent.EXTRA_TITLE, title)
                putExtra(Intent.EXTRA_SUBJECT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed creating binary share attachment file for '$safeName'", e)
            null
        }
    }
}
