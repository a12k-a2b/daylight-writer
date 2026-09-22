package com.daylight.writer.hardware

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log

/**
 * Dynamic and manifest-compatible BroadcastReceiver for the DC1 magnetic folio cover Hall sensor.
 *
 * The Hall sensor switch is located on `/dev/input/event3` (`SW_LID`), and triggers
 * system broadcast [Intent.ACTION_SCREEN_OFF] when closed.
 *
 * Triggers an emergency SQLite WAL flush save point to eliminate data loss when the folio closes.
 */
class FolioHallSensorReceiver(
    private var onScreenOffListener: (() -> Unit)? = null
) : BroadcastReceiver() {

    /** Required no-arg constructor for Android OS component lifecycle & Proguard preservation */
    constructor() : this(null)

    companion object {
        private const val TAG = "FolioHallSensorReceiver"
        const val ACTION_SCREEN_OFF = Intent.ACTION_SCREEN_OFF

        fun createIntentFilter(): IntentFilter {
            return IntentFilter(Intent.ACTION_SCREEN_OFF)
        }
    }

    fun setOnScreenOffListener(listener: () -> Unit) {
        this.onScreenOffListener = listener
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_SCREEN_OFF) {
            Log.i(TAG, "Folio cover closed or screen turned off (ACTION_SCREEN_OFF) -> initiating emergency flush")
            onScreenOffListener?.invoke()
        }
    }
}
