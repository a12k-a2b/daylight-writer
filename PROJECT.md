# Project: Daylight Writer Google Drive & Google Docs Cloud Sync

## Architecture
- **Web Core (`web/src/`)**: Single-page TypeScript application running in Chromium WebView and modern browsers.
  - **Storage Layer (`web/src/storage/`)**: Reactive repository (`repository.ts`) with multi-tier `wa-sqlite` VFS (OPFS `AccessHandlePoolVFS`, IDB `IDBBatchAtomicVFS`, Memory `MemoryVFS`), FTS5 full-text search, and monotonic revision vectoring.
  - **Sync Engine (`web/src/sync/`)**:
    - `oauth-pkce.ts`: Google OAuth 2.0 PKCE (RFC 7636) code challenge/verifier generation, token exchange, and background refresh.
    - `google-drive-sync-adapter.ts`: Google Drive v3 & Docs v1 client. Discovers/creates "Daylight Manuscripts" folder, creates native Google Docs (`application/vnd.google-apps.document`) via multipart conversion, updates content in-place via Docs API `documents.batchUpdate`, exports content for bidirectional reconciliation, and detects remote updates.
    - `offline-mutation-queue.ts`: SQLite-backed mutation queue with coalescing, crash recovery, and exponential backoff with jitter.
    - `network-listener.ts`: Online/offline connectivity detection triggering queue drain and remote discovery.
  - **UI Chrome (`web/src/ui/`, `web/src/drawers/`)**:
    - `sync-status-indicator.ts`: Dynamic header sync pill displaying `● Synced [time]`, `↻ Syncing... [count]`, `○ Offline`, and `⚠ Error`, opening settings on click.
    - `left-library.ts`: Drawer document cards displaying `.doc-gdocs-badge` and direct webView links to Google Docs.
    - `google-drive-modal.ts`: Sync settings dialog (`Cmd+,` shortcut) displaying connected user (`a12katta@gmail.com`), active folder, sync logs, manual force-sync trigger, and direct token entry fallback.
    - `tokens.css` / `main.css`: Strict Daylight Sol:OS neutral grayscale tokens (`--os-0` to `--os-1000`), 0 EPD screen flash hooks, fluid 120Hz LivePaper rendering.
- **Native Android Wrapper (`apps/a12k-a2b/daylight-writer/` & `android/`)**:
  - `DaylightNativeBridge.kt`: Exposes `@JavascriptInterface` for multi-tier token persistence (`setSyncCredentials`), queue updates, and immediate sync triggers.
  - `DaylightSyncWorker.kt`: Android WorkManager background sync service draining mutations when online.
  - `DaylightWebViewClient.kt`: URL override intercepting external Google Docs URLs to open in system browser.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Dedicated Folder Management | Auto-discover or create "Daylight Manuscripts" folder in Google Drive | M2 | R1 |
| 2 | Genuine Google Doc Creation | Create native `application/vnd.google-apps.document` via multipart upload | M2 | R1 |
| 3 | In-Place Document Patching | Update existing Google Doc content via Docs API `documents.batchUpdate` without duplicate files | M2 | R1 |
| 4 | File ID Local Persistence | Persist `google_drive_file_id` into SQLite `documents` table upon creation | M2 | R1 |
| 5 | Background Typing Sync Debounce | Debounce typing edits to 1.5s before syncing to Google Drive | M3 | R1 |
| 6 | Google OAuth 2.0 PKCE Flow | PKCE authorization code flow with S256 verifier/challenge for web/WebView | M1 | R2 |
| 7 | Silent Token Refresh | Background refresh of expired access tokens using refresh token | M1 | R2 |
| 8 | Multi-Tier Token Persistence | Persist tokens across sessions in Web `localStorage` and Android `SharedPreferences` | M1 | R2 |
| 9 | Direct Token Fallback | Direct token entry in modal for manual / hermetic developer testing (`mock-token-*`) | M1 | R2 |
| 10 | Google UserInfo Verification | Query UserInfo API to verify identity and display connected account (`a12katta@gmail.com`) | M1 | R2 |
| 11 | Remote Document Discovery | Query "Daylight Manuscripts" folder for remote additions or modifications | M2 | R3 |
| 12 | Bidirectional Reconciliation | Reconcile remote changes into SQLite with Last-Write-Wins and export text content | M2 | R3 |
| 13 | Offline Mutation Queue & Drain | Queue mutations in SQLite `sync_queue` during offline and drain automatically on reconnect | M2 | R3 |
| 14 | Dynamic Header Sync Pill | Display `● Synced [time]`, `↻ Syncing... [count]`, `○ Offline`, `⚠ Error` states | M3 | R4 |
| 15 | Header Pill Click Action | Clicking sync pill opens Google Drive configuration modal | M3 | R4 |
| 16 | Library Drawer Docs Badges & Links | Display Google Docs badge and direct link on manuscript cards | M3 | R4 |
| 17 | Google Drive Settings Modal | Modal with user details, folder name, sync logs, force sync button, and `Cmd+,` shortcut | M3 | R4 |
| 18 | Sol:OS Grayscale Pure Compliance | Strict adherence to `--os-0` through `--os-1000`, 0 EPD waveforms or screen flash hooks | M3 | R4 |
| 19 | Automated Unit & Integration Tests | 100% pass rate on web test suites (`npm test`) | M4 | R5 |
| 20 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all features end-to-end | E2E Track / M4 | R5 |
| 21 | Adversarial Coverage Hardening | Tier 5 white-box stress testing and edge-case bug fixes | M4 | R5 |
| 22 | Android Wrapper Compilation & Ktlint | Android build, `testDebugUnitTest`, `ktlintCheck`, and `structure_check.py` | M5 | R5 |
| 23 | DC1 Physical Hardware Validation | Verify 120Hz LivePaper performance, contrast ratio >= 4.5:1 on `rooted 3` / `rooted 4` | M5 | R5 |
| 24 | DCDemos.com Release Publication | Publish updated APK to Daylight Experiments on DCDemos.com | M5 | R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | OAuth 2.0 PKCE & Token Persistence | `oauth-pkce.ts`, UserInfo verification, multi-tier token persistence, direct token fallback | none | DONE |
| M2 | Google Drive & Docs Sync Engine | Folder discovery/creation, multipart doc creation, batchUpdate patching, remote discovery, bidirectional reconciliation, queue drain | M1 | DONE |
| M3 | Editor Pipeline & Sol:OS UI Chrome | Wire adapter into `main.ts` with 1.5s debounce, sync pill states & click, drawer badges/links, modal shortcuts, bridge hooks | M1, M2 | DONE |
| M4 | E2E Test Pass & Adversarial Hardening | Phase 1: 100% pass on E2E test suite (Tiers 1-4); Phase 2: Tier 5 adversarial stress testing | M3, TEST_READY.md | DONE |
| M5 | Android Build, DC1 Validation & DCDemos | Compile assets into wrapper, run Android tests/ktlint, test on physical DC1, publish to DCDemos | M4 | DONE |

