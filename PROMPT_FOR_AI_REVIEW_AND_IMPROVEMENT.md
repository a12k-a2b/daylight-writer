# Prompt for External AI Review & Improvement of Daylight Writer

> **Instructions for Anjan**: Copy and paste the entire prompt below into any advanced AI model (Claude 3.5 Sonnet / Opus, GPT-4o / o1, or Gemini) along with access to the private repository (`https://github.com/a12k-a2b/daylight-writer`).

***

```markdown
# Context & Mission: Senior Systems & Product Review of Daylight Writer for Daylight Computer (DC1)

You are acting as an elite Principal Software Architect, Human-Computer Interaction (HCI) Specialist, and AI-First Systems Engineer reviewing **Daylight Writer** for **Anjan Katta**, founder and CEO of **Daylight Computer Co.**

Daylight Writer is a distraction-free, landscape typewriter writing environment and native Android application engineered specifically for the revolutionary **Daylight Computer (DC1)** running **Sol:OS**.

---

## 1. CRITICAL HARDWARE & DISPLAY SPECIFICATION (DC1 & SOL:OS)
When reviewing and improving this codebase, you must adhere strictly to these physical hardware invariants:

1. **LivePaper Display Architecture**:
   - **Technology**: Custom **Reflective / Transflective LCD** (LivePaper).
   - **Refresh Rate**: Native **60Hz to 120Hz** (silky smooth, full fluid framerate).
   - **Color Depth**: **8-bit Grayscale (256 discrete levels of gray)**, monochrome.
   - **Illumination**: Ambient light reflection (sunlight readable, zero blue light) + pure amber frontlight.
2. **ZERO E-Ink / EPD Artifacts — NEVER USE EPD WORKAROUNDS**:
   - The DC1 is **NOT an Electronic Paper Display (EPD)** or E-Ink panel. There are **NO microcapsules or electrophoretic particles**.
   - There is **ZERO ghosting**.
   - **NEVER use E-ink screen clear flashes, never broadcast `ACTION_REFRESH_SCREEN`, and never introduce artificial pauses or delays on modal dismissal**.
   - The display is driven by standard Android `SurfaceFlinger`, `Choreographer`, `VSYNC`, and Skia/HWUI rendering backed by the MediaTek Mali-G57 GPU.
3. **Calibrated Sol:OS Grayscale Neutral Tokens**:
   - `--os-0`: `#FFFFFF` (Base paper / ground)
   - `--os-50`: `#F7F7F7` (Surface panels / cards)
   - `--os-100`: `rgba(0,0,0,0.08)` / `#DCD5C9` (Hairline borders)
   - `--os-150`: `#F5F5F5` (Recessed canvas)
   - `--os-200`: `#CCCCCC` (Disabled)
   - `--os-300`: `#858585` (Low emphasis / tertiary text)
   - `--os-400`: `#535353` (Secondary text ink)
   - `--os-800`: `#343434` (Dark fields / pressed states)
   - `--os-900`: `#1A1A1A` (Primary text ink / headlines)
   - `--os-1000`: `#000000` (Max black ink)
4. **Physical Chassis & Peripherals**:
   - Chassis Action / Top button on `/dev/input/event1` (`mtk-kpd` scancode 88, Android `KeyEvent.KEYCODE_F12`, keycode 142).
   - Folio Cover Hall effect magnetic sensor on `/dev/input/event3` (`SW_LID`, broadcasting `Intent.ACTION_SCREEN_OFF`).
   - Wacom I2C Digitizer on `/dev/input/event4` (4096 pressure levels, tilt X/Y).
   - Native resolution: `1584×1184` landscape active viewport (270 dpi) on 1200×1600 physical panel.

---

## 2. What Has Been Built (Repository Architecture)

The codebase is organized into a clean monorepo:

