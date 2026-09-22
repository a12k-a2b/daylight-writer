package com.daylight.writer

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.Surface
import android.view.View
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.daylight.writer.bridge.DaylightAssetsPathHandler
import com.daylight.writer.bridge.DaylightNativeBridge
import com.daylight.writer.bridge.DaylightWebViewClient
import com.daylight.writer.hardware.DisplayModeHelper
import com.daylight.writer.hardware.FolioHallSensorReceiver
import com.daylight.writer.hardware.HardwareKeyInterceptor
import com.daylight.writer.hardware.setFrameRate
import com.daylight.writer.saf.SafFileExporter
import com.daylight.writer.saf.SafFileImporter
import com.daylight.writer.saf.ShareSheetHelper
import com.daylight.writer.sync.NativeSyncQueueManager
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Main Activity embedding Daylight Writer inside an optimized, 120Hz hardware-accelerated WebView.
 *
 * Provides:
 * 1. 100% Immersive edge-to-edge canvas without browser chrome or system bars.
 * 2. DC1 120Hz display refresh mode locking.
 * 3. Mali-G57 GPU hardware layer acceleration with offscreenPreRaster enabled.
 * 4. Secure local asset serving via [WebViewAssetLoader] with custom [DaylightAssetsPathHandler].
 * 5. Storage Access Framework (SAF) export, open, and system share sheet via [DaylightNativeBridge].
 * 6. DC1 Chassis Action/Top button (`mtk-kpd` F12 scancode 88) & Escape key zero-latency interception.
 * 7. Folio cover Hall sensor (`/dev/input/event3` SW_LID) emergency save point with safety WakeLock.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val ASSET_DOMAIN = "appassets.androidplatform.net"
        private const val ENTRY_URL = "https://appassets.androidplatform.net/assets/index.html"
    }

    private lateinit var webView: WebView
    lateinit var fileExporter: SafFileExporter
        private set
    lateinit var fileImporter: SafFileImporter
        private set
    lateinit var shareHelper: ShareSheetHelper
        private set
    lateinit var bridge: DaylightNativeBridge
        private set
    lateinit var hardwareKeyInterceptor: HardwareKeyInterceptor
        private set

    private lateinit var folioHallSensorReceiver: FolioHallSensorReceiver
    private lateinit var actionButtonReceiver: BroadcastReceiver

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Configure 100% Immersive Edge-to-Edge display
        setupImmersiveMode()

        // 2. Lock DC1 Display Mode to Mode 2 (120Hz)
        val lockedMode = DisplayModeHelper.lock120Hz(this)
        Log.i(TAG, "Display mode locked: ${lockedMode?.modeId} @ ${lockedMode?.refreshRate} fps")

        // 3. Initialize SAF, Native Bridge, and Hardware Interception Helpers
        fileExporter = SafFileExporter(this)
        fileImporter = SafFileImporter(this) { webView }
        shareHelper = ShareSheetHelper(this)
        bridge = DaylightNativeBridge(
            context = this,
            fileExporter = fileExporter,
            fileImporter = fileImporter,
            shareHelper = shareHelper
        )
        hardwareKeyInterceptor = HardwareKeyInterceptor { webView }
        setupSyncCoordinator()

        // 4. Initialize WebView Shell
        webView = WebView(this).apply {
            // Hardware acceleration backed by Mali-G57 GPU
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            // Set Sol:OS --os-0 (#FFFFFF) base canvas background
            setBackgroundColor(Color.WHITE)

            // Disable Android 12+ rubber-band overscroll glow/stretch
            overScrollMode = View.OVER_SCROLL_NEVER

            // Enable focus for physical keyboard and stylus input
            isFocusable = true
            isFocusableInTouchMode = true

            // Request 120Hz frame rate on attached Window Surface
            setFrameRate(120.0f, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT)
        }

        // 5. Register DaylightNativeBridge on JavaScript interface
        webView.addJavascriptInterface(bridge, "DaylightBridge")

        // 6. Configure WebView Performance & Storage Settings
        configureWebViewSettings(webView.settings)

        // 7. Setup WebViewAssetLoader & DaylightWebViewClient
        val pathHandler = DaylightAssetsPathHandler(applicationContext)
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/assets/", pathHandler)
            .addPathHandler("/", pathHandler)
            .build()

        webView.webViewClient = DaylightWebViewClient(
            assetLoader = assetLoader,
            onPageReadyListener = {
                Log.i(TAG, "Daylight Writer web canvas ready")
                hideSystemBars()
                injectBridgeInitializationScript()
                fileImporter.onWebPageReady()
            },
            onRendererCrashListener = {
                Log.e(TAG, "Renderer crash detected; recovering WebView")
                recreateWebView()
            }
        )

        setContentView(webView)

        // 8. Register Dynamic Broadcast Receivers for Folio Hall Sensor & Sol:OS Action Button
        setupDynamicReceivers()

        // 9. Handle incoming Intent if launched with ACTION_VIEW
        handleViewIntent(intent)

        // 10. Load Daylight Writer local production bundle
        Log.i(TAG, "Loading entry URL: $ENTRY_URL")
        webView.loadUrl(ENTRY_URL)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent?.let { handleViewIntent(it) }
    }

    /**
     * Registers dynamic receivers for DC1 chassis events:
     * - Folio cover Hall switch: [Intent.ACTION_SCREEN_OFF]
     * - Redundant Action button trigger: [HardwareKeyInterceptor.ACTION_BUTTON_BROADCAST]
     */
    private fun setupDynamicReceivers() {
        // Hall sensor receiver for SW_LID / screen-off save point
        folioHallSensorReceiver = FolioHallSensorReceiver {
            triggerEmergencySavePoint()
        }
        registerReceiver(folioHallSensorReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF))

        // Redundant action button broadcast receiver
        actionButtonReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == HardwareKeyInterceptor.ACTION_BUTTON_BROADCAST) {
                    Log.i(TAG, "Sol:OS ACTION_BUTTON_SINGLE_PRESS received -> triggering action button")
                    hardwareKeyInterceptor.triggerActionButton()
                }
            }
        }
        val actionButtonFilter = IntentFilter(HardwareKeyInterceptor.ACTION_BUTTON_BROADCAST)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(actionButtonReceiver, actionButtonFilter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(actionButtonReceiver, actionButtonFilter)
        }
    }

    /**
     * Handles hardware key events with zero-latency (<16ms) interception.
     * Consumes KEYCODE_F12 (Action button) and KEYCODE_ESCAPE (light-dismiss drawers).
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                // DC1 chassis Top/Action button (scancode 88 / keycode 142 from mtk-kpd)
                KeyEvent.KEYCODE_F12 -> {
                    hardwareKeyInterceptor.triggerActionButton()
                    return true
                }
                // Physical keyboard Escape (keycode 111) -> light-dismiss drawers, prevent back exit
                KeyEvent.KEYCODE_ESCAPE -> {
                    hardwareKeyInterceptor.triggerEscape()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    /**
     * Triggers emergency SQLite WAL flush save point.
     * Acquires a 3000ms safety WakeLock and evaluates JS flushPendingEdits().
     * The WakeLock is released when onFlushCompleted callback is received.
     */
    fun triggerEmergencySavePoint() {
        Log.i(TAG, "Triggering emergency SQLite save point with 3000ms safety WakeLock")
        bridge.acquireEmergencyWakeLock(3000L)
        webView.evaluateJavascript("window.DaylightBridgeClient?.flushPendingEdits?.();", null)
    }

    /**
     * Connects NativeSyncQueueManager with the interactive WebView runtime.
     * When WorkManager invokes DaylightSyncWorker while the app is active,
     * this coordinator triggers window.DaylightBridgeClient.triggerBackgroundSync().
     */
    private fun setupSyncCoordinator() {
        val syncManager = NativeSyncQueueManager.getInstance(this)
        syncManager.webViewSyncCoordinator = {
            kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
                runOnUiThread {
                    if (isDestroyed || isFinishing) {
                        continuation.resumeWith(Result.success(Pair(0, 0)))
                        return@runOnUiThread
                    }
                    webView.evaluateJavascript("window.DaylightBridgeClient?.triggerBackgroundSync?.();") { result ->
                        Log.i(TAG, "In-app triggerBackgroundSync evaluated: $result")
                        continuation.resumeWith(Result.success(Pair(1, 0)))
                    }
                }
            }
        }
    }

    /**
     * Handles external document open intents (ACTION_VIEW).
     */
    private fun handleViewIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action == Intent.ACTION_VIEW) {
            val uri = intent.data
            if (uri != null) {
                Log.i(TAG, "Handling incoming ACTION_VIEW for uri: $uri")
                fileImporter.importUri(uri)
            }
        }
    }

    /**
     * Injects JavaScript polyfills and reverse dispatchers into the web runtime.
     * Activates `window.DaylightBridgeClient` reverse dispatcher and polyfills `navigator.share`
     * and download links to route through native SAF.
     */
    private fun injectBridgeInitializationScript() {
        val script = """
            (function() {
                if (typeof window === 'undefined') return;
                var native = window.DaylightBridge;

                // 1. Polyfill navigator.share to route through native share sheet
                if (native && typeof native.shareDocument === 'function') {
                    navigator.share = async function(data) {
                        if (!data) return;
                        if (data.files && data.files.length > 0) {
                            var file = data.files[0];
                            var buffer = await file.arrayBuffer();
                            var bytes = new Uint8Array(buffer);
                            var binary = '';
                            var len = bytes.byteLength;
                            for (var i = 0; i < len; i++) {
                                binary += String.fromCharCode(bytes[i]);
                            }
                            var base64 = btoa(binary);
                            return native.shareDocument(data.title || file.name, file.type || 'application/octet-stream', base64, true);
                        }
                        return native.shareDocument(data.title || '', 'text/plain', data.text || '', false);
                    };
                }

                // 2. Intercept download anchor clicks for native SAF file export
                if (native && typeof native.exportDocument === 'function') {
                    var origClick = HTMLAnchorElement.prototype.click;
                    HTMLAnchorElement.prototype.click = function() {
                        if (this.download && this.href) {
                            var filename = this.download;
                            var href = this.href;
                            if (href.startsWith('data:')) {
                                var parts = href.split(',');
                                var meta = parts[0];
                                var data = parts.slice(1).join(',');
                                var isBase64 = meta.indexOf(';base64') !== -1;
                                var mime = (meta.split(':')[1] || '').split(';')[0] || 'application/octet-stream';
                                native.exportDocument(filename, mime, data, isBase64);
                                return;
                            } else if (href.startsWith('blob:')) {
                                fetch(href).then(function(r) { return r.blob(); }).then(async function(blob) {
                                    var buffer = await blob.arrayBuffer();
                                    var bytes = new Uint8Array(buffer);
                                    var binary = '';
                                    var len = bytes.byteLength;
                                    for (var i = 0; i < len; i++) {
                                        binary += String.fromCharCode(bytes[i]);
                                    }
                                    var b64 = btoa(binary);
                                    native.exportDocument(filename, blob.type || 'application/octet-stream', b64, true);
                                }).catch(function(e) {
                                    console.error('[DaylightBridge] Blob export failed', e);
                                });
                                return;
                            }
                        }
                        return origClick.apply(this, arguments);
                    };
                }

                // 3. Register DaylightBridgeClient reverse dispatchers
                if (!window.DaylightBridgeClient) {
                    window.DaylightBridgeClient = {
                        onHardwareActionButton: function(e) {
                            var app = window.__daylightWriterApp;
                            var action = (e && e.action) || 'toggle_focus_mode';
                            if (action === 'toggle_focus_mode') {
                                if (app && app.focusMode && typeof app.focusMode.cycleMode === 'function') {
                                    app.focusMode.cycleMode();
                                }
                            } else if (action === 'split_at_cursor') {
                                if (app && typeof app.splitCurrentDocumentAtCursor === 'function') {
                                    app.splitCurrentDocumentAtCursor();
                                }
                            }
                        },

                        importExternalDocument: async function(payload) {
                            var app = window.__daylightWriterApp;
                            if (!app || !app.repository) return '';
                            var title = (payload && payload.title) || 'Imported Manuscript';
                            var content = (payload && payload.content) || '';
                            var doc = await app.repository.saveDocument({
                                id: 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
                                title: title,
                                content: content,
                                created_at: Date.now(),
                                updated_at: Date.now(),
                                is_title_custom: true,
                                format_version: 1,
                                sync_status: 'pending'
                            });
                            if (app.leftDrawer && typeof app.leftDrawer.refresh === 'function') {
                                await app.leftDrawer.refresh();
                            }
                            if (typeof app.loadActiveDocument === 'function') {
                                await app.loadActiveDocument(doc.id);
                            }
                            return doc.id;
                        },

                        flushPendingEdits: async function() {
                            var app = window.__daylightWriterApp;
                            var native = window.DaylightBridge;
                            try {
                                if (app) {
                                    if (app.saveDebounceTimer) {
                                        clearTimeout(app.saveDebounceTimer);
                                        app.saveDebounceTimer = null;
                                    }
                                    if (app.editor && app.currentDoc && typeof app.editor.getContent === 'function') {
                                        var content = app.editor.getContent();
                                        if (app.repository && typeof app.repository.updateDocument === 'function') {
                                            await app.repository.updateDocument(app.currentDoc.id, { content: content, updated_at: Date.now() });
                                        }
                                    }
                                    if (app.repository && typeof app.repository.flushPendingEdits === 'function') {
                                        await app.repository.flushPendingEdits();
                                    }
                                }
                                if (native && typeof native.onFlushCompleted === 'function') {
                                    native.onFlushCompleted(true, 0);
                                }
                            } catch (e) {
                                console.error('[DaylightBridge] Emergency flush failed', e);
                                if (native && typeof native.onFlushCompleted === 'function') {
                                    native.onFlushCompleted(false, 0);
                                }
                            }
                        },

                        triggerBackgroundSync: async function() {
                            var app = window.__daylightWriterApp;
                            if (app && app.syncQueue && app.syncAdapter) {
                                await app.syncQueue.drain(app.syncAdapter);
                            }
                            return { pushed: 0, pulled: 0 };
                        },

                        dispatchKeyboardAction: function(action) {
                            var app = window.__daylightWriterApp;
                            if (!app) return;
                            switch (action) {
                                case 'toggle_library':
                                    if (app.drawerState) app.drawerState.toggleLeft();
                                    break;
                                case 'toggle_margin':
                                    if (app.drawerState) app.drawerState.toggleRight();
                                    break;
                                case 'toggle_focus':
                                    if (app.focusMode) app.focusMode.cycleMode();
                                    break;
                                case 'split_at_cursor':
                                    if (app.splitCurrentDocumentAtCursor) app.splitCurrentDocumentAtCursor();
                                    break;
                                case 'open_command_palette':
                                    if (app.commandPalette) app.commandPalette.open();
                                    break;
                                case 'open_export_dialog':
                                    if (app.currentDoc && app.exportDialog) app.exportDialog.open(app.currentDoc);
                                    break;
                                case 'dismiss_drawers':
                                    if (app.drawerState) {
                                        if (typeof app.drawerState.dismissAll === 'function') {
                                            app.drawerState.dismissAll();
                                        } else if (typeof app.drawerState.closeBoth === 'function') {
                                            app.drawerState.closeBoth();
                                        }
                                    }
                                    if (app.commandPalette && typeof app.commandPalette.close === 'function') app.commandPalette.close();
                                    if (app.exportDialog && typeof app.exportDialog.close === 'function') app.exportDialog.close();
                                    break;
                            }
                        }
                    };
                }
            })();
        """.trimIndent()

        webView.evaluateJavascript(script) { result ->
            Log.i(TAG, "DaylightBridgeClient initialization script injected: $result")
        }
    }

    private fun configureWebViewSettings(settings: WebSettings) {
        settings.apply {
            // Pre-rasterize DOM elements outside viewport for stutter-free typewriter scrolling
            offscreenPreRaster = true

            // Local storage and IndexedDB persistence for SQLite WAL
            domStorageEnabled = true
            databaseEnabled = true

            // Local asset cache
            cacheMode = WebSettings.LOAD_DEFAULT

            // Disable browser zoom controls and eliminate 300ms touch delay
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            // Enable JavaScript for web application
            javaScriptEnabled = true

            // Security: Disable file:// and content:// raw access; served via secure HTTPS virtual domain
            allowFileAccess = false
            allowContentAccess = false

            // Audio & media playback without initial user gesture requirement
            mediaPlaybackRequiresUserGesture = false
        }
    }

    /**
     * Configures edge-to-edge window decor and hides all system bars.
     */
    private fun setupImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        hideSystemBars()
    }

    /**
     * Hides system bars (status bar and navigation bar) with transient swipe reveal.
     */
    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    /**
     * Recreates WebView in the rare event of a Chromium render process crash.
     */
    private fun recreateWebView() {
        try {
            webView.stopLoading()
            webView.loadUrl(ENTRY_URL)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed recreating WebView after crash", t)
        }
    }

    override fun onResume() {
        super.onResume()
        DisplayModeHelper.lock120Hz(this)
        hideSystemBars()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        triggerEmergencySavePoint()
        webView.onPause()
        val syncManager = NativeSyncQueueManager.getInstance(this)
        if (syncManager.getPendingCount() > 0 && syncManager.isNetworkConnected()) {
            syncManager.scheduleImmediateSync()
        }
    }

    override fun onDestroy() {
        val syncManager = NativeSyncQueueManager.getInstance(this)
        syncManager.webViewSyncCoordinator = null
        try {
            unregisterReceiver(folioHallSensorReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "Error unregistering folioHallSensorReceiver", e)
        }
        try {
            unregisterReceiver(actionButtonReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "Error unregistering actionButtonReceiver", e)
        }
        bridge.releaseWakeLock()
        webView.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Re-assert immersive fullscreen whenever window regains focus
        if (hasFocus) {
            hideSystemBars()
        }
    }
}
