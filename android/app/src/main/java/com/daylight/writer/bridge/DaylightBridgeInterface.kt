package com.daylight.writer.bridge

import android.webkit.JavascriptInterface

/**
 * Type-safe JavaScript-to-Kotlin bridge interface for Daylight Writer.
 * Exposed to JavaScript execution contexts under `window.DaylightBridge`.
 */
interface DaylightBridgeInterface {

    /**
     * Trigger Android Storage Access Framework (SAF) save file picker (Intent.ACTION_CREATE_DOCUMENT).
     *
     * @param filename Suggested file name (e.g. "Manuscript.md", "Chapter_1.txt", "Anthology.pdf")
     * @param mimeType MIME type (e.g. "text/markdown", "text/plain", "application/pdf")
     * @param base64Data Raw content encoded as UTF-8 string or Base64 (for binary formats)
     * @param isBinary True for binary formats (.docx, .pdf), false for text (.md, .txt)
     * @return True if export request was validated and picker launched, false otherwise
     */
    @JavascriptInterface
    fun exportDocument(
        filename: String,
        mimeType: String,
        base64Data: String,
        isBinary: Boolean
    ): Boolean

    /**
     * Trigger Android SAF Open Document picker (Intent.ACTION_OPEN_DOCUMENT).
     *
     * @param supportedExtensions Comma-separated list or JSON array of extensions (".md,.txt")
     * @return True if open request was validated and picker launched, false otherwise
     */
    @JavascriptInterface
    fun requestOpenDocument(supportedExtensions: String): Boolean

    /**
     * Trigger Android Native Share Sheet (Intent.ACTION_SEND wrapped in Intent.createChooser).
     *
     * @param title Share title / subject
     * @param mimeType Share MIME type
     * @param contentOrBase64 Text body or Base64-encoded binary attachment
     * @param isBinary True if sharing binary attachment via FileProvider, false for plain text
     * @return True if share intent was created and dispatched, false otherwise
     */
    @JavascriptInterface
    fun shareDocument(
        title: String,
        mimeType: String,
        contentOrBase64: String,
        isBinary: Boolean
    ): Boolean

    /**
     * Notify native Android that a transaction flush completed.
     *
     * @param success Whether SQLite WAL flush succeeded
     * @param dirtyRemaining Number of unsaved dirty records
     */
    @JavascriptInterface
    fun onFlushCompleted(success: Boolean, dirtyRemaining: Int)

    /**
     * Notify native Android WorkManager that new mutations have been queued.
     *
     * @param pendingCount Total number of pending sync mutations
     */
    @JavascriptInterface
    fun onSyncQueueUpdated(pendingCount: Int)

    /**
     * Query DC1 device specs and capabilities.
     *
     * @return JSON string containing hardware specifications and display capabilities
     */
    @JavascriptInterface
    fun getDeviceInfo(): String

    /**
     * Display a native Sol:OS toast notification.
     *
     * @param message Text to display
     */
    @JavascriptInterface
    fun showToast(message: String)
}
