# Project: Daylight Writer Android APK Wrapper

## Architecture
- **Host System**: macOS, OpenJDK 17.0.19, Android SDK (platforms 33-36, build-tools 34.0.0/35.0.0), Gradle 8.9 wrapper, AGP 8.7.3 + Kotlin 2.0.21.
- **Target Hardware**: Daylight Computer (DC1), Model `DC_1`, Product `vext_jagar`, SoC MediaTek MT8781 (arm64-v8a), Android 13 (API 33), Root `su 0`.
- **Display Pipeline**: 10.5" 120Hz LivePaper (Reflective / Transflective LCD), native 8-bit grayscale, 1584x1184 landscape active resolution (270 dpi) on 1200x1600 physical panel. Zero EPD waveforms, zero screen flash, zero refresh pauses. Standard Android SurfaceFlinger/HWUI rendering at 120Hz.
- **Application Shell**: Minimal bespoke Kotlin Android application embedding Daylight Writer production web distribution (`~/teamwork_projects/daylight_writer/dist`).
- **Asset Serving**: `androidx.webkit.WebViewAssetLoader` with local HTTPS (`https://appassets.androidplatform.net/assets/`), injected `application/wasm` MIME type, and Cross-Origin Isolation headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) enabling WASM SQLite (`wa-sqlite-async`) and WebCrypto without external server dependencies.
- **Native File Bridge**: Type-safe `@JavascriptInterface` bridge connecting web editor to Storage Access Framework (`Intent.ACTION_CREATE_DOCUMENT`, `Intent.ACTION_OPEN_DOCUMENT`, `Intent.ACTION_VIEW`, `Intent.ACTION_SEND` with `FileProvider`).
- **Chassis & Hardware Events**: Zero-latency (<16ms) interception in `MainActivity.dispatchKeyEvent` for Action/Top button (`mtk-kpd` scancode 88 / `KeyEvent.KEYCODE_F12`), `KeyEvent.KEYCODE_ESCAPE` light-dismissal, and magnetic folio Hall sensor (`ACTION_SCREEN_OFF` / `SW_LID`) triggering atomic SQLite WAL flush + 3000ms `PowerManager.PARTIAL_WAKE_LOCK`.
- **Background Sync**: `androidx.work:work-runtime-ktx:2.10.0` with `DaylightSyncWorker : CoroutineWorker` mirroring `sync_queue` mutations and syncing to Google Drive REST API.

---

## Feature Inventory
Every feature from user requirements and the Phase 0 survey is mapped to a milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Gradle Scaffolding & Setup | Kotlin 2.0.21, AGP 8.7.3, SDK 33/34, AndroidX dependencies, <10MB APK budget | M1 | ORIGINAL_REQUEST §R1 |
| 2 | WebViewAssetLoader & WASM MIME | Local HTTPS `https://appassets.androidplatform.net/assets/`, WASM MIME & COOP/COEP headers | M1 | ORIGINAL_REQUEST §R1 |
| 3 | 120Hz & Immersive Display | Mode 2 120Hz locking, `LAYER_TYPE_HARDWARE`, offscreenPreRaster, 100% immersive edge-to-edge | M1 | ORIGINAL_REQUEST §R1 |
| 4 | SAF File Export Bridge | `@JavascriptInterface` for saving `.md`, `.txt`, `.docx`, `.pdf` via `ACTION_CREATE_DOCUMENT` | M2 | ORIGINAL_REQUEST §R2 |
| 5 | SAF File Open & ACTION_VIEW | Open `.md`/`.txt` via `ACTION_OPEN_DOCUMENT` and system intent `ACTION_VIEW` into editor | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Native System Share Sheet | Android share sheet via `Intent.ACTION_SEND` and `FileProvider` for manuscript export | M2 | ORIGINAL_REQUEST §R2 |
| 7 | DC1 Chassis Action Button | Intercept `mtk-kpd` scancode 88 / `KEYCODE_F12` (142) in `dispatchKeyEvent` (<16ms) | M3 | ORIGINAL_REQUEST §R3 |
| 8 | Physical Keyboard & Escape Key | `<Esc>` light-dismiss without app exit; transparent Meta/Command modifier shortcuts | M3 | ORIGINAL_REQUEST §R3 |
| 9 | Folio Hall Sensor & Save Point | `SW_LID` / `ACTION_SCREEN_OFF` triggering emergency SQLite WAL flush with WakeLock | M3 | ORIGINAL_REQUEST §R3 |
| 10 | WorkManager Background Sync | `DaylightSyncWorker : CoroutineWorker` periodic sync for SQLite `sync_queue` mutations | M4 | ORIGINAL_REQUEST §R4 |
| 11 | Full E2E Integration Verification | Pass 100% E2E test suite (Tiers 1-4) and adversarial verification (Tier 5) on DC1 | Final | ORIGINAL_REQUEST Acceptance |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Kotlin WebView Shell & 120Hz Optimization | F1, F2, F3: Project scaffolding, asset loader, 120Hz display locking, immersive edge-to-edge canvas | none | DONE |
| M2 | SAF & Native File Bridge | F4, F5, F6: `@JavascriptInterface` bridge, export (.md/.txt/.docx/.pdf), open, share sheet | M1 | DONE |
| M3 | Chassis Hardware & Folio Integration | F7, F8, F9: Action button (`mtk-kpd` F12), Escape intercept, Hall sensor `ACTION_SCREEN_OFF` flush | M1 | DONE |
| M4 | Background Synchronization Service | F10: `WorkManager` CoroutineWorker, native mutation queue mirror, Google Drive sync | M2 | DONE |
| Final | E2E Integration & DC1 Hardware Verification | F11: Pass 100% E2E tests (Tiers 1-4), Tier 5 adversarial verification on DC1 (`rooted 4`) | M1, M2, M3, M4 | DONE |
| E2E | E2E Testing Track | Independent opaque-box test suite (Tiers 1-4) & automated runner on DC1 hardware | none | DONE (130/130 pass) |

