# Original User Request

## 2026-09-22T06:19:23Z

Build a high-performance, custom bespoke Kotlin Android APK wrapper for Daylight Writer tailored for the Daylight Computer (DC1) running Sol:OS (Android 13, MediaTek MT8781, 10.5" 120Hz LivePaper display). The native wrapper eliminates browser chrome, delivers 100% immersive edge-to-edge typography, serves local production assets via AndroidX WebViewAssetLoader (`https://appassets.androidplatform.net/`), integrates the Android Storage Access Framework (SAF) for external USB/SD file storage, intercepts physical hardware buttons (`mtk-kpd`), and provides background sync via WorkManager.

Working directory: ~/teamwork_projects/daylight_writer_android
Integrity mode: development

## Requirements

### R1. High-Performance Bespoke Kotlin WebView Shell & 120Hz Optimization
Construct a minimal, production-grade Android Gradle project in Kotlin embedding Daylight Writer's production web bundle (from ~/teamwork_projects/daylight_writer). Configure modern `androidx.webkit.WebViewAssetLoader` to serve assets under secure local HTTPS (`https://appassets.androidplatform.net/assets/`) ensuring complete support for Web Workers, WebCrypto, and WASM SQLite without external server dependencies. Optimize WebView settings for DC1 hardware: enable hardware layer acceleration (`LAYER_TYPE_HARDWARE`), offscreen pre-rasterization (`offscreenPreRaster = true`), DOM storage, and database persistence. Implement true 100% fullscreen edge-to-edge mode via `WindowCompat.setDecorFitsSystemWindows(window, false)` and `WindowInsetsControllerCompat`, removing all status bars, navigation bars, and browser URL bars.

### R2. Storage Access Framework (SAF) & Native File Bridge
Implement a type-safe Kotlin `@JavascriptInterface` bridge connecting the web application to Android's Storage Access Framework:
- Native file export: allow saving Markdown (`.md`), Plain Text (`.txt`), Word (`.docx`), and PDF (`.pdf`) documents directly to user-selected device folders, SD cards, or connected USB-C flash drives via `Intent.ACTION_CREATE_DOCUMENT`.
- Native file open: allow opening external `.md` or `.txt` files directly into the editor via `Intent.ACTION_OPEN_DOCUMENT` and `Intent.ACTION_VIEW`.
- Native share sheet: trigger Android's native system share sheet (`Intent.ACTION_SEND`) for sharing manuscript drafts and text.

### R3. Hardware Key Interception & Physical Chassis Integration
Listen to native hardware key events on the DC1 (`mtk-kpd` on `/dev/input/event1`):
- Intercept the chassis Action / Top button to trigger in-app actions (e.g., toggling Focus Mode or triggering Split-at-Cursor) via the JavaScript bridge without touching on-screen controls.
- Handle physical keyboard shortcuts (<Esc>, <Cmd+K>, <Cmd+Shift+K>, <Cmd+1..6>) instantaneously.
- Hook system lifecycle and the magnetic folio cover Hall sensor (`/dev/input/event3` via `ACTION_SCREEN_OFF`) to automatically trigger a clean transaction flush and save point before device sleep.

### R4. Background Synchronization Service
Implement an Android `WorkManager` background worker that executes periodic synchronization routines, syncing pending SQLite change queues to external endpoints (Google Drive / cloud sync) even when the app is suspended or the folio cover is closed.

## Acceptance Criteria

### Build & Package Integrity
- [ ] Android project compiles cleanly using `./gradlew assembleDebug` with 0 errors.
- [ ] Generated APK installs cleanly via ADB onto connected DC1 tablet (`rooted 4`, serial `JMBR00405`).
- [ ] Final APK size is lightweight (under 10MB excluding bundled fonts/assets).

### Display & Ergonomics
- [ ] Application launches into 100% immersive edge-to-edge landscape canvas (1584×1184 / 1600×1200) with zero browser chrome or status bars.
- [ ] Text rendering, typewriter center-scrolling, and drawer animations run smoothly at native 120Hz with hardware acceleration enabled.
- [ ] All visual styling strictly adheres to Sol:OS neutral grayscale tokens (`--os-0` to `--os-1000`) with zero EPD/E-ink screen flash or refresh artifacts.

### Native Bridge & Functionality
- [ ] Export dialog triggers Android Storage Access Framework (SAF) save file picker or saves directly to external storage.
- [ ] DC1 hardware keypresses successfully dispatch actions across the JavaScript bridge into the TipTap/Scrivener engine.
- [ ] All 530 existing unit and E2E tests for the web application continue to pass cleanly within the bundle.

## Verification Plan

### Automated Verification
- Automated Gradle build test: `./gradlew assembleDebug` completes with exit code 0.
- Automated installation and launch: `adb -s JMBR00405 install -r app/build/outputs/apk/debug/app-debug.apk` and `adb shell am start -n com.daylight.writer/.MainActivity`.
- Cold start measurement: verify application cold boot to interactive canvas is under 800ms via `adb shell am start -W`.
- Hardware screenshot verification: capture live screencap on DC1 demonstrating full edge-to-edge rendering without browser bars.
