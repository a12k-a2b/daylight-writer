package com.daylight.writer.hardware

import android.util.Log
import android.view.KeyEvent
import android.webkit.WebView

/**
 * Handles DC1 physical chassis buttons and hardware keyboard event interception.
 *
 * Implements:
 * 1. DC1 chassis Action / Top button (`mtk-kpd` scancode 88 / [KeyEvent.KEYCODE_F12], keycode 142):
 *    Directly evaluates `window.DaylightBridgeClient?.onHardwareActionButton?.();` with sub-16ms latency.
 * 2. Physical keyboard Escape key ([KeyEvent.KEYCODE_ESCAPE], keycode 111):
 *    Evaluates `window.DaylightBridgeClient?.dispatchKeyboardAction?.('dismiss_drawers');` and returns true
 *    to light-dismiss UI drawers and modals, preventing Android system back navigation from exiting the app.
 * 3. Constant definitions for keycodes and redundant Sol:OS system server broadcasts.
 */
class HardwareKeyInterceptor(
    private val webViewProvider: () -> WebView?
) {
    companion object {
        private const val TAG = "HardwareKeyInterceptor"

        /** DC1 chassis Action/Top button on mtk-kpd (scancode 88) */
        const val KEYCODE_ACTION_BUTTON = KeyEvent.KEYCODE_F12 // 142

        /** Physical keyboard Escape key */
        const val KEYCODE_ESCAPE = KeyEvent.KEYCODE_ESCAPE // 111

        /** Redundant Sol:OS system server broadcast for Action button single press */
        const val ACTION_BUTTON_BROADCAST =
            "com.daylightcomputer.solosserver.ACTION_BUTTON_SINGLE_PRESS"

        /** JS reverse dispatch expressions */
        const val JS_ACTION_BUTTON =
            "window.DaylightBridgeClient?.onHardwareActionButton?.();"
        const val JS_DISMISS_DRAWERS =
            "window.DaylightBridgeClient?.dispatchKeyboardAction?.('dismiss_drawers');"
    }

    /**
     * Intercepts key events during Activity dispatch.
     * Consumes KEYCODE_F12 and KEYCODE_ESCAPE on ACTION_DOWN.
     *
     * @return true if the event was consumed, false otherwise.
     */
    fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KEYCODE_ACTION_BUTTON -> {
                    triggerActionButton()
                    return true
                }
                KEYCODE_ESCAPE -> {
                    triggerEscape()
                    return true
                }
            }
        }
        return false
    }

    /**
     * Dispatches Action Button event into WebView runtime with sub-16ms latency.
     */
    fun triggerActionButton() {
        Log.i(TAG, "Triggering Action Button reverse dispatch (<16ms latency)")
        val webView = webViewProvider()
        webView?.evaluateJavascript(JS_ACTION_BUTTON, null)
    }

    /**
     * Dispatches Escape key drawer dismissal into WebView runtime.
     */
    fun triggerEscape() {
        Log.i(TAG, "Triggering Escape key light-dismissal")
        val webView = webViewProvider()
        webView?.evaluateJavascript(JS_DISMISS_DRAWERS, null)
    }
}