---

## Interface Contracts

### 1. Web to Native Bridge (`window.DaylightBridge`)
Exposed to JavaScript via `@JavascriptInterface` on name `"DaylightBridge"`:
```kotlin
package com.daylight.writer.bridge

import android.webkit.JavascriptInterface

interface DaylightBridgeInterface {
    @JavascriptInterface
    fun exportDocument(filename: String, mimeType: String, base64Data: String, isBinary: Boolean): Boolean

    @JavascriptInterface
    fun requestOpenDocument(supportedExtensions: String): Boolean

    @JavascriptInterface
    fun shareDocument(title: String, mimeType: String, contentOrBase64: String, isBinary: Boolean): Boolean

    @JavascriptInterface
    fun onFlushCompleted(success: Boolean, dirtyRemaining: Int)

    @JavascriptInterface
    fun onSyncQueueUpdated(pendingCount: Int)

    @JavascriptInterface
    fun getDeviceInfo(): String

    @JavascriptInterface
    fun showToast(message: String)
}
```

### 2. Native to Web Reverse Dispatcher (`window.DaylightBridgeClient`)
Invoked by Kotlin via `webView.evaluateJavascript`:
```typescript
export interface DaylightBridgeClient {
  onHardwareActionButton(event?: { action?: 'toggle_focus_mode' | 'split_at_cursor' }): void;
  importExternalDocument(payload: { title: string; content: string; mimeType?: string }): Promise<string>;
  flushPendingEdits(): Promise<void>;
  dispatchKeyboardAction(action: 'dismiss_drawers' | 'toggle_library' | 'toggle_margin' | 'toggle_focus' | 'split_at_cursor' | 'open_command_palette' | 'open_export_dialog'): void;
  triggerBackgroundSync(): Promise<{ pushed: number; pulled: number }>;
}
```

### 3. Sol:OS Action Button & Keycodes
- DC1 Chassis Button: `mtk-kpd` scancode `88`, Android `KeyEvent.KEYCODE_F12` (`142`).
- Sol:OS Broadcast: `com.daylightcomputer.solosserver.ACTION_BUTTON_SINGLE_PRESS`.
- Keyboard Escape: `KeyEvent.KEYCODE_ESCAPE` (`111`) -> calls `dispatchKeyboardAction('dismiss_drawers')`, returns `true`.

### 4. Folio Hall Sensor Emergency Flush
- Hall switch: `/dev/input/event3` (`SW_LID`), broadcast `Intent.ACTION_SCREEN_OFF`.
- Save point: Acquire `PowerManager.PARTIAL_WAKE_LOCK` (3000ms), execute `flushPendingEdits()`, release WakeLock on `onFlushCompleted`.

---

## Code Layout

```
/Users/anjan/teamwork_projects/daylight_writer_android/
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml
│       │   ├── assets/
│       │   │   ├── index.html
│       │   │   └── assets/           <- Bundled Daylight Writer production assets
│       │   ├── java/com/daylight/writer/
│       │   │   ├── MainActivity.kt
│       │   │   ├── DaylightApplication.kt
│       │   │   ├── bridge/
│       │   │   │   ├── DaylightNativeBridge.kt
│       │   │   │   ├── DaylightBridgeInterface.kt
│       │   │   │   └── DaylightAssetsPathHandler.kt
│       │   │   ├── saf/
│       │   │   │   ├── SafFileExporter.kt
│       │   │   │   └── SafFileImporter.kt
│       │   │   ├── hardware/
│       │   │   │   ├── HardwareKeyInterceptor.kt
│       │   │   │   ├── FolioHallSensorReceiver.kt
│       │   │   │   └── DisplayModeHelper.kt
│       │   │   └── sync/
│       │   │       ├── DaylightSyncWorker.kt
│       │   │       └── NativeSyncQueueManager.kt
│       │   └── res/
│       │       ├── values/
│       │       │   ├── colors.xml    <- Sol:OS grayscale tokens (--os-0 to --os-1000)
│       │       │   ├── strings.xml
│       │       │   └── themes.xml    <- Fullscreen theme (no title, no action bar)
│       │       └── xml/
│       │           └── file_paths.xml <- FileProvider paths for share sheet
│       └── test/
│           └── java/com/daylight/writer/
├── gradle/
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
└── gradlew
```
