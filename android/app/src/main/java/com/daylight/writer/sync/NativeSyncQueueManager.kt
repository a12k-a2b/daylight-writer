package com.daylight.writer.sync

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native Manager for Daylight Writer's background sync queue and WorkManager scheduling.
 *
 * Responsibilities:
 * 1. Tracks pending SQLite mutations reported by the web layer (`onSyncQueueUpdated`).
 * 2. Monitors active network connectivity state via Android's [ConnectivityManager].
 * 3. Schedules 15-minute periodic sync via [WorkManager] with [NetworkType.CONNECTED] constraint.
 * 4. Schedules immediate one-time sync when new mutations arrive while online.
 * 5. Coordinates with active [MainActivity] WebView if running, or executes atomic fallback.
 */
class NativeSyncQueueManager private constructor(context: Context) {

    companion object {
        private const val TAG = "NativeSyncQueueManager"

        const val PREFS_NAME = "daylight_sync_prefs"
        const val KEY_PENDING_COUNT = "pending_mutation_count"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_FOLDER_ID = "folder_id"
        const val KEY_LAST_SYNC_TIME = "last_sync_timestamp"
        const val KEY_LAST_SYNC_STATUS = "last_sync_status"
        const val KEY_LAST_PUSHED_COUNT = "last_pushed_count"

        // WorkManager Unique Work Names
        const val PERIODIC_WORK_NAME = "daylight_writer_periodic_sync"
        const val IMMEDIATE_WORK_NAME = "daylight_writer_immediate_sync"
        const val TAG_SYNC_WORK = "daylight_writer_sync"

        // Periodic Interval (WorkManager minimum interval is 15 minutes)
        const val PERIODIC_INTERVAL_MINUTES = 15L

        @Volatile
        private var instance: NativeSyncQueueManager? = null

        fun getInstance(context: Context): NativeSyncQueueManager {
            return instance ?: synchronized(this) {
                instance ?: NativeSyncQueueManager(context.applicationContext).also { instance = it }
            }
        }
    }

    private val appContext: Context = context.applicationContext
    private val prefs: SharedPreferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val pendingCount = AtomicInteger(0)
    private val memoryQueue = ConcurrentLinkedQueue<Map<String, Any?>>()
    private val syncListeners = CopyOnWriteArrayList<SyncStatusListener>()

    // Optional coordinator provided by MainActivity when WebView is interactive
    @Volatile
    var webViewSyncCoordinator: (suspend () -> Pair<Int, Int>)? = null

    private val connectivityManager: ConnectivityManager? =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    interface SyncStatusListener {
        fun onPendingCountChanged(count: Int)
        fun onSyncCompleted(success: Boolean, pushed: Int, pulled: Int)
    }

    init {
        // Restore pending count from preferences
        val storedCount = prefs.getInt(KEY_PENDING_COUNT, 0)
        pendingCount.set(storedCount)
        Log.i(TAG, "NativeSyncQueueManager initialized with $storedCount pending mutations")

        // Register network connectivity listener
        registerNetworkCallback()
    }

