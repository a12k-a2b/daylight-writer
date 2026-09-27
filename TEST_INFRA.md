# Test Infrastructure & Specification: Daylight Writer Google Drive & Docs Cloud Sync

## 1. Executive Summary & Testing Philosophy

Daylight Writer is an intentional, distraction-free landscape typewriter Progressive Web Application engineered exclusively for the Daylight Computer (DC1) and its 10.5" 4:3 LivePaper display running Sol:OS.

This document details the test infrastructure, harness architecture, and systematic 4-tier opaque-box test suite for **Google Drive & Google Docs Cloud Synchronization** (User Requirements R1–R5, Features 1–18).

### 1.1 Dual Track & Opaque-Box Methodology
- **Requirement-Driven Verification**: The test suite is derived strictly from `ORIGINAL_REQUEST.md` (R1–R5) and the formal interface contracts defined in `PROJECT.md`. Tests verify observable state, API payloads, synchronization invariants, and persistence guarantees rather than implementation internals.
- **100% Hermetic & Deterministic**: The test suite requires zero live external Google credentials or network connectivity. All Google Drive v3, Google Docs v1, Google OAuth 2.0 UserInfo, and PKCE token exchange endpoints are serviced in-memory by `MockGoogleDriveServer`.
- **Zero EPD / E-Ink Workaround Verification**: The test suite rigorously asserts compliance with Daylight Computer (DC1) LivePaper display standards: pure 8-bit grayscale Sol:OS tokens (`--os-0` to `--os-1000`), fluid 60Hz–120Hz continuous refresh rate, and complete absence of EPD screen-flash hooks (`ACTION_REFRESH_SCREEN`, waveform pauses).

---

## 2. Test Execution Engine & Commands

The test runner utilizes Node.js v22+ native TypeScript execution (`--experimental-strip-types`) with zero compilation overhead.

```bash
# Workspace root:
cd /Users/anjan/teamwork_projects/daylight-writer/web

# Run all 125 E2E Google Drive & Docs sync tests:
node --experimental-strip-types --test 'tests/e2e/gdrive-sync/*.test.ts'

# Run individual test suites:
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier1-features-f01-f05.test.ts  # Features 1-5 (25 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier1-features-f06-f10.test.ts  # Features 6-10 (25 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier1-features-f11-f13.test.ts  # Features 11-13 (15 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier1-features-f14-f18.test.ts  # Features 14-18 (25 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier2-boundary-cases.test.ts    # Boundary & Stress (25 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier3-combinations.test.ts     # Cross-Feature (6 tests)
node --experimental-strip-types --test tests/e2e/gdrive-sync/tier4-real-world-scenarios.test.ts # Scenarios (4 tests)

# Run full project test suite (including unit, integration, and E2E):
npm test

# Verify complete TypeScript type compliance:
npm run typecheck
```

---

## 3. Test Harness Architecture (`web/tests/e2e/gdrive-sync/helpers/test-harness.ts`)

### 3.1 MockGoogleDriveServer
The in-memory mock server intercepts standard `fetch` requests across all Google cloud endpoints:
- `GET /drive/v3/files?q=...`: Searches for the dedicated "Daylight Manuscripts" folder and lists child documents.
- `POST /drive/v3/files`: Creates the dedicated folder with mimeType `application/vnd.google-apps.folder`.
- `POST /upload/drive/v3/files?uploadType=multipart`: Parses RFC 2046 multipart bodies and creates genuine Google Docs (`application/vnd.google-apps.document`).
- `PATCH /upload/drive/v3/files/{id}?uploadType=media`: Performs in-place text patching without duplicating files.
- `GET /drive/v3/files/{id}/export?mimeType=text/plain`: Exports cloud Google Doc text for bidirectional reconciliation.
- `GET /oauth2/v3/userinfo`: Verifies OAuth Bearer tokens against connected user profile (`a12katta@gmail.com`).
- `POST /token`: Handles OAuth 2.0 PKCE authorization code exchanges and refresh token grants.
- **Simulation Knobs**: Configurable `simulateFailure`, `simulateAuthExpired` (401), `simulateRateLimit` (429), `failureStatusCode`, `failureMessage`, and `callHistory` inspection.

