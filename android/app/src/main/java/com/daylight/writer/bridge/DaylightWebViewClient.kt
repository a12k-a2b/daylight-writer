package com.daylight.writer.bridge

import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Build
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi
import androidx.webkit.WebViewAssetLoader

/**
 * Specialized WebViewClient for Daylight Writer on DC1 Sol:OS.
 *
 * Responsibilities:
 * 1. Delegates resource requests to WebViewAssetLoader.
 * 2. Safely handles SSL errors for the virtual domain appassets.androidplatform.net.
 * 3. Catches and logs main-frame and subresource errors without disrupting editor operation.
 * 4. Implements render process crash recovery (onRenderProcessGone).
 */
class DaylightWebViewClient(
    private val assetLoader: WebViewAssetLoader,
    private val onPageReadyListener: (() -> Unit)? = null,
    private val onRendererCrashListener: (() -> Unit)? = null
) : WebViewClient() {

    companion object {
        private const val TAG = "DaylightWebViewClient"
        private const val ASSET_DOMAIN = "appassets.androidplatform.net"
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val url = request?.url ?: return null
        val response = assetLoader.shouldInterceptRequest(url)
        if (response != null) {
            return response
        }

        // If request belongs to our virtual domain but was unhandled, log diagnostic info
        if (url.host == ASSET_DOMAIN) {
            Log.e(TAG, "Unhandled virtual asset request: $url")
        }
        return null
    }

    @Deprecated("Deprecated in Java", ReplaceWith("shouldInterceptRequest(view, request)"))
    override fun shouldInterceptRequest(view: WebView?, url: String?): WebResourceResponse? {
        val uri = url?.let { android.net.Uri.parse(it) } ?: return null
        return assetLoader.shouldInterceptRequest(uri)
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        val failingUrl = error?.url.orEmpty()
        if (failingUrl.contains(ASSET_DOMAIN)) {
            Log.w(TAG, "Bypassing SSL error for virtual domain ($failingUrl): $error")
            handler?.proceed()
        } else {
            Log.e(TAG, "Refusing SSL error on external domain ($failingUrl): $error")
            handler?.cancel()
        }
    }

    @RequiresApi(Build.VERSION_CODES.M)
    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        val isMainFrame = request?.isForMainFrame ?: false
        val url = request?.url?.toString() ?: "unknown"
        val desc = error?.description ?: "unknown error"
        val code = error?.errorCode ?: -1

        if (isMainFrame) {
            Log.e(TAG, "CRITICAL: Main frame load error: $code - $desc at $url")
        } else {
            Log.w(TAG, "Subresource error: $code - $desc at $url")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onReceivedError(
        view: WebView?,
        errorCode: Int,
        description: String?,
        failingUrl: String?
    ) {
        Log.e(TAG, "Legacy receivedError: $errorCode - $description at $failingUrl")
    }

    override fun onReceivedHttpError(
        view: WebView?,
        request: WebResourceRequest?,
        errorResponse: WebResourceResponse?
    ) {
        val url = request?.url?.toString() ?: "unknown"
        val status = errorResponse?.statusCode ?: -1
        Log.w(TAG, "HTTP error $status for $url")
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        Log.i(TAG, "Page load started: $url")
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        Log.i(TAG, "Page load finished: $url")
        onPageReadyListener?.invoke()
    }

    override fun onRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
    ): Boolean {
        val crashed = detail?.didCrash() ?: false
        val priority = detail?.rendererPriorityAtExit() ?: -1
        Log.e(TAG, "Chromium render process gone (didCrash: $crashed, priority: $priority)")
        onRendererCrashListener?.invoke()
        return true
    }
}
