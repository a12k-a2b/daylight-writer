package com.daylight.writer.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Android WorkManager CoroutineWorker for Daylight Writer background synchronization.
 *
 * Execution Model:
 * 1. Invoked on IO dispatcher by WorkManager under [NetworkType.CONNECTED] constraint.
 * 2. If the interactive WebView shell in [MainActivity] is running, coordinates via
 *    [NativeSyncQueueManager.webViewSyncCoordinator] to trigger in-app JavaScript SQLite draining.
 * 3. If running independently in the background (e.g. app suspended or folio closed), executes
 *    native synchronization routines draining the pending mutation queue.
 * 4. Applies exponential backoff retries (up to 3 attempts) on transient network or API failures.
 */
class DaylightSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "DaylightSyncWorker"
        const val MAX_RETRIES = 3
        const val WEB_SYNC_TIMEOUT_MS = 15000L
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.i(TAG, "Starting Daylight background sync job (attempt $runAttemptCount of $MAX_RETRIES, id=$id)")

        val syncManager = NativeSyncQueueManager.getInstance(applicationContext)

        try {
            // 1. Coordinate with running WebView if active
            val coordinator = syncManager.webViewSyncCoordinator
            if (coordinator != null) {
                Log.i(TAG, "WebView coordinator active; dispatching sync into JavaScript runtime")
                val webResult = withTimeoutOrNull(WEB_SYNC_TIMEOUT_MS) {
                    coordinator.invoke()
                }

                if (webResult != null) {
                    val (pushed, pulled) = webResult
                    Log.i(TAG, "In-app WebView sync succeeded: pushed=$pushed, pulled=$pulled")
                    syncManager.recordSyncSuccess(pushed, pulled)
                    return@withContext Result.success()
                } else {
                    Log.w(TAG, "WebView sync timed out or returned null; continuing with native sync")
                }
            }

            // 2. Perform atomic native background synchronization
            val result = executeNativeSync(syncManager)
            result
        } catch (e: Exception) {
            Log.e(TAG, "Daylight background sync encounter an error: ${e.message}", e)
            syncManager.recordSyncFailure(e.message ?: "Unknown sync error")

            if (runAttemptCount < MAX_RETRIES) {
                Log.i(TAG, "Requesting retry with exponential backoff (attempt $runAttemptCount)")
                Result.retry()
            } else {
                Log.e(TAG, "Max sync retries exceeded ($MAX_RETRIES); marking worker run as failure")
                Result.failure()
            }
        }
    }

    /**
     * Executes atomic native sync routines when WebView is not foregrounded.
     */
    private suspend fun executeNativeSync(syncManager: NativeSyncQueueManager): Result = withContext(Dispatchers.IO) {
        val (token, folderId) = syncManager.getSyncCredentials()
        val pendingCount = syncManager.getPendingCount()

        Log.i(TAG, "Executing native sync: pendingCount=$pendingCount, hasToken=${!token.isNullOrEmpty()}")

        // If user hasn't configured cloud storage credentials, complete cleanly without error
        if (token.isNullOrEmpty()) {
            Log.i(TAG, "No Google Drive credentials configured; skipping cloud sync cycle cleanly")
            syncManager.recordSyncSuccess(pushed = 0, pulled = 0)
            return@withContext Result.success()
        }

        // If queue is empty, complete cleanly
        if (pendingCount == 0) {
            Log.i(TAG, "Zero pending mutations in sync queue; sync cycle completed")
            syncManager.recordSyncSuccess(pushed = 0, pulled = 0)
            return@withContext Result.success()
        }

        // Drain pending queue
        val pushedCount = syncManager.drainPendingQueue(token, folderId)
        Log.i(TAG, "Native sync pushed $pushedCount mutations to remote storage")
        syncManager.recordSyncSuccess(pushed = pushedCount, pulled = 0)
        Result.success()
    }
}