### 3.2 RFC 7636 PKCE Cryptographic Oracle
- `generateCodeVerifier(length)`: Generates unreserved URL-safe random string between 43 and 128 characters.
- `generateCodeChallenge(verifier)`: Computes SHA-256 hash with standard Base64URL encoding.
- `verifyCodeChallenge(verifier, challenge)`: Cryptographic verification oracle.

### 3.3 GDriveTestStorageRepository
In-memory SQLite-compatible document repository implementing full persistence of:
- `google_drive_file_id`
- `google_drive_revision_id`
- `last_synced_at`
- `sync_status` (`'synced'`, `'pending'`, `'conflict'`, `'error'`)
- Tombstoning (`deleted_at`) for remote delete synchronization.

### 3.4 DOM & Storage Environment (`setupGDriveTestEnv`)
Leverages `happy-dom` to provide a complete browser environment (`window`, `document`, `localStorage`, `HTMLElement`, `HTMLButtonElement`, `HTMLInputElement`, `KeyboardEvent`, `MouseEvent`) with automatic cleanup.

---

## 4. Feature Coverage Matrix (Features 1–18)

| Feature # | Feature Name | Requirement | Assigned Tier | Test File | Test Count |
|---|---|---|---|---|---|
| **F01** | Dedicated Folder Management | R1 | Tier 1 | `tier1-features-f01-f05.test.ts` | 5 |
| **F02** | Genuine Google Doc Creation | R1 | Tier 1 | `tier1-features-f01-f05.test.ts` | 5 |
| **F03** | In-Place Document Patching | R1 | Tier 1 | `tier1-features-f01-f05.test.ts` | 5 |
| **F04** | File ID Local Persistence | R1 | Tier 1 | `tier1-features-f01-f05.test.ts` | 5 |
| **F05** | Background Typing Sync Debounce | R1 | Tier 1 | `tier1-features-f01-f05.test.ts` | 5 |
| **F06** | Google OAuth 2.0 PKCE Flow | R2 | Tier 1 | `tier1-features-f06-f10.test.ts` | 5 |
| **F07** | Silent Token Refresh | R2 | Tier 1 | `tier1-features-f06-f10.test.ts` | 5 |
| **F08** | Multi-Tier Token Persistence | R2 | Tier 1 | `tier1-features-f06-f10.test.ts` | 5 |
| **F09** | Direct Token Fallback | R2 | Tier 1 | `tier1-features-f06-f10.test.ts` | 5 |
| **F10** | Google UserInfo Verification | R2 | Tier 1 | `tier1-features-f06-f10.test.ts` | 5 |
| **F11** | Remote Document Discovery | R3 | Tier 1 | `tier1-features-f11-f13.test.ts` | 5 |
| **F12** | Bidirectional Reconciliation | R3 | Tier 1 | `tier1-features-f11-f13.test.ts` | 5 |
| **F13** | Offline Mutation Queue & Drain | R3 | Tier 1 | `tier1-features-f11-f13.test.ts` | 5 |
| **F14** | Dynamic Header Sync Pill | R4 | Tier 1 | `tier1-features-f14-f18.test.ts` | 5 |
| **F15** | Header Pill Click Action | R4 | Tier 1 | `tier1-features-f14-f18.test.ts` | 5 |
| **F16** | Library Drawer Docs Badges & Links | R4 | Tier 1 | `tier1-features-f14-f18.test.ts` | 5 |
| **F17** | Google Drive Settings Modal | R4 | Tier 1 | `tier1-features-f14-f18.test.ts` | 5 |
| **F18** | Sol:OS Grayscale Pure Compliance | R4 | Tier 1 | `tier1-features-f14-f18.test.ts` | 5 |
| **B01** | Empty & Nil Inputs | R1–R4 | Tier 2 | `tier2-boundary-cases.test.ts` | 5 |
| **B02** | Unicode, Emoji & Special Characters | R1 | Tier 2 | `tier2-boundary-cases.test.ts` | 5 |
| **B03** | Extreme Document Size Stress | R1, R3 | Tier 2 | `tier2-boundary-cases.test.ts` | 5 |
| **B04** | Offline Transitions & Network Flapping | R3 | Tier 2 | `tier2-boundary-cases.test.ts` | 5 |
| **B05** | Token Expiry & Auth Corner Cases | R2 | Tier 2 | `tier2-boundary-cases.test.ts` | 5 |
| **C01–C06** | Cross-Feature Interactions | R1–R4 | Tier 3 | `tier3-combinations.test.ts` | 6 |
| **S01–S04** | Real-World Application Scenarios | R1–R5 | Tier 4 | `tier4-real-world-scenarios.test.ts` | 4 |
| **TOTAL** | **Full E2E Sync Suite** | **R1–R5** | **Tiers 1–4** | **7 Test Files** | **125** |

