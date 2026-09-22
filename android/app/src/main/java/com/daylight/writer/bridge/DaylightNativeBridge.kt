package com.daylight.writer.bridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.daylight.writer.saf.SafFileExporter
import com.daylight.writer.saf.SafFileImporter
import com.daylight.writer.saf.ShareSheetHelper
import com.daylight.writer.sync.NativeSyncQueueManager
import org.json.JSONObject

/**
 * Native bridge implementation registered on WebView as `window.DaylightBridge`.
 * Exposes Storage Access Framework operations, system share sheet, and hardware diagnostics
 * to the web application.
 *
 * Also manages the emergency SQLite WAL flush safety WakeLock triggered by the DC1 magnetic
 * folio cover Hall sensor or Activity lifecycle pauses, and background sync queue updates via WorkManager.
 */
class DaylightNativeBridge(
    private val context: Context,
    private val fileExporter: SafFileExporter,
    private val fileImporter: SafFileImporter,
    private val shareHelper: ShareSheetHelper,
    private val syncQueueManager: NativeSyncQueueManager = NativeSyncQueueManager.getInstance(context),
    private var onFlushCompletedListener: ((Boolean, Int) -> Unit)? = null,
    private var onSyncQueueUpdatedListener: ((Int) -> Unit)? = null
) : DaylightBridgeInterface {

    companion object {
        private const val TAG = "DaylightNativeBridge"
        const val WAKELOCK_TAG = "DaylightWriter:EmergencyFlush"
        const val WAKELOCK_TIMEOUT_MS = 3000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null

    init {
        try {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG)
        } catch (e: Exception) {
            Log.e(TAG, "Failed initializing WakeLock", e)
        }
    }

    /**
     * Acquires the emergency flush safety WakeLock with a 3000ms timeout ceiling.
     */
    @Synchronized
    fun acquireEmergencyWakeLock(timeoutMs: Long = WAKELOCK_TIMEOUT_MS) {
        try {
            if (wakeLock == null) {
                val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG)
            }
            wakeLock?.let { wl ->
                if (!wl.isHeld) {
                    wl.acquire(timeoutMs)
                    Log.i(TAG, "Acquired emergency partial wake lock for ${timeoutMs}ms")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed acquiring emergency wake lock", e)
        }
    }

    /**
     * Releases the emergency flush WakeLock safely if currently held.
     */
    @Synchronized
    fun releaseWakeLock() {
        try {
            wakeLock?.let { wl ->
                if (wl.isHeld) {
                    wl.release()
                    Log.i(TAG, "Released emergency partial wake lock")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed releasing emergency wake lock", e)
        }
    }

    fun isWakeLockHeld(): Boolean = wakeLock?.isHeld == true

    fun setOnFlushCompletedListener(listener: (Boolean, Int) -> Unit) {
        this.onFlushCompletedListener = listener
    }

    fun setOnSyncQueueUpdatedListener(listener: (Int) -> Unit) {
        this.onSyncQueueUpdatedListener = listener
    }

    @JavascriptInterface
    override fun exportDocument(
        filename: String,
        mimeType: String,
        base64Data: String,
        isBinary: Boolean
    ): Boolean {
        Log.i(TAG, "Bridge: exportDocument(filename='$filename', mimeType='$mimeType', isBinary=$isBinary)")
        return fileExporter.exportDocument(filename, mimeType, base64Data, isBinary)
    }

    @JavascriptInterface
    override fun requestOpenDocument(supportedExtensions: String): Boolean {
        Log.i(TAG, "Bridge: requestOpenDocument(supportedExtensions='$supportedExtensions')")
        return fileImporter.requestOpenDocument(supportedExtensions)
    }

    @JavascriptInterface
    override fun shareDocument(
        title: String,
        mimeType: String,
        contentOrBase64: String,
        isBinary: Boolean
    ): Boolean {
        Log.i(TAG, "Bridge: shareDocument(title='$title', mimeType='$mimeType', isBinary=$isBinary)")
        return shareHelper.shareDocument(title, mimeType, contentOrBase64, isBinary)
    }

    @JavascriptInterface
    override fun onFlushCompleted(success: Boolean, dirtyRemaining: Int) {
        Log.i(TAG, "Bridge: onFlushCompleted(success=$success, dirtyRemaining=$dirtyRemaining)")
        releaseWakeLock()
        mainHandler.post {
            onFlushCompletedListener?.invoke(success, dirtyRemaining)
        }
    }

    @JavascriptInterface
    override fun onSyncQueueUpdated(pendingCount: Int) {
        Log.i(TAG, "Bridge: onSyncQueueUpdated(pendingCount=$pendingCount)")
        syncQueueManager.updatePendingCount(pendingCount)
        mainHandler.post {
            onSyncQueueUpdatedListener?.invoke(pendingCount)
        }
    }

    /**
     * Triggers an immediate one-time background sync via NativeSyncQueueManager and WorkManager.
     */
    fun triggerImmediateSync(): Boolean {
        Log.i(TAG, "Bridge: triggerImmediateSync() requested")
        syncQueueManager.scheduleImmediateSync()
        return true
    }

    @JavascriptInterface
    fun requestImmediateSync(): Boolean {
        return triggerImmediateSync()
    }

    @JavascriptInterface
    fun setSyncCredentials(accessToken: String, folderId: String): Boolean {
        Log.i(TAG, "Bridge: setSyncCredentials received")
        syncQueueManager.setSyncCredentials(accessToken, folderId)
        return true
    }

    @JavascriptInterface
    override fun getDeviceInfo(): String {
        return JSONObject().apply {
            put("device", "DC1")
            put("model", "DC-1")
            put("display", "LivePaper")
            put("refreshHz", 120)
            put("osTokenVersion", 1)
            put("zeroEPD", true)
        }.toString()
    }

    @JavascriptInterface
    override fun showToast(message: String) {
        mainHandler.post {
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun ping(): String {
        return "PONG_DC1"
    }
}
