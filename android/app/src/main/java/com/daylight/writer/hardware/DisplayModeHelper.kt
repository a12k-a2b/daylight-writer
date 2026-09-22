package com.daylight.writer.hardware

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.Surface
import android.view.View
import android.view.WindowManager

/**
 * Helper for managing DC1 120Hz display refresh mode locking and frame rate requests.
 *
 * Target Hardware: Daylight Computer DC1 (LivePaper Reflective LCD, MT8781 SoC).
 * Mode 2 on DC1 delivers native 120.00001 fps.
 */
object DisplayModeHelper {
    private const val TAG = "DisplayModeHelper"
    const val TARGET_REFRESH_RATE = 120.0f
    const val MIN_120HZ_THRESHOLD = 119.0f

    /**
     * Locks the window display mode to 120Hz on the DC1 tablet.
     *
     * Sets:
     * 1. [WindowManager.LayoutParams.preferredDisplayModeId] to Mode 2 (fps=120.00001).
     * 2. [WindowManager.LayoutParams.preferredMinDisplayRefreshRate] to 120.0f.
     * 3. [WindowManager.LayoutParams.preferredMaxDisplayRefreshRate] to 120.0f.
     *
     * @return The matched 120Hz [Display.Mode], or null if no 120Hz mode was found.
     */
    fun lock120Hz(activity: Activity): Display.Mode? {
        val window = activity.window
        val display = getDisplay(activity)

        val supportedModes = display?.supportedModes ?: emptyArray()
        Log.d(TAG, "Supported display modes count: ${supportedModes.size}")
        for (mode in supportedModes) {
            Log.d(TAG, "  Mode ID ${mode.modeId}: ${mode.physicalWidth}x${mode.physicalHeight} @ ${mode.refreshRate} fps")
        }

        // Locate Mode with refreshRate >= 119.0f (Mode 2 on DC1: fps=120.00001)
        val mode120 = supportedModes.firstOrNull { it.refreshRate >= MIN_120HZ_THRESHOLD }
            ?: supportedModes.maxByOrNull { it.refreshRate }

        val lp = window.attributes
        if (mode120 != null) {
            Log.i(TAG, "Locking preferredDisplayModeId to Mode ${mode120.modeId} (${mode120.refreshRate} fps)")
            lp.preferredDisplayModeId = mode120.modeId
        } else {
            Log.w(TAG, "No 120Hz display mode found; defaulting to highest available")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Log.i(TAG, "Locking preferredMin/MaxDisplayRefreshRate to $TARGET_REFRESH_RATE fps")
            lp.preferredRefreshRate = TARGET_REFRESH_RATE

            try {
                val minField = lp.javaClass.getField("preferredMinDisplayRefreshRate")
                minField.setFloat(lp, TARGET_REFRESH_RATE)
            } catch (_: Throwable) {
                // Handled gracefully if internal field is inaccessible
            }

            try {
                val maxField = lp.javaClass.getField("preferredMaxDisplayRefreshRate")
                maxField.setFloat(lp, TARGET_REFRESH_RATE)
            } catch (_: Throwable) {
                // Handled gracefully if internal field is inaccessible
            }
        }

        window.attributes = lp
        return mode120
    }

    /**
     * Retrieves the active [Display] safely across Android API versions.
     */
    private fun getDisplay(activity: Activity): Display? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                activity.display
            } catch (_: Throwable) {
                null
            }
        } else {
            @Suppress("DEPRECATION")
            activity.windowManager.defaultDisplay
        } ?: run {
            val displayManager = activity.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
            displayManager?.getDisplay(Display.DEFAULT_DISPLAY)
        }
    }

    /**
     * Gets the current active refresh rate reported by the display.
     */
    fun getActiveRefreshRate(activity: Activity): Float {
        val display = getDisplay(activity)
        return display?.mode?.refreshRate ?: display?.refreshRate ?: 0f
    }
}

/**
 * Extension function on [View] to request 120Hz frame rate on Android 11+ (API 30+).
 *
 * Resolves the compilation constraint where [View.setFrameRate] is not publicly exposed
 * in SDK 33/34 by safely targeting the underlying window [Surface] via ViewRootImpl.
 */
fun View.setFrameRate(
    frameRate: Float,
    compatibility: Int = Surface.FRAME_RATE_COMPATIBILITY_DEFAULT
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // 1. Try View.setFrameRate directly (available if exposed by platform/custom build)
        try {
            val method = View::class.java.getMethod(
                "setFrameRate",
                Float::class.javaPrimitiveType,
                Int::class.javaPrimitiveType
            )
            method.invoke(this, frameRate, compatibility)
            Log.d("DisplayModeHelper", "View.setFrameRate invoked successfully: $frameRate fps")
            return
        } catch (_: NoSuchMethodException) {
            // Fall through to ViewRootImpl / Surface reflection
        } catch (t: Throwable) {
            Log.w("DisplayModeHelper", "Failed invoking View.setFrameRate via reflection", t)
        }

        // 2. Delegate to the underlying Window Surface via ViewRootImpl
        val applyToSurface = {
            try {
                val getViewRootImplMethod = View::class.java.getMethod("getViewRootImpl")
                val viewRootImpl = getViewRootImplMethod.invoke(this)
                if (viewRootImpl != null) {
                    val surfaceField = viewRootImpl.javaClass.getDeclaredField("mSurface")
                    surfaceField.isAccessible = true
                    val surface = surfaceField.get(viewRootImpl) as? Surface
                    if (surface != null && surface.isValid) {
                        surface.setFrameRate(frameRate, compatibility)
                        Log.d("DisplayModeHelper", "Surface.setFrameRate invoked on Window Surface: $frameRate fps")
                    }
                }
            } catch (t: Throwable) {
                Log.w("DisplayModeHelper", "Failed setting frame rate on ViewRootImpl Surface", t)
            }
        }

        if (isAttachedToWindow) {
            post { applyToSurface() }
        } else {
            addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) {
                    removeOnAttachStateChangeListener(this)
                    post { applyToSurface() }
                }
                override fun onViewDetachedFromWindow(v: View) {}
            })
        }
    }
}