```
daylight-writer/
├── android/                         # Bespoke Kotlin Android 13 APK Wrapper
│   ├── app/src/main/java/com/daylight/writer/
│   │   ├── MainActivity.kt          # 100% immersive edge-to-edge, key dispatch, bridge
│   │   ├── DaylightApplication.kt   # App lifecycle & WorkManager initialization
│   │   ├── hardware/
│   │   │   ├── DisplayModeHelper.kt # DC1 Mode 2 (120.00001 fps) refresh locking
│   │   │   ├── HardwareKeyInterceptor.kt # Sub-16ms F12 action key & Esc light-dismiss
│   │   │   └── FolioHallSensorReceiver.kt # ACTION_SCREEN_OFF emergency save point
│   │   ├── bridge/
│   │   │   ├── DaylightBridgeInterface.kt # Type-safe @JavascriptInterface contract
│   │   │   ├── DaylightNativeBridge.kt    # Bridge dispatcher & WakeLock manager
│   │   │   ├── DaylightAssetsPathHandler.kt # WebViewAssetLoader + COOP/COEP isolation
│   │   │   └── DaylightWebViewClient.kt   # Asset routing & crash recovery
│   │   ├── saf/
│   │   │   ├── SafFileExporter.kt   # ACTION_CREATE_DOCUMENT (.md, .txt, .docx, .pdf)
│   │   │   ├── SafFileImporter.kt   # ACTION_OPEN_DOCUMENT & ACTION_VIEW
│   │   │   └── ShareSheetHelper.kt  # Intent.ACTION_SEND with FileProvider
│   │   └── sync/
│   │       ├── DaylightSyncWorker.kt      # CoroutineWorker background sync
│   │       └── NativeSyncQueueManager.kt  # 15-min periodic & immediate sync queue
│   └── tests/                       # 130-test 4-tier E2E automated test suite
├── web/                             # Progressive Web / TypeScript Core Application
│   ├── src/
│   │   ├── editor/                  # TipTap editor, typewriter scroll, focus modes
│   │   ├── collaboration/           # Y.js CRDT & Hocuspocus multi-agent provider
│   │   ├── outline/                 # Steven Johnson Scrivener binder & scrivenings
│   │   ├── notes/                   # Spatially synchronized paragraph thought margin
│   │   ├── ai/                      # Inline continuation (+++), Cmd+K command bar
│   │   ├── storage/                 # wa-sqlite (OPFS/IDB) & sub-15ms fuzzy search
│   │   ├── sync/                    # Google Drive & Docs multipart cloud sync adapter
│   │   ├── export/                  # Multi-format export pipeline (.md, .txt, .docx, .pdf)
│   │   └── ui/                      # Sol:OS dialogs (Collab, Google Drive, Export)
│   └── tests/                       # 535 unit and integration tests (Node/Playwright)
├── release/
│   └── daylight-writer-release.apk  # Compiled production APK (4.02 MB)
└── screenshots/                     # Empirical DC1 hardware screen captures (States 1–8)
```

### Core Features Verified on DC1 Hardware:
1. **iA Writer Focus Mechanics**: Sentence/paragraph dimming, typewriter vertical center-scrolling at 50% viewport height, auto-titling, date/time header.
2. **Steven Johnson Scrivener Outline & Scrivenings**:
   - Collapsible left binder organizing documents into hierarchical folders and sections.
   - Drag-and-drop reordering with persistent tree sort order.
   - **Scrivenings Concatenation Mode**: Clicking a folder concatenates all descendant sections into a single continuous editing canvas separated by `§` dividers, enabling writers to zoom out to the whole manuscript or zoom in to a single scene.
3. **Spatially Synchronized Margin Notes**:
   - Right drawer scratchpad pinning thoughts directly to corresponding paragraph Y-coordinates.
   - Scrolling the main typewriter canvas synchronously translates margin notes to maintain strict spatial alignment.
4. **TipTap + Y.js CRDT Collaboration**:
   - Real-time collaborative typing with Hocuspocus provider.
   - Deterministic multi-writer merging: human writers and autonomous AI agents edit the same document concurrently without locking or collision.
5. **Lex-Inspired AI Writing Affordances**:
   - Inline continuation triggered by typing `+++`.
   - Floating `Cmd+K` command palette to transform selected text (summarize, expand, rewrite voice).
   - Context-aware querying consulting the current draft and attached margin notes.
6. **Local-First SQLite Persistence**:
   - Powered by `wa-sqlite` (WASM SQLite with OPFS / IndexedDB VFS).
   - Sub-15ms fuzzy search across 5,000 synthetic documents.
7. **Google Drive & Docs Cloud Sync**:
   - Automated OAuth token integration for `a12katta@gmail.com`.
   - Multipart related upload converting Markdown to native Google Docs in `My Drive / Daylight Manuscripts`.