## E2E Testing Track (Parallel)
| Track | Scope | Deliverables | Status |
|-------|-------|-------------|--------|
| E2E Testing Track | Requirement-driven opaque-box test suite covering Tiers 1-4 | `TEST_INFRA.md`, tests in `web/tests/e2e/gdrive-sync/`, `TEST_READY.md` | DONE |

## Interface Contracts

### M1 (Auth) ↔ M2 (Sync Engine)
- `AuthTokens`: `{ accessToken: string; refreshToken?: string; expiresIn?: number; tokenType: string; timestamp: number }`
- `UserInfo`: `{ email: string; name: string; picture?: string }`
- `IOAuthClient`:
  - `getValidAccessToken(): Promise<string>`
  - `getUserInfo(): Promise<UserInfo>`
  - `setDirectToken(token: string): Promise<UserInfo>`
  - `isAuthenticated(): boolean`
  - `clearTokens(): void`

### M2 (Sync Engine) ↔ M3 (UI & Editor Pipeline)
- `GoogleDriveSyncAdapter`:
  - Implements `SyncAdapter` interface (`init`, `sync`, `getStatus`, `subscribe`, `queueMutation`, `setOnline`).
  - `getStatus(): SyncStatus` (`state: 'idle' | 'synced' | 'syncing' | 'offline' | 'error'`, `lastSyncedAt?: number`, `pendingCount?: number`, `inFlightCount?: number`).
  - `pull(sinceTimestamp?: number): Promise<ReconciliationResult>`.
  - `triggerImmediateSync(): Promise<SyncResult>`.
  - Event emitter emits `'sync:start'`, `'sync:complete'`, `'sync:error'`, `'status:change'`.

### M3 (Web) ↔ Android Wrapper
- `window.DaylightBridge` (Native -> Web):
  - `setSyncCredentials(token: string, folderId: string): void`
  - `requestImmediateSync(): boolean`
  - `onSyncQueueUpdated(pendingCount: number): void`
- `window.DaylightBridgeClient` (Web -> Native):
  - `flushPendingEdits(): Promise<void>`
  - `triggerBackgroundSync(): Promise<void>`

## Code Layout
- `web/src/sync/`:
  - `sync-adapter.ts`: Core interface definitions.
  - `oauth-pkce.ts`: OAuth 2.0 PKCE helper module (M1).
  - `google-drive-sync-adapter.ts`: Full Google Drive & Docs sync adapter (M2).
  - `offline-mutation-queue.ts`: SQLite-backed mutation queue with backoff & coalescing (M2).
  - `network-listener.ts`: Online/offline listener (M2).
- `web/src/ui/`:
  - `sync-status-indicator.ts`: Header sync pill with Sol:OS glyphs/labels (M3).
  - `google-drive-modal.ts`: Sync configuration modal (M3).
- `web/src/drawers/`:
  - `left-library.ts`: Library drawer document cards with Google Docs badges and links (M3).
- `web/src/main.ts`: Application bootstrap, 1.5s cloud debounce, bridge hooks (M3).
- `web/tests/e2e/gdrive-sync/`: E2E test suites Tiers 1-4 (E2E Track).
- `apps/a12k-a2b/daylight-writer/`: Experiment Lab Android wrapper project (M5).
