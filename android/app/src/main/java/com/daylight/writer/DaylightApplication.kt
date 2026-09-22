package com.daylight.writer

import android.app.Application
import android.util.Log
import com.daylight.writer.sync.NativeSyncQueueManager

class DaylightApplication : Application() {
    companion object {
        private const val TAG = "DaylightApplication"
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Daylight Writer application initialized on DC1 Sol:OS")

        // Initialize NativeSyncQueueManager and schedule 15-min periodic background sync via WorkManager
        try {
            val syncManager = NativeSyncQueueManager.getInstance(this)
            syncManager.schedulePeriodicSync()
            Log.i(TAG, "Initialized NativeSyncQueueManager and enqueued periodic background sync")
        } catch (e: Exception) {
            Log.e(TAG, "Failed initializing NativeSyncQueueManager / WorkManager", e)
        }
    }
}