8. **Native Android 120Hz APK Shell**:
   - Cold boot in **437ms**; locked to Mode 2 (`120.00001 fps`); 95th-percentile GPU frame time: **8ms**.
   - 100% immersive edge-to-edge canvas (`1584×1184`) with zero status or navigation bars.
   - DC1 chassis Action button (`mtk-kpd` / `KEYCODE_F12`) dispatched with **<16ms latency**.
   - Magnetic folio cover closure (`ACTION_SCREEN_OFF`) executes emergency SQLite WAL flush backed by 3000ms WakeLock in **37ms**.
   - WorkManager 15-minute periodic background sync registered in Android `JobScheduler`.
   - Total release APK size: **4.02 MB** (well below the 10 MB budget).

---

## 3. Your Objectives & Review Directives

Anjan wants your candid, deeply technical, and visionary review of this project. Analyze the codebase and address the following five areas:

### Area 1: Deep Codebase & Architecture Audit
- Inspect the bridge between Kotlin (`DaylightNativeBridge.kt`, `MainActivity.kt`) and TypeScript (`main.ts`, `tiptap-editor.ts`). Are there any subtle memory leaks, dangling listeners, or unhandled WebView renderer crashes?
- Evaluate the Y.js CRDT persistence lifecycle in relation to `wa-sqlite` and WorkManager background sync. What happens if a network partition occurs while an external AI agent and the human writer are editing concurrently?
- Review the `WebViewAssetLoader` with Cross-Origin Isolation (`COOP: same-origin`, `COEP: require-corp`). Is the asset resolution completely bulletproof against edge-case asset paths and large media embeds?

### Area 2: Writing Flow & UX Ergonomics for Long-Form Authors
- Analyze Steven Johnson's philosophy of "breaking into chunks for focus, then concatenating to see the whole":
  - How can we make Scrivenings mode even more fluid? (e.g. split-screen editor comparing two sections side-by-side; corkboard index card mode with synopsis and word count targets).
  - How can the spatial margin notes drawer be enhanced? (e.g. bi-directional linking, converting margin thoughts into outline sections, collapsing/expanding note threads).
- Evaluate physical keyboard ergonomics on the DC1. What keyboard shortcuts, Vim/Emacs modes, or tactile typewriter sound feedback could be added?

### Area 3: AI-First Architecture & Autonomous Agent Workflows
- The user's vision is for Daylight Writer to be **AI-first**:
  - Since Y.js CRDTs allow multiple agents and humans to write into the same document without locking, how should we architect a background "Research & Fact-Checking Swarm" that reads the author's draft in real-time, finds historical or scientific citations, and drafts suggested notes into the right margin?
  - How can we integrate local on-device small language models (e.g. Gemma 2 2B / Llama 3.2 1B via MediaTek NeuroPilot NPU or ExecuTorch) for zero-latency, private, offline completions when the author is completely off-grid?
  - How can semantic vector embeddings across the author's entire binder be stored in local SQLite (e.g. sqlite-vec WASM) for instant cross-book conceptual queries?

### Area 4: Hardware & Sol:OS Synergies
- **Wacom Stylus Integration**: The DC1 has a high-precision Wacom digitizer (`/dev/input/event4`) with 4096 pressure levels and tilt. How can we introduce fluid stylus margin annotations, handwritten margin notes that OCR into text, or margin proofreading gestures (e.g. strike-through to delete, caret to insert)?
- **Amber Frontlight Tuning**: How can we tie frontlight warmth and brightness directly to ambient light sensors or night-writing focus sessions via a native Sol:OS API?
- **Battery Life & Extreme Low-Power Modes**: The DC1 has extraordinary battery life. How can we optimize the typing loop so CPU frequency stays at minimum P-states while maintaining 120Hz VSYNC input responsiveness?

### Area 5: Concrete Improvement Roadmap & Pull Request Blueprints
- Provide 3 to 5 prioritized, high-impact improvements.
- For each recommendation, provide:
  1. The architectural rationale.
  2. The exact files to modify or create.
  3. Concrete code snippets / PR blueprints ready for implementation.

Begin your review by giving an executive appraisal of the current build, then deliver your deep technical analysis across all five areas.
```