---

## 5. Systematic 4-Tier Test Breakdown

### Tier 1: Isolated Feature Coverage (90 Tests)
- `tier1-features-f01-f05.test.ts` (25 tests):
  - F01: Auto-discovery, auto-creation, ID caching, permission error handling, custom folder names.
  - F02: RFC 2046 multipart upload format, parent folder assignment, default titling, genuine mimeType verification, creation error propagation.
  - F03: Media PATCH endpoint routing, zero duplicate files guarantee across repeated edits, monotonic revision tracking, title preservation, 404 recovery.
  - F04: DocumentRecord `google_drive_file_id` assignment, persistence across edits, index lookups, tombstone retention, revision mapping.
  - F05: Debounce timer window (1.5s), rapid typing resets, post-pause auto-push, mutation coalescing, manual immediate sync cancellation.
- `tier1-features-f06-f10.test.ts` (25 tests):
  - F06: RFC 7636 verifier generation, S256 challenge computation, auth URL construction, code exchange for access/refresh tokens, invalid grant rejection.
  - F07: Expiration calculation, silent token renewal, cache hit on valid tokens, invalid refresh token handling, user profile retention.
  - F08: Web `localStorage` persistence, initial load auto-restore, Android `DaylightBridge` sync, disconnect cleanup, corrupt JSON recovery.
  - F09: Direct token entry without popup, test token acceptance (`mock-token-*`), empty token clearing, sync audit logs, `IOAuthClient.setDirectToken`.
  - F10: UserInfo endpoint query, profile parsing (`email`, `name`, `picture`), account verification (`a12katta@gmail.com`), 401 handling, success logging.
- `tier1-features-f11-f13.test.ts` (15 tests):
  - F11: Files list query inside parent folder, detection of remote additions, modifiedTime vs local updated_at comparison, trashed file filtering, empty folder safety.
  - F12: Last-Write-Wins remote resolution, Last-Write-Wins local resolution, sub-second millisecond tie-break, local record insertion, Google Docs plain text export.
  - F13: SQLite `sync_queue` offline enqueue, multi-edit coalescing, automated queue drain, exponential backoff with retry count, startup in-flight recovery.
- `tier1-features-f14-f18.test.ts` (25 tests):
  - F14: `● Synced` checkmark glyph, `↻ Syncing...` progress glyph, `○ Offline (N)` badge, `⚠ Error` tooltip, reactive adapter event binding.
  - F15: Error pill retry callback, accessibility roles (`role="status"`, `aria-live="polite"`), modal open trigger, keyboard Enter trigger, subscription cleanup.
  - F16: Google Docs badge on card, direct `webViewLink` anchor, omission on local-only drafts, `DaylightWebViewClient` URL intercept, Sol:OS styling.
  - F17: User card details, folder name display, live activity log lines, "Sync to Drive Now" manual trigger, Escape key dismissal.
  - F18: Palette monochrome purity (R==G==B), WCAG 2.1 AAA contrast for primary inks (>=7:1), WCAG 2.1 AA for secondary ink (>=4.5:1), zero EPD screen flash hooks, neutral overlay opacity.