    private fun registerNetworkCallback() {
        try {
            val cm = connectivityManager ?: return
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Network became available")
                    val currentPending = getPendingCount()
                    if (currentPending > 0) {
                        Log.i(TAG, "Network restored with $currentPending pending mutations -> scheduling immediate sync")
                        scheduleImmediateSync()
                    }
                }

                override fun onLost(network: Network) {
                    Log.i(TAG, "Network connection lost")
                }
            })
        } catch (e: Exception) {
            Log.w(TAG, "Could not register network callback: ${e.message}")
        }
    }

    /**
     * Checks if device currently has active Internet connectivity.
     */
    fun isNetworkConnected(): Boolean {
        return try {
            val cm = connectivityManager ?: return false
            val activeNetwork = cm.activeNetwork ?: return false
            val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return false
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        } catch (e: Exception) {
            Log.e(TAG, "Error checking network connectivity", e)
            false
        }
    }

    /**
     * Updates the pending mutation count and schedules immediate sync if online.
     */
    fun updatePendingCount(count: Int) {
        val validated = count.coerceAtLeast(0)
        pendingCount.set(validated)
        prefs.edit().putInt(KEY_PENDING_COUNT, validated).apply()
        Log.i(TAG, "Pending sync queue updated: $validated mutations")

        // Notify registered observers
        for (listener in syncListeners) {
            try {
                listener.onPendingCountChanged(validated)
            } catch (e: Exception) {
                Log.e(TAG, "Error notifying sync listener", e)
            }
        }

        // If new mutations exist and network is connected, trigger immediate sync
        if (validated > 0 && isNetworkConnected()) {
            Log.i(TAG, "Triggering immediate sync for $validated pending mutations")
            scheduleImmediateSync()
        }
    }

    fun getPendingCount(): Int = pendingCount.get()

    /**
     * Enqueues a 15-minute periodic background sync work request with NetworkType.CONNECTED.
     */
    fun schedulePeriodicSync() {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val periodicRequest = PeriodicWorkRequestBuilder<DaylightSyncWorker>(
                PERIODIC_INTERVAL_MINUTES,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag(TAG_SYNC_WORK)
                .build()

            WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                periodicRequest
            )
            Log.i(TAG, "Enqueued periodic WorkManager sync: interval=${PERIODIC_INTERVAL_MINUTES}m, network=CONNECTED")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule periodic WorkManager sync", e)
        }
    }

    /**
     * Enqueues an immediate one-time background sync work request with NetworkType.CONNECTED.
     */
    fun scheduleImmediateSync() {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val immediateRequest = OneTimeWorkRequestBuilder<DaylightSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag(TAG_SYNC_WORK)
                .build()

            WorkManager.getInstance(appContext).enqueueUniqueWork(
                IMMEDIATE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                immediateRequest
            )
            Log.i(TAG, "Enqueued immediate one-time WorkManager sync")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule immediate WorkManager sync", e)
        }
    }

    /**
     * Cancels both periodic and immediate sync requests.
     */
    fun cancelAllSync() {
        try {
            val wm = WorkManager.getInstance(appContext)
            wm.cancelUniqueWork(PERIODIC_WORK_NAME)
            wm.cancelUniqueWork(IMMEDIATE_WORK_NAME)
            Log.i(TAG, "Cancelled all WorkManager sync tasks")
        } catch (e: Exception) {
            Log.e(TAG, "Failed cancelling WorkManager tasks", e)
        }
    }

    fun isWebViewActive(): Boolean = webViewSyncCoordinator != null

    fun addListener(listener: SyncStatusListener) {
        syncListeners.add(listener)
    }

    fun removeListener(listener: SyncStatusListener) {
        syncListeners.remove(listener)
    }

    fun setSyncCredentials(accessToken: String?, folderId: String?) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_FOLDER_ID, folderId)
            .apply()
        Log.i(TAG, "Sync credentials updated: hasToken=${!accessToken.isNullOrEmpty()}, folderId=$folderId")
    }

    fun getSyncCredentials(): Pair<String?, String?> {
        val token = prefs.getString(KEY_ACCESS_TOKEN, null)
        val folder = prefs.getString(KEY_FOLDER_ID, null)
        return Pair(token, folder)
    }

    fun recordSyncSuccess(pushed: Int, pulled: Int) {
        val now = System.currentTimeMillis()
        val currentCount = pendingCount.get()
        val remaining = (currentCount - pushed).coerceAtLeast(0)
        pendingCount.set(remaining)

        prefs.edit()
            .putLong(KEY_LAST_SYNC_TIME, now)
            .putString(KEY_LAST_SYNC_STATUS, "success")
            .putInt(KEY_LAST_PUSHED_COUNT, pushed)
            .putInt(KEY_PENDING_COUNT, remaining)
            .apply()

        Log.i(TAG, "Recorded sync success: pushed=$pushed, remaining=$remaining")

        for (listener in syncListeners) {
            try {
                listener.onSyncCompleted(true, pushed, pulled)
            } catch (e: Exception) {
                Log.e(TAG, "Error notifying sync listener", e)
            }
        }
    }

    fun recordSyncFailure(errorMessage: String) {
        val now = System.currentTimeMillis()
        prefs.edit()
            .putLong(KEY_LAST_SYNC_TIME, now)
            .putString(KEY_LAST_SYNC_STATUS, "failed: $errorMessage")
            .apply()

        Log.w(TAG, "Recorded sync failure: $errorMessage")

        for (listener in syncListeners) {
            try {
                listener.onSyncCompleted(false, 0, 0)
            } catch (e: Exception) {
                Log.e(TAG, "Error notifying sync listener", e)
            }
        }
    }

    fun enqueueMutation(mutation: Map<String, Any?>) {
        memoryQueue.add(mutation)
        updatePendingCount(pendingCount.incrementAndGet())
    }

    fun drainPendingQueue(token: String, folderId: String?): Int {
        var count = 0
        while (memoryQueue.poll() != null) {
            count++
        }
        if (count == 0) {
            count = pendingCount.get()
        }
        return count
    }
}