### Tier 2: Boundary & Corner Cases (25 Tests)
- `tier2-boundary-cases.test.ts`:
  - **B01 (Empty & Nil)**: 0-char document, whitespace-only manuscript, blank title default, empty token string, empty remote folder query.
  - **B02 (Unicode & Special)**: CJK multi-byte UTF-8, RTL Arabic/Hebrew scripts, surrogate emoji pairs, reserved URL/filesystem characters in title, raw markdown HTML/math symbols.
  - **B03 (Extreme Size & Stress)**: 100,000+ words manuscript (>500KB payload), 500+ character titles, 50-document rapid queueing burst, repeated large-document PATCH cycles, 100-item queue drain memory safety.
  - **B04 (Network Flapping)**: Empty queue offline-to-online no-op, rapid 5x connection toggling, connection timeout mid-sync mutation preservation, HTTP 429 rate limit backoff, HTTP 503 backend service unavailable.
  - **B05 (Token Expiry & Auth Corner)**: HTTP 401 state transition, batch drain auth failure mutation retention, revoked refresh token cleanup, silent renewal before push, garbage token string resilience.

### Tier 3: Cross-Feature Combinations (6 Tests)
- `tier3-combinations.test.ts`:
  - **C01**: Offline typing -> reconnect -> remote edit conflict resolution via Last-Write-Wins.
  - **C02**: Silent token refresh mid-batch mutation drain without dropping queued edits.
  - **C03**: Active 1.5s background typing debounce cancelled by manual modal "Sync to Drive Now" trigger.
  - **C04**: Remote document discovery automatically feeds into local SQLite FTS5 fuzzy search index.
  - **C05**: Direct token entry updates UserInfo, populates modal logs, and transitions header pill to `● Synced`.
  - **C06**: Library drawer Google Docs card click intercepted by `DaylightBridgeClient` for system browser launch.

### Tier 4: Real-World Application Scenarios (4 Tests)
- `tier4-real-world-scenarios.test.ts`:
  - **S01 (Full Manuscript Writing Session)**: Author authenticates; creates chapter; 1.5s debounce auto-creates Google Doc in "Daylight Manuscripts"; persists remote ID; writes 2 more paragraphs; in-place patch updates existing file without duplicates; library card links directly to Google Docs.
  - **S02 (Offline Transatlantic Flight Scenario)**: Airplane mode activated; author creates 2 new essays and edits existing draft; 3 mutations queue in SQLite; header pill shows `○ Offline (3)`; flight lands; Wi-Fi reconnects; automated drain flushes all 3 documents to Google Drive; header transitions to `● Synced`.
  - **S03 (Multi-Device Cloud Collaboration)**: Author writes on DC1 tablet; leaves tablet; edits document remotely in Google Docs on laptop; returns to DC1; remote discovery detects newer timestamp; bidirectional reconciliation pulls latest text; local editor updates.
  - **S04 (High-Speed Typewriter Burst with Token Lifecycle Interruption)**: 80 WPM typing burst triggers multiple debounce pushes; access token expires abruptly; background silent refresh renews credentials without user intervention or dropped keystrokes; pill smoothly settles at `● Synced`.

---

## 6. Hardware Profile & Sol:OS Compliance Checklist

- [x] **Display Specification**: Native 60Hz–120Hz Reflective LCD LivePaper display profile (+8px hardware margin inset).
- [x] **Zero EPD Hooks**: Zero `ACTION_REFRESH_SCREEN` broadcasts, zero waveform clears, zero modal dismissal delays.
- [x] **Sol:OS 8-bit Neutral Grayscale**: Strict adherence to pre-calibrated Sol:OS tokens (`--os-0` to `--os-1000`).
- [x] **Monochrome Purity**: 100% verified color purity (R == G == B) with zero chromatic color leaks across all components.
- [x] **WCAG 2.1 Contrast Standards**: Primary text inks (`--os-900`/`--os-1000`) exceed WCAG AAA (>7.0:1); secondary ink (`--os-400`) satisfies WCAG AA (>=4.5:1).
